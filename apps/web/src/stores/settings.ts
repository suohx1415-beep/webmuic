import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Platform, QualityLevel } from '@/api/types';
import { load, save, STORAGE_KEYS } from '@/storage';

export type PlatformFilter = 'all' | Platform;

interface PersistedSettings {
  quality: QualityLevel;
  platform: PlatformFilter;
  limit: number;
  volume: number;
  muted: boolean;
  showTranslation: boolean;
}

const DEFAULTS: PersistedSettings = {
  quality: 'high',
  platform: 'all',
  limit: 20,
  volume: 0.8,
  muted: false,
  showTranslation: true,
};

export const QUALITY_OPTIONS: { value: QualityLevel; label: string; hint: string }[] = [
  { value: 'standard', label: '标准', hint: '128k，省流量' },
  { value: 'high', label: '高品质', hint: '320k，默认' },
  { value: 'lossless', label: '无损', hint: 'FLAC，需要会员凭证' },
  { value: 'hires', label: 'Hi-Res', hint: '最高档，多数账号不可得' },
];

/** 界面偏好：刷新后保留（验收标准 7） */
export const useSettingsStore = defineStore('settings', () => {
  const initial = { ...DEFAULTS, ...load<Partial<PersistedSettings>>(STORAGE_KEYS.settings, {}) };

  const quality = ref<QualityLevel>(initial.quality);
  const platform = ref<PlatformFilter>(initial.platform);
  const limit = ref(initial.limit);
  const volume = ref(initial.volume);
  const muted = ref(initial.muted);
  const showTranslation = ref(initial.showTranslation);

  const snapshot = computed<PersistedSettings>(() => ({
    quality: quality.value,
    platform: platform.value,
    limit: limit.value,
    volume: volume.value,
    muted: muted.value,
    showTranslation: showTranslation.value,
  }));

  watch(
    snapshot,
    (value) => save(STORAGE_KEYS.settings, value),
    { deep: true },
  );

  function reset(): void {
    quality.value = DEFAULTS.quality;
    platform.value = DEFAULTS.platform;
    limit.value = DEFAULTS.limit;
    volume.value = DEFAULTS.volume;
    muted.value = DEFAULTS.muted;
    showTranslation.value = DEFAULTS.showTranslation;
  }

  return { quality, platform, limit, volume, muted, showTranslation, reset };
});
