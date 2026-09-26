import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Track, UrlResponse } from '@/api/types';
import { load, save, STORAGE_KEYS } from '@/storage';

interface PersistedQueue {
  tracks: Track[];
  index: number;
}

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (matches.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const minutes = Number(m[1] ?? 0);
      const seconds = Number(m[2] ?? 0);
      const fractionRaw = m[3] ?? '0';
      const fraction = Number(fractionRaw.padEnd(3, '0').slice(0, 3)) / 1000;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** 把翻译歌词按时间戳合并进原文 */
function mergeTranslation(lines: LyricLine[], translated: string): LyricLine[] {
  if (!translated) return lines;
  const map = new Map<number, string>();
  for (const line of parseLrc(translated)) {
    map.set(Math.round(line.time * 100), line.text);
  }
  return lines.map((line) => ({ ...line, translation: map.get(Math.round(line.time * 100)) }));
}

export type PlayMode = 'sequential' | 'repeat-one' | 'repeat-all' | 'shuffle';

export const usePlayerStore = defineStore('player', () => {
  const persisted = load<PersistedQueue>(STORAGE_KEYS.queue, { tracks: [], index: 0 });

  const queue = ref<Track[]>(persisted.tracks ?? []);
  const index = ref(Math.min(Math.max(0, persisted.index ?? 0), Math.max(0, queue.value.length - 1)));
  const playing = ref(false);
  const loadingUrl = ref(false);
  const mode = ref<PlayMode>('sequential');

  /** 当前曲目的真实播放地址（指向网关 /api/stream/...） */
  const streamUrl = ref('');
  const resolved = ref<UrlResponse | null>(null);
  const urlError = ref('');
  const degradedNotice = ref('');

  const currentTime = ref(0);
  /** 浏览器读到的实际时长；部分格式 metadata 不可用，回退到曲目元数据 */
  const mediaDuration = ref(0);
  const lyric = ref<LyricLine[]>([]);
  const lyricError = ref('');

  const current = computed<Track | null>(() => queue.value[index.value] ?? null);

  const duration = computed(() => {
    if (mediaDuration.value > 0) return mediaDuration.value;
    return (current.value?.durationMs ?? 0) / 1000;
  });

  const activeLyricIndex = computed(() => {
    if (lyric.value.length === 0) return -1;
    const t = currentTime.value;
    let low = 0;
    let high = lyric.value.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const line = lyric.value[mid];
      if (line && line.time <= t) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  });

  watch(
    () => ({ tracks: queue.value, index: index.value }),
    (value) => save(STORAGE_KEYS.queue, value),
    { deep: true },
  );

  function setQueue(tracks: Track[], startIndex = 0): void {
    queue.value = [...tracks];
    index.value = Math.min(Math.max(0, startIndex), Math.max(0, tracks.length - 1));
  }

  /** 追加曲目（按 id 去重），返回实际新增的数量 */
  function append(tracks: Track[]): number {
    const existing = new Set(queue.value.map((t) => t.id));
    const added = tracks.filter((t) => !existing.has(t.id));
    queue.value = [...queue.value, ...added];
    return added.length;
  }

  function playTrackList(tracks: Track[], track: Track): void {
    const at = tracks.findIndex((t) => t.id === track.id);
    setQueue(tracks, at === -1 ? 0 : at);
    playing.value = true;
  }

  function playAt(target: number): void {
    if (target < 0 || target >= queue.value.length) return;
    index.value = target;
    playing.value = true;
  }

  function removeAt(target: number): void {
    if (target < 0 || target >= queue.value.length) return;
    queue.value = queue.value.filter((_, i) => i !== target);
    if (queue.value.length === 0) {
      clearQueue();
      return;
    }
    if (target < index.value) index.value -= 1;
    else if (target === index.value) index.value = Math.min(index.value, queue.value.length - 1);
  }

  function clearQueue(): void {
    queue.value = [];
    index.value = 0;
    playing.value = false;
    streamUrl.value = '';
    resolved.value = null;
    lyric.value = [];
  }

  function next(shuffle = false): number {
    if (queue.value.length === 0) return -1;
    if (shuffle) {
      if (queue.value.length === 1) return 0;
      let candidate = index.value;
      while (candidate === index.value) candidate = Math.floor(Math.random() * queue.value.length);
      return candidate;
    }
    return index.value + 1 >= queue.value.length ? 0 : index.value + 1;
  }

  /** 播放结束或用户点下一首时的推进逻辑（含单曲循环；forceNext 用于不可播错误时强行跳下一首） */
  function advance(manual = false, forceNext = false): void {
    if (queue.value.length === 0) return;
    if (mode.value === 'repeat-one' && !manual && !forceNext) {
      currentTime.value = 0;
      playing.value = true;
      return;
    }
    const target = next(mode.value === 'shuffle');
    if (target === -1) return;
    if (!manual && !forceNext && mode.value === 'sequential' && target === 0) {
      playing.value = false;
      index.value = queue.value.length - 1;
      return;
    }
    index.value = target;
    playing.value = true;
  }

  function previous(): void {
    if (queue.value.length === 0) return;
    // 播放超过 3 秒时，上一首先回到开头（与主流播放器一致）
    if (currentTime.value > 3) {
      currentTime.value = 0;
      return;
    }
    const target = index.value - 1 < 0 ? queue.value.length - 1 : index.value - 1;
    index.value = target;
    playing.value = true;
  }

  return {
    queue,
    index,
    playing,
    loadingUrl,
    mode,
    streamUrl,
    resolved,
    urlError,
    degradedNotice,
    currentTime,
    mediaDuration,
    lyric,
    lyricError,
    current,
    duration,
    activeLyricIndex,
    setQueue,
    append,
    playTrackList,
    playAt,
    removeAt,
    clearQueue,
    advance,
    previous,
    parseLrc,
    mergeTranslation,
  };
});

export type { LyricLine };
