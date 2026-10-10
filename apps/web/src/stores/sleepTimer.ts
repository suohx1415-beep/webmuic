import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type SleepMode = 'off' | 'minutes' | 'end-of-track';

export const SLEEP_PRESETS = [15, 30, 45, 60, 90] as const;

/**
 * 定时关闭：倒计时结束时把 `expired` 置为 true，由 useAudio 负责淡出并暂停；
 * 「播完这首」模式由 useAudio 在 ended 事件里处理。只存在内存，刷新即取消。
 */
export const useSleepTimerStore = defineStore('sleepTimer', () => {
  const mode = ref<SleepMode>('off');
  const endsAt = ref(0);
  const now = ref(Date.now());
  /** 每次到点自增，供 useAudio watch */
  const expired = ref(0);
  let ticker: ReturnType<typeof setInterval> | null = null;

  const remainingMs = computed(() => (mode.value === 'minutes' ? Math.max(0, endsAt.value - now.value) : 0));
  const active = computed(() => mode.value !== 'off');

  const label = computed(() => {
    if (mode.value === 'end-of-track') return '播完这首';
    if (mode.value !== 'minutes') return '';
    const total = Math.ceil(remainingMs.value / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  function stopTicker(): void {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  function startMinutes(minutes: number): void {
    mode.value = 'minutes';
    endsAt.value = Date.now() + minutes * 60_000;
    now.value = Date.now();
    stopTicker();
    ticker = setInterval(() => {
      now.value = Date.now();
      if (now.value >= endsAt.value) {
        cancel();
        expired.value += 1;
      }
    }, 1000);
  }

  function startEndOfTrack(): void {
    stopTicker();
    mode.value = 'end-of-track';
    endsAt.value = 0;
  }

  function cancel(): void {
    stopTicker();
    mode.value = 'off';
    endsAt.value = 0;
  }

  return { mode, endsAt, remainingMs, active, label, expired, startMinutes, startEndOfTrack, cancel };
});
