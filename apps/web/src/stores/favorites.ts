import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Track } from '@/api/types';
import { load, save, STORAGE_KEYS } from '@/storage';

/** 收藏 / 最近播放：只存浏览器本地（验收标准 7） */
export const useFavoritesStore = defineStore('favorites', () => {
  const tracks = ref<Track[]>(load<Track[]>(STORAGE_KEYS.favorites, []));

  watch(tracks, (value) => save(STORAGE_KEYS.favorites, value), { deep: true });

  const ids = computed(() => new Set(tracks.value.map((t) => t.id)));

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

  function clear(): void {
    tracks.value = [];
  }

  return { tracks, has, toggle, clear };
});
