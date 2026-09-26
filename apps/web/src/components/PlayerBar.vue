<script setup lang="ts">
import { computed } from 'vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { artistNames, formatBytes, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{
  queueOpen: boolean;
  lyricOpen: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  seek: [seconds: number];
  openQueue: [];
  openLyric: [];
}>();

const player = usePlayerStore();
const settings = useSettingsStore();

const progressPercent = computed(() => {
  const total = player.duration;
  if (!total || total <= 0) return 0;
  return Math.min(100, (player.currentTime / total) * 100);
});

const modeLabel = computed(
  () =>
    ({
      sequential: '顺序播放',
      'repeat-one': '单曲循环',
      'repeat-all': '列表循环',
      shuffle: '随机播放',
    })[player.mode],
);

const MODES = ['sequential', 'repeat-one', 'repeat-all', 'shuffle'] as const;

function cycleMode(): void {
  const currentIndex = MODES.indexOf(player.mode);
  player.mode = MODES[(currentIndex + 1) % MODES.length] ?? 'sequential';
}

function onProgressInput(event: Event): void {
  emit('seek', Number((event.target as HTMLInputElement).value));
}

function onVolumeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  settings.volume = value;
  settings.muted = value === 0;
}
</script>

<template>
  <div class="player-bar">
    <img class="player-cover" :src="player.current?.album.coverUrl || ''" alt="" />

    <div class="player-meta">
      <div class="title" :title="player.current?.title">
        {{ player.current?.title ?? '未在播放' }}
      </div>
      <div class="artist">
        <template v-if="player.current">
          <PlatformBadge :platform="player.current.platform" compact />
          {{ artistNames(player.current) }}
        </template>
        <template v-else>从搜索或发现页选一首开始</template>
      </div>
      <div class="small muted" style="margin-top: 2px">
        <template v-if="player.resolved">
          <span class="badge quality">{{ player.resolved.qualityLabel }}</span>
          <span v-if="player.resolved.size" style="margin-left: 6px">{{ formatBytes(player.resolved.size) }}</span>
        </template>
      </div>
    </div>

    <div class="player-center">
      <div class="controls">
        <button class="ghost" :title="modeLabel" @click="cycleMode">{{ player.mode === 'shuffle' ? '🔀' : player.mode === 'repeat-one' ? '🔂' : player.mode === 'repeat-all' ? '🔁' : '➡' }}</button>
        <button class="ghost" title="上一首" @click="player.previous()">⏮</button>
        <button class="play" :title="player.playing ? '暂停' : '播放'" :disabled="!player.current || player.loadingUrl" @click="emit('toggle')">
          {{ player.loadingUrl ? '⋯' : player.playing ? '⏸' : '▶' }}
        </button>
        <button class="ghost" title="下一首" @click="player.advance(true)">⏭</button>
        <button class="ghost" :class="{ active: props.lyricOpen }" title="歌词" @click="emit('openLyric')">词</button>
        <button class="ghost" :class="{ active: props.queueOpen }" title="队列" @click="emit('openQueue')">
          队列<template v-if="player.queue.length"> · {{ player.queue.length }}</template>
        </button>
      </div>

      <div class="progress">
        <span>{{ formatTime(player.currentTime) }}</span>
        <input
          type="range"
          min="0"
          :max="Math.max(player.duration, 0)"
          step="0.5"
          :value="player.currentTime"
          :disabled="!player.current"
          :style="{ backgroundSize: `${progressPercent}% 100%` }"
          @input="onProgressInput"
        />
        <span>{{ formatTime(player.duration) }}</span>
      </div>

      <div v-if="player.degradedNotice" class="small" style="text-align: center; color: var(--warn)">
        {{ player.degradedNotice }}
      </div>
    </div>

    <div class="volume">
      <button class="ghost" :title="settings.muted ? '取消静音' : '静音'" @click="settings.muted = !settings.muted">
        {{ settings.muted || settings.volume === 0 ? '🔇' : '🔊' }}
      </button>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="settings.muted ? 0 : settings.volume"
        @input="onVolumeInput"
      />
    </div>
  </div>
</template>
