import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Track } from '../src/api/types';
import { useFavoritesStore } from '../src/stores/favorites';

function mockTrack(id: string): Track {
  return {
    id: `netease:${id}`,
    platform: 'netease',
    platformTrackId: id,
    title: `Song ${id}`,
    artists: [{ name: 'Test Singer' }],
    album: { name: 'Album' },
    durationMs: 180000,
    qualities: [
      { level: 'standard', label: '标准' },
      { level: 'high', label: '高品质' },
    ],
  };
}

describe('useFavoritesStore & 自建歌单', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('支持收藏与取消收藏单曲', () => {
    const store = useFavoritesStore();
    const t = mockTrack('1001');

    expect(store.has(t.id)).toBe(false);
    store.toggle(t);
    expect(store.has(t.id)).toBe(true);
    expect(store.tracks).toHaveLength(1);

    store.toggle(t);
    expect(store.has(t.id)).toBe(false);
    expect(store.tracks).toHaveLength(0);
  });

  it('支持自建本地歌单、重命名、添加曲目与删除', () => {
    const store = useFavoritesStore();

    // 1. 创建歌单
    const playlist = store.createCustomPlaylist('轻音乐精选');
    expect(playlist.name).toBe('轻音乐精选');
    expect(store.customPlaylists).toHaveLength(1);

    // 2. 添加歌曲
    const t1 = mockTrack('2001');
    const t2 = mockTrack('2002');
    const added1 = store.addTrackToCustomPlaylist(playlist.id, t1);
    expect(added1).toBe(true);
    expect(store.customPlaylists[0]?.tracks).toHaveLength(1);

    // 重复添加同一首被阻止
    const addedDup = store.addTrackToCustomPlaylist(playlist.id, t1);
    expect(addedDup).toBe(false);
    expect(store.customPlaylists[0]?.tracks).toHaveLength(1);

    store.addTrackToCustomPlaylist(playlist.id, t2);
    expect(store.customPlaylists[0]?.tracks).toHaveLength(2);

    // 3. 移除单曲
    store.removeTrackFromCustomPlaylist(playlist.id, t1.id);
    expect(store.customPlaylists[0]?.tracks).toHaveLength(1);
    expect(store.customPlaylists[0]?.tracks[0]?.id).toBe(t2.id);

    // 4. 重命名
    store.renameCustomPlaylist(playlist.id, '流行金曲');
    expect(store.customPlaylists[0]?.name).toBe('流行金曲');

    // 5. 删除歌单
    store.deleteCustomPlaylist(playlist.id);
    expect(store.customPlaylists).toHaveLength(0);
  });
});
