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

export interface CustomPlaylist {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  tracks: Track[];
}

/** 收藏 / 自建歌单：只存浏览器本地（验收标准 7） */
export const useFavoritesStore = defineStore('favorites', () => {
  const tracks = ref<Track[]>(load<Track[]>(STORAGE_KEYS.favorites, []));
  const playlists = ref<SavedPlaylistItem[]>(load<SavedPlaylistItem[]>(STORAGE_KEYS.savedPlaylists, []));
  const customPlaylists = ref<CustomPlaylist[]>(load<CustomPlaylist[]>(STORAGE_KEYS.customPlaylists, []));

  watch(tracks, (value) => save(STORAGE_KEYS.favorites, value), { deep: true });
  watch(playlists, (value) => save(STORAGE_KEYS.savedPlaylists, value), { deep: true });
  watch(customPlaylists, (value) => save(STORAGE_KEYS.customPlaylists, value), { deep: true });

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

  // --- 本地自建歌单管理 ---
  function createCustomPlaylist(name: string, description = ''): CustomPlaylist {
    const trimmed = name.trim() || '未命名歌单';
    const newPlaylist: CustomPlaylist = {
      id: `local:${Date.now()}`,
      name: trimmed,
      description,
      createdAt: Date.now(),
      tracks: [],
    };
    customPlaylists.value = [newPlaylist, ...customPlaylists.value];
    return newPlaylist;
  }

  function deleteCustomPlaylist(id: string): void {
    customPlaylists.value = customPlaylists.value.filter((p) => p.id !== id);
  }

  function renameCustomPlaylist(id: string, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const target = customPlaylists.value.find((p) => p.id === id);
    if (target) {
      target.name = trimmed;
      customPlaylists.value = [...customPlaylists.value];
    }
  }

  function addTrackToCustomPlaylist(playlistId: string, track: Track): boolean {
    const target = customPlaylists.value.find((p) => p.id === playlistId);
    if (!target) return false;
    if (target.tracks.some((t) => t.id === track.id)) return false;
    target.tracks = [track, ...target.tracks];
    customPlaylists.value = [...customPlaylists.value];
    return true;
  }

  function removeTrackFromCustomPlaylist(playlistId: string, trackId: string): void {
    const target = customPlaylists.value.find((p) => p.id === playlistId);
    if (!target) return;
    target.tracks = target.tracks.filter((t) => t.id !== trackId);
    customPlaylists.value = [...customPlaylists.value];
  }

  return {
    tracks,
    playlists,
    customPlaylists,
    has,
    toggle,
    hasPlaylist,
    togglePlaylist,
    removePlaylist,
    clear,
    createCustomPlaylist,
    deleteCustomPlaylist,
    renameCustomPlaylist,
    addTrackToCustomPlaylist,
    removeTrackFromCustomPlaylist,
  };
});

