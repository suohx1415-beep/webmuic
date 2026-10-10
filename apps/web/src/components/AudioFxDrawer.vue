<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { useAudioFxStore, EQ_FREQUENCIES, type EqPreset } from '@/stores/audioFx';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const store = useAudioFxStore();

const PRESET_OPTIONS: { key: EqPreset; label: string }[] = [
  { key: 'flat', label: '原声 (平直)' },
  { key: 'bass', label: '重低音增强' },
  { key: 'vocal', label: '人声甜美' },
  { key: 'treble', label: '清澈高音' },
  { key: 'surround', label: '3D 环绕' },
  { key: 'custom', label: '自定义' },
];

function formatFreq(freq: number): string {
  if (freq >= 1000) return `${freq / 1000}kHz`;
  return `${freq}Hz`;
}
</script>

<template>
  <div v-if="open" class="eq-drawer-overlay" @click.self="emit('close')">
    <div class="eq-drawer">
      <header class="eq-header">
        <div class="eq-title">
          <Icon name="sliders" size="20" />
          <span>专业 Web Audio 均衡器 (EQ)</span>
        </div>
        <div class="eq-header-actions">
          <label class="eq-switch-label">
            <input v-model="store.enabled" type="checkbox" />
            <span class="eq-switch-text">{{ store.enabled ? '音效生效中' : '音效已旁路' }}</span>
          </label>
          <button class="ghost close-btn" title="关闭" @click="emit('close')">
            <Icon name="close" size="18" />
          </button>
        </div>
      </header>

      <!-- 预设选择器 -->
      <div class="eq-presets-bar">
        <span class="preset-label">音效预设：</span>
        <div class="preset-buttons">
          <button
            v-for="p in PRESET_OPTIONS"
            :key="p.key"
            class="preset-btn"
            :class="{ active: store.preset === p.key }"
            :disabled="!store.enabled && p.key !== 'custom'"
            @click="store.setPreset(p.key)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>

      <!-- 均衡器 9 段推子 -->
      <div class="eq-sliders-container" :class="{ disabled: !store.enabled }">
        <div v-for="(freq, idx) in EQ_FREQUENCIES" :key="freq" class="eq-band-col">
          <span class="gain-val">{{ (store.gains[idx] ?? 0) > 0 ? `+${store.gains[idx]}` : store.gains[idx] }}dB</span>
          <div class="slider-wrapper">
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              orient="vertical"
              :value="store.gains[idx]"
              :disabled="!store.enabled"
              @input="store.setBandGain(idx, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
          <span class="freq-label">{{ formatFreq(freq) }}</span>
        </div>
      </div>

      <!-- 额外重低音旋钮区 -->
      <div class="eq-extra-bar" :class="{ disabled: !store.enabled }">
        <div class="extra-item">
          <label>低音下潜增强 (Bass Boost): <span>+{{ store.bassBoost }}</span></label>
          <input
            v-model.number="store.bassBoost"
            type="range"
            min="0"
            max="10"
            step="1"
            :disabled="!store.enabled"
          />
        </div>
        <button class="ghost reset-btn" :disabled="!store.enabled" @click="store.reset">
          重置默认
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.eq-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #1919174d;
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: fadeIn 180ms ease;
}

.eq-drawer {
  width: min(840px, 96vw);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-lg);
  padding: 24px;
  margin-bottom: var(--player-height);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.eq-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.eq-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.eq-header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.eq-switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}

.eq-presets-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.preset-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.preset-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 160ms ease;
}

.preset-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-primary);
}

.preset-btn.active {
  background: var(--accent);
  color: var(--on-accent);
  border-color: var(--accent);
}

.eq-sliders-container {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 12px;
  padding: 20px 10px;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  transition: opacity 200ms ease;
}

.eq-sliders-container.disabled,
.eq-extra-bar.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.eq-band-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.gain-val {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  min-height: 16px;
}

.slider-wrapper {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.slider-wrapper input[type='range'] {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 120px;
  cursor: pointer;
}

.freq-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.eq-extra-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
}

.extra-item {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.extra-item span {
  color: var(--accent);
  font-weight: 600;
}

.extra-item input[type='range'] {
  width: 140px;
}

.reset-btn {
  font-size: 12px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
