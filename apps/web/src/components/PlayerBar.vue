<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
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
  return Math.min(100, Math.max(0, (player.currentTime / total) * 100));
});

const volumePercent = computed(() => {
  if (settings.muted) return 0;
  return Math.min(100, Math.max(0, settings.volume * 100));
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

const modeIconName = computed(() => {
  switch (player.mode) {
    case 'shuffle':
      return 'shuffle';
    case 'repeat-one':
      return 'repeat-one';
    case 'repeat-all':
      return 'repeat';
    default:
      return 'sequential';
  }
});

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
  <footer class="player-bar">
    <!-- 左侧：曲目信息与专辑光效 -->
    <div class="player-track-info">
      <div class="player-cover-box">
        <div
          v-if="player.current?.album.coverUrl"
          class="player-cover-glow"
          :style="{ backgroundImage: `url(${player.current.album.coverUrl})` }"
        />
        <img
          v-if="player.current?.album.coverUrl"
          class="player-cover"
          :src="player.current.album.coverUrl"
          alt="Album Art"
        />
        <div v-else class="player-cover placeholder-disc">
          <Icon name="music" size="20" />
        </div>
      </div>

      <div class="player-meta">
        <div class="player-title" :title="player.current?.title">
          {{ player.current?.title ?? '暂无播放' }}
        </div>
        <div class="player-artist">
          <template v-if="player.current">
            <PlatformBadge :platform="player.current.platform" compact />
            <span class="artist-text" :title="artistNames(player.current)">{{ artistNames(player.current) }}</span>
          </template>
          <template v-else>
            <span class="artist-text">从推荐或搜索中挑选歌曲</span>
          </template>
        </div>
        <div v-if="player.resolved" class="player-stream-info">
          <span class="quality-badge" :class="player.resolved.quality.toLowerCase()">
            {{ player.resolved.qualityLabel }}
          </span>
          <span v-if="player.resolved.size">{{ formatBytes(player.resolved.size) }}</span>
        </div>
      </div>
    </div>

    <!-- 中间：控制按键与进度条 -->
    <div class="player-center">
      <div class="controls-row">
        <!-- 循环模式 -->
        <button
          class="transport-btn"
          :title="modeLabel"
          @click="cycleMode"
        >
          <Icon :name="modeIconName" size="16" />
        </button>

        <!-- 上一首 -->
        <button
          class="transport-btn"
          title="上一首"
          :disabled="!player.current"
          @click="player.previous()"
        >
          <Icon name="prev" size="17" />
        </button>

        <!-- 播放/暂停大按键 -->
        <button
          class="transport-btn play-main"
          :title="player.playing ? '暂停' : '播放'"
          :disabled="!player.current || player.loadingUrl"
          @click="emit('toggle')"
        >
          <span v-if="player.loadingUrl" class="loading-spin">⋯</span>
          <Icon v-else :name="player.playing ? 'pause' : 'play'" size="18" />
        </button>

        <!-- 下一首 -->
        <button
          class="transport-btn"
          title="下一首"
          :disabled="!player.current"
          @click="player.advance(true)"
        >
          <Icon name="next" size="17" />
        </button>

        <!-- 歌词开关 -->
        <button
          class="transport-btn"
          :class="{ active: props.lyricOpen }"
          title="查看歌词"
          @click="emit('openLyric')"
        >
          <Icon name="lyrics" size="16" />
        </button>

        <!-- 队列开关 -->
        <button
          class="transport-btn"
          :class="{ active: props.queueOpen }"
          title="播放队列"
          @click="emit('openQueue')"
        >
          <Icon name="queue" size="16" />
          <span v-if="player.queue.length" class="queue-count-badge">{{ player.queue.length }}</span>
        </button>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar-wrap">
        <span>{{ formatTime(player.currentTime) }}</span>
        <div class="progress-track-container">
          <div class="progress-track-bg">
            <div class="progress-track-fill" :style="{ width: `${progressPercent}%` }" />
          </div>
          <input
            type="range"
            min="0"
            :max="Math.max(player.duration, 0)"
            step="0.5"
            :value="player.currentTime"
            :disabled="!player.current"
            @input="onProgressInput"
          />
        </div>
        <span>{{ formatTime(player.duration) }}</span>
      </div>

      <!-- 降级提示 -->
      <div v-if="player.degradedNotice" class="degraded-notice">
        {{ player.degradedNotice }}
      </div>
    </div>

    <!-- 右侧：音量与面板快捷操作 -->
    <div class="player-actions">
      <div class="volume-control">
        <button
          class="transport-btn"
          style="width: 28px; height: 28px"
          :title="settings.muted ? '取消静音' : '静音'"
          @click="settings.muted = !settings.muted"
        >
          <Icon :name="settings.muted || settings.volume === 0 ? 'volume-mute' : 'volume'" size="16" />
        </button>
        <div class="volume-slider-wrap">
          <div class="volume-track-bg">
            <div class="volume-track-fill" :style="{ width: `${volumePercent}%` }" />
          </div>
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
    </div>
  </footer>
</template>

<style scoped>
.placeholder-disc {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  border: 1px dashed var(--border-default);
}

.artist-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-count-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  font-size: 9px;
  line-height: 1;
  padding: 1px 4px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}

.transport-btn {
  position: relative;
}

.loading-spin {
  font-size: 16px;
  animation: pulse 1s infinite alternate;
}

@keyframes pulse {
  from {
    opacity: 0.4;
  }
  to {
    opacity: 1;
  }
}

.degraded-notice {
  font-size: 11px;
  color: var(--warn);
  text-align: center;
  max-width: 480px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
