import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createRenderer, nextTick, ssrContextKey } from 'vue';
import { api } from '../src/api/client';
import type { SearchResponse } from '../src/api/types';
import { useSettingsStore } from '../src/stores/settings';
import SearchView from '../src/views/SearchView.vue';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../src/components/TrackList.vue', () => ({ default: { render: () => null } }));
vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  api: { search: vi.fn(), searchAlbums: vi.fn(), searchPlaylists: vi.fn(), suggest: vi.fn() },
}));
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
interface SearchState {
  keyword: string;
  searchType: string;
  loading: boolean;
  error: string;
  result: SearchResponse | null;
  suggestions: string[];
  runSearch(page?: number, append?: boolean): Promise<void>;
  loadSuggestions(): void;
  rememberQuery(): Promise<void>;
}
let unmount: () => void;
function mountSearch(): SearchState {
  // Node 环境由 Vite 编译为 SSR 组件；这里只测试真实 setup 状态，不测试布局。
  const app = renderer.createApp({ ...SearchView, render: () => null });
  app.provide(ssrContextKey, {});
  const vm = app.mount({});
  unmount = () => app.unmount();
  return (vm.$ as unknown as { setupState: SearchState }).setupState;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function result(query: string, offset = 0): SearchResponse {
  return { query, offset, limit: 20, counts: { qq: 20 }, totals: { qq: 100 }, tracks: [] };
}
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  vi.stubGlobal('document', { documentElement: { setAttribute() {} } });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => { unmount?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('搜索请求状态', () => {
  it('慢返回的旧搜索不能覆盖新搜索或清除加载状态', async () => {
    const older = deferred<SearchResponse>();
    const newer = deferred<SearchResponse>();
    vi.mocked(api.search).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const state = mountSearch();
    state.keyword = '旧词';
    const first = state.runSearch();
    state.keyword = '新词';
    const second = state.runSearch();
    older.resolve(result('旧词'));
    await first;
    expect(state.loading).toBe(true);
    expect(state.result).toBeNull();
    newer.resolve(result('新词'));
    await second;
    expect(state.result?.query).toBe('新词');
    expect(state.loading).toBe(false);
  });
  it('旧搜索失败不能覆盖新结果的错误状态', async () => {
    const older = deferred<SearchResponse>();
    vi.mocked(api.search).mockReturnValueOnce(older.promise).mockResolvedValueOnce(result('新词'));
    const state = mountSearch();
    state.keyword = '旧词';
    const first = state.runSearch();
    state.keyword = '新词';
    await state.runSearch();
    older.reject(new Error('旧请求失败'));
    await first;
    expect(state.error).toBe('');
    expect(state.result?.query).toBe('新词');
  });
  it('修改输入但未提交时，加载更多仍使用已提交的关键词和分页大小', async () => {
    vi.mocked(api.search).mockResolvedValueOnce(result('已提交')).mockResolvedValueOnce(result('已提交', 20));
    const state = mountSearch();
    state.keyword = '已提交';
    await state.runSearch();
    state.keyword = '草稿';
    useSettingsStore().limit = 50;
    await state.runSearch(1, true);
    expect(api.search).toHaveBeenLastCalledWith({ q: '已提交', platform: 'all', limit: 20, offset: 20 });
  });
  it('卸载后忽略未完成的搜索', async () => {
    const pending = deferred<SearchResponse>();
    vi.mocked(api.search).mockReturnValueOnce(pending.promise);
    const state = mountSearch();
    state.keyword = '测试';
    const task = state.runSearch();
    unmount();
    pending.resolve(result('测试'));
    await task;
    expect(state.result).toBeNull();
  });
  it('提交搜索后旧联想请求不能重新打开建议列表', async () => {
    vi.useFakeTimers();
    const pending = deferred<{ suggestions: string[] }>();
    vi.mocked(api.suggest).mockReturnValueOnce(pending.promise);
    vi.mocked(api.search).mockResolvedValue(result('测试'));
    const state = mountSearch();
    state.keyword = '测试';
    state.loadSuggestions();
    await vi.advanceTimersByTimeAsync(200);
    await state.rememberQuery();
    pending.resolve({ suggestions: ['不该显示'] });
    await nextTick();
    expect(state.suggestions).toEqual([]);
  });
});
