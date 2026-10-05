import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createRenderer, nextTick } from 'vue';
import { api, ApiError } from '../src/api/client';
import type { Track, UrlResponse } from '../src/api/types';
import { hasMoreSearchResults } from '../src/api/searchPage';
import { useAudio } from '../src/composables/useAudio';
import { usePlayerStore } from '../src/stores/player';
import { useSettingsStore } from '../src/stores/settings';

vi.mock('../src/api/client', async (original) => ({
  ...await original<typeof import('../src/api/client')>(),
  api: { trackUrl: vi.fn(), lyric: vi.fn() },
}));

function track(id: string): Track {
  return { id: `qq:${id}`, platform: 'qq', platformTrackId: id, title: id,
    artists: [], album: { name: '' }, durationMs: 120000, qualities: [] };
}
function url(id: string): UrlResponse {
  return { trackId: id, url: `/api/stream/${id}`, requestedQuality: 'high', quality: 'high',
    qualityLabel: '高品质', size: null, br: null, expiresAt: Date.now() + 60000 };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await nextTick();
}
class FakeAudio extends EventTarget {
  preload = '';
  crossOrigin = '';
  volume = 1;
  muted = false;
  src = '';
  currentTime = 0;
  duration = NaN;
  paused = true;
  error: unknown = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn(() => { this.currentTime = 0; this.duration = NaN; this.error = null; });
  removeAttribute() { this.src = ''; }
}

// 使用 Vue 自定义渲染器挂载真实组合函数，覆盖 watch 与卸载生命周期，无需真实 DOM。
const renderer = createRenderer<object, object>({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
  parentNode: () => null, nextSibling: () => null,
});
let unmount: (() => void) | undefined;
function mountAudio() {
  let audio!: ReturnType<typeof useAudio>;
  const app = renderer.createApp({ setup() { audio = useAudio(); audio.bind(); return () => null; } });
  app.mount({});
  unmount = () => app.unmount();
  return { audio, element: audio.element as unknown as FakeAudio, player: usePlayerStore() };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', { documentElement: { setAttribute() {} } });
  vi.mocked(api.trackUrl).mockImplementation(async (id) => url(id));
  vi.mocked(api.lyric).mockResolvedValue({ trackId: '', lrc: '[00:01]原文', translated: '[00:01]译文' });
});
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals(); });

describe('队列', () => {
  it('同时去除已有曲目与本批次重复项', () => {
    const player = usePlayerStore();
    player.setQueue([track('a')]);
    expect(player.append([track('a'), track('b'), track('b')])).toBe(1);
    expect(player.queue.map((t) => t.id)).toEqual(['qq:a', 'qq:b']);
  });
  it('清空队列同时清理时长、错误与加载状态', () => {
    const player = usePlayerStore();
    player.setQueue([track('a')]);
    player.mediaDuration = 50;
    player.currentTime = 20;
    player.urlError = player.lyricError = player.degradedNotice = '旧提示';
    player.loadingUrl = true;
    player.clearQueue();
    expect([player.currentTime, player.mediaDuration, player.duration]).toEqual([0, 0, 0]);
    expect([player.urlError, player.lyricError, player.degradedNotice]).toEqual(['', '', '']);
    expect(player.loadingUrl).toBe(false);
  });
});

describe('媒体状态同步', () => {
  it('切歌立即停止旧音频，并忽略慢返回的旧地址', async () => {
    const pending = deferred<UrlResponse>();
    const { player, element } = mountAudio();
    player.playTrackList([track('a'), track('b'), track('c')], track('a'));
    await flush();
    expect(element.paused).toBe(false);
    vi.mocked(api.trackUrl).mockImplementationOnce(() => pending.promise);
    player.playAt(1);
    await flush();
    expect(element.paused).toBe(true);
    expect(element.src).toBe('');
    expect(player.resolved).toBeNull();
    player.playAt(2);
    await flush();
    pending.resolve(url('qq:b'));
    await flush();
    expect(element.src).toBe('/api/stream/qq:c');
    expect(player.loadingUrl).toBe(false);
  });
  it('上一首超过三秒时真正回到音频开头', async () => {
    const { player, element } = mountAudio();
    player.playTrackList([track('a')], track('a'));
    await flush();
    element.currentTime = 12;
    element.dispatchEvent(new Event('timeupdate'));
    player.previous();
    await flush();
    expect(element.currentTime).toBe(0);
    expect(player.currentTime).toBe(0);
  });
  it.each(['repeat-one', 'repeat-all', 'shuffle'] as const)('单首队列在 %s 模式下可继续播放', async (mode) => {
    const { player, element } = mountAudio();
    player.mode = mode;
    player.playTrackList([track('a')], track('a'));
    await flush();
    element.currentTime = 120;
    element.paused = true;
    element.dispatchEvent(new Event('ended'));
    await flush();
    expect(element.currentTime).toBe(0);
    expect(element.paused).toBe(false);
  });
  it('清空队列使待完成的请求失效并卸载媒体', async () => {
    const pending = deferred<UrlResponse>();
    vi.mocked(api.trackUrl).mockReturnValueOnce(pending.promise);
    const { player, element } = mountAudio();
    player.playTrackList([track('a')], track('a'));
    await flush();
    player.clearQueue();
    await flush();
    pending.resolve(url('qq:a'));
    await flush();
    expect(element.src).toBe('');
    expect(player.streamUrl).toBe('');
    expect(element.paused).toBe(true);
  });
  it('播放拒绝后回退为暂停并显示可操作提示', async () => {
    const { player, element, audio } = mountAudio();
    element.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    player.playTrackList([track('a')], track('a'));
    await flush();
    expect(player.playing).toBe(false);
    expect(audio.errorText.value).toContain('点击播放');
  });
  it('旧 play 拒绝不能暂停新的曲目', async () => {
    const pending = deferred<void>();
    const { player, element } = mountAudio();
    element.play.mockImplementationOnce(() => pending.promise);
    player.playTrackList([track('a'), track('b')], track('a'));
    await flush();
    player.playAt(1);
    await flush();
    pending.reject(new Error('interrupted'));
    await flush();
    expect(player.playing).toBe(true);
    expect(element.src).toContain('qq:b');
  });
  it('解析失败后播放按钮重新请求地址', async () => {
    vi.mocked(api.trackUrl).mockRejectedValueOnce(new ApiError(502, 'UPSTREAM_UNAVAILABLE', '暂不可用'));
    const { player, audio, element } = mountAudio();
    player.playTrackList([track('a')], track('a'));
    await flush();
    expect(player.playing).toBe(false);
    audio.toggle();
    await flush();
    expect(api.trackUrl).toHaveBeenCalledTimes(2);
    expect(element.paused).toBe(false);
    expect(audio.errorText.value).toBe('');
  });
  it('暂停的队列解析失败时不会擅自切歌并开始播放', async () => {
    vi.mocked(api.trackUrl).mockRejectedValueOnce(new ApiError(410, 'URL_UNAVAILABLE', '不可播'));
    const { player, element } = mountAudio();
    player.setQueue([track('a'), track('b')]);
    await flush();
    expect(player.index).toBe(0);
    expect(player.playing).toBe(false);
    expect(element.play).not.toHaveBeenCalled();
  });
  it('连续不可播时有限次跳过，避免队列空转', async () => {
    vi.mocked(api.trackUrl).mockRejectedValue(new ApiError(410, 'URL_UNAVAILABLE', '不可播'));
    const { player, audio } = mountAudio();
    player.playTrackList([track('a'), track('b')], track('a'));
    await flush();
    expect(api.trackUrl).toHaveBeenCalledTimes(4);
    expect(player.playing).toBe(false);
    expect(audio.errorText.value).toContain('暂无可用播放地址');
  });
  it('翻译开关立即更新当前歌词', async () => {
    const { player } = mountAudio();
    player.setQueue([track('a')]);
    await flush();
    expect(player.lyric[0]?.translation).toBe('译文');
    useSettingsStore().showTranslation = false;
    await flush();
    expect(player.lyric[0]?.translation).toBeUndefined();
  });
  it('卸载后慢请求不能恢复播放', async () => {
    const pending = deferred<UrlResponse>();
    vi.mocked(api.trackUrl).mockReturnValueOnce(pending.promise);
    const { player, element } = mountAudio();
    player.playTrackList([track('a')], track('a'));
    await flush();
    unmount?.(); unmount = undefined;
    pending.resolve(url('qq:a'));
    await flush();
    expect(element.src).toBe('');
    expect(element.play).not.toHaveBeenCalled();
  });
});

describe('聚合搜索分页', () => {
  it('两平台合计40项不代表各平台40项已加载', () => {
    expect(hasMoreSearchResults({ offset: 0, limit: 20, counts: { qq: 20, netease: 20 }, totals: { qq: 40, netease: 40 } }, 200)).toBe(true);
  });
  it('空页终止加载，即使上游总数不准确', () => {
    expect(hasMoreSearchResults({ offset: 20, limit: 20, counts: { qq: 0 }, totals: { qq: 999 } }, 200)).toBe(false);
  });
  it('未知总数且不足一页时终止加载', () => {
    expect(hasMoreSearchResults({ offset: 20, limit: 20, counts: { qq: 3 }, totals: {} }, 200)).toBe(false);
  });
  it('达到分页上限后终止加载', () => {
    expect(hasMoreSearchResults({ offset: 180, limit: 20, counts: { qq: 20 }, totals: { qq: 999 } }, 200)).toBe(false);
  });
});
