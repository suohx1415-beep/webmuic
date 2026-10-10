import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Track } from '@/api/types';
import { load, save, STORAGE_KEYS } from '@/storage';

export interface HistoryEntry {
  track: Track;
  lastPlayedAt: number;
  /** 累计有效播放次数 */
  count: number;
  /** 最近的播放时间戳（用于「本周常听」），只保留最近 PLAY_STAMPS_MAX 次 */
  plays: number[];
}

const MAX_ENTRIES = 300;
const PLAY_STAMPS_MAX = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 播放历史：只存在浏览器 localStorage，听满 30 秒（或半首）才计一次有效播放 */
export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>(load<HistoryEntry[]>(STORAGE_KEYS.history, []));

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  watch(
    entries,
    (value) => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(STORAGE_KEYS.history, value), 500);
    },
    { deep: true },
  );

  /** 按最近播放时间倒序 */
  const recent = computed(() => [...entries.value].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt));

  /** 最近 7 天播放次数排行 */
  const weeklyTop = computed(() => {
    const since = Date.now() - WEEK_MS;
    return entries.value
      .map((entry) => ({ entry, weekly: entry.plays.filter((t) => t >= since).length }))
      .filter((item) => item.weekly > 0)
      .sort((a, b) => b.weekly - a.weekly || b.entry.lastPlayedAt - a.entry.lastPlayedAt);
  });

  function record(track: Track, at = Date.now()): void {
    const existing = entries.value.find((e) => e.track.id === track.id);
    if (existing) {
      existing.track = track;
      existing.lastPlayedAt = at;
      existing.count += 1;
      existing.plays = [...existing.plays, at].slice(-PLAY_STAMPS_MAX);
      return;
    }
    const next = [{ track, lastPlayedAt: at, count: 1, plays: [at] }, ...entries.value];
    if (next.length > MAX_ENTRIES) {
      next.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
      next.length = MAX_ENTRIES;
    }
    entries.value = next;
  }

  function remove(trackId: string): void {
    entries.value = entries.value.filter((e) => e.track.id !== trackId);
  }

  function clear(): void {
    entries.value = [];
  }

  return { entries, recent, weeklyTop, record, remove, clear };
});
