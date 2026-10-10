import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { load, save } from '@/storage';

export type EqPreset = 'flat' | 'bass' | 'vocal' | 'treble' | 'surround' | 'custom';

export interface EqBand {
  freq: number;
  gain: number; // -12dB 到 +12dB
  label: string;
}

export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 16000];

export const EQ_PRESETS: Record<Exclude<EqPreset, 'custom'>, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0], // 重低音增强
  vocal: [-2, -1, 0, 3, 5, 4, 2, 0, -1], // 人声突出
  treble: [-2, -1, 0, 0, 1, 3, 5, 6, 7], // 清澈高音
  surround: [4, 2, 0, -1, 0, 2, 4, 5, 5], // 3D/环绕氛围
};

export const useAudioFxStore = defineStore('audioFx', () => {
  const persisted = load<{
    enabled: boolean;
    preset: EqPreset;
    gains: number[];
    bassBoost: number; // 0 ~ 10
    spatial: boolean;
  }>('audio_fx', {
    enabled: false,
    preset: 'flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    bassBoost: 0,
    spatial: false,
  });

  const enabled = ref(persisted.enabled);
  const preset = ref<EqPreset>(persisted.preset);
  const gains = ref<number[]>([...persisted.gains]);
  const bassBoost = ref<number>(persisted.bassBoost);
  const spatial = ref<boolean>(persisted.spatial);

  watch(
    [enabled, preset, gains, bassBoost, spatial],
    () => {
      save('audio_fx', {
        enabled: enabled.value,
        preset: preset.value,
        gains: gains.value,
        bassBoost: bassBoost.value,
        spatial: spatial.value,
      });
    },
    { deep: true },
  );

  function setPreset(newPreset: EqPreset): void {
    preset.value = newPreset;
    if (newPreset !== 'custom') {
      gains.value = [...EQ_PRESETS[newPreset]];
    }
  }

  function setBandGain(index: number, gain: number): void {
    if (index >= 0 && index < gains.value.length) {
      gains.value[index] = Math.max(-12, Math.min(12, gain));
      preset.value = 'custom';
    }
  }

  function reset(): void {
    enabled.value = false;
    preset.value = 'flat';
    gains.value = [...EQ_PRESETS.flat];
    bassBoost.value = 0;
    spatial.value = false;
  }

  return {
    enabled,
    preset,
    gains,
    bassBoost,
    spatial,
    setPreset,
    setBandGain,
    reset,
  };
});
