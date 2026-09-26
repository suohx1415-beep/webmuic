import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Track } from '@/api/types';
import { load, save, STORAGE_KEYS } from '@/storage';

export interface SavedPlaylistItem {
  id: string;
  platform: 'netease' | 'qq';
  name: string;
  coverUrl?: string;
  creator?: string;
  trackCount?: number;
  type: 'playlist' | 'album';
  savedAt: number;
}

/** 收藏 / 最近播放：只存浏览器本地（验收标准 7） */
export const useFavoritesStore = defineStore('favorites', () => {
  const tracks = ref<Track[]>(load<Track[]>(STORAGE_KEYS.favorites, []));
  const playlists = ref<SavedPlaylistItem[]>(load<SavedPlaylistItem[]>(STORAGE_KEYS.savedPlaylists, []));

  watch(tracks, (value) => save(STORAGE_KEYS.favorites, value), { deep: true });
  watch(playlists, (value) => save(STORAGE_KEYS.savedPlaylists, value), { deep: true });

  const ids = computed(() => new Set(tracks.value.map((t) => t.id)));
  const playlistIds = computed(() => new Set(playlists.value.map((p) => p.id)));

  function has(id: string): boolean {
    return ids.value.has(id);
  }

  function toggle(track: Track): boolean {
    if (has(track.id)) {
      tracks.value = tracks.value.filter((t) => t.id !== track.id);
      return false;
    }
    tracks.value = [track, ...tracks.value];
    return true;
  }

  function hasPlaylist(id: string): boolean {
    return playlistIds.value.has(id);
  }

  function togglePlaylist(item: Omit<SavedPlaylistItem, 'savedAt'>): boolean {
    if (hasPlaylist(item.id)) {
      playlists.value = playlists.value.filter((p) => p.id !== item.id);
      return false;
    }
    playlists.value = [{ ...item, savedAt: Date.now() }, ...playlists.value];
    return true;
  }

  function removePlaylist(id: string): void {
    playlists.value = playlists.value.filter((p) => p.id !== id);
  }

  function clear(): void {
    tracks.value = [];
  }

  return { tracks, playlists, has, toggle, hasPlaylist, togglePlaylist, removePlaylist, clear };
});

