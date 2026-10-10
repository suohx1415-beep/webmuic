<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { useDesktopLyricPip } from '@/composables/useDesktopLyricPip';
import { artistNames, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{
  queueOpen: boolean;
  lyricOpen: boolean;
  eqOpen?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  seek: [seconds: number];
  openQueue: [];
  openLyric: [];
  openEq: [];
  switchSource: [];
  notify: [message: string];
}>();

const player = usePlayerStore();
const settings = useSettingsStore();
const { isPipActive, isSupported: isPipSupported, togglePip } = useDesktopLyricPip();

const progressPercent = computed(() => {
  const total = player.duration;
  if (!total || total <= 0) return 0;
  const current = isDraggingProgress.value ? scrubbingTime.value : player.currentTime;
  return Math.min(100, Math.max(0, (current / total) * 100));
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

const chorus = computed(() => player.current?.chorus);

const chorusPercent = computed(() => {
  if (!chorus.value || !player.duration || player.duration <= 0) return null;
  const ratio = (chorus.value.startTimeMs / 1000) / player.duration;
  if (ratio <= 0.005 || ratio >= 0.995) return null;
  return Number((ratio * 100).toFixed(2));
});

const isPlayingChorus = computed(() => {
  if (!chorus.value) return false;
  const curMs = player.currentTime * 1000;
  const start = chorus.value.startTimeMs;
  const end = chorus.value.endTimeMs ?? (start + 30000);
  return curMs >= start && curMs <= end;
});

function seekToChorus(): void {
  if (!chorus.value) return;
  emit('seek', chorus.value.startTimeMs / 1000);
  if (!player.playing) {
    emit('toggle');
  }
}

function cycleMode(): void {
  const currentIndex = MODES.indexOf(player.mode);
  player.mode = MODES[(currentIndex + 1) % MODES.length] ?? 'sequential';
}

const isDraggingProgress = ref(false);
const scrubbingTime = ref(0);

function onProgressInput(event: Event): void {
  isDraggingProgress.value = true;
  scrubbingTime.value = Number((event.target as HTMLInputElement).value);
}

function onProgressChange(event: Event): void {
  isDraggingProgress.value = false;
  emit('seek', Number((event.target as HTMLInputElement).value));
}

function onVolumeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  settings.volume = value;
  settings.muted = value === 0;
}

function downloadCurrentTrack(): void {
  if (!player.current) return;
  const url = `/api/stream/${encodeURIComponent(player.current.id)}?quality=${settings.quality}&download=1`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
import { offlineStorage } from '@/offlineStorage';

const isCaching = ref(false);
const moreOpen = ref(false);

async function cacheCurrentTrack(): Promise<void> {
  const track = player.current;
  if (!track || isCaching.value) return;
  isCaching.value = true;
  try {
    const isAlready = await offlineStorage.hasTrack(track.id);
    if (isAlready) {
      await offlineStorage.removeTrack(track.id);
      emit('notify', `已移除《${track.title}》的离线缓存`);
      return;
    }
    emit('notify', `正在离线缓存《${track.title}》…`);
    const streamRes = await fetch(`/api/stream/${encodeURIComponent(track.id)}?quality=${settings.quality}`);
    if (!streamRes.ok) throw new Error(`HTTP ${streamRes.status}`);
    const blob = await streamRes.blob();
    await offlineStorage.saveTrack(track, blob, settings.quality);
    emit('notify', `《${track.title}》已成功缓存至本地，断网亦可秒播！`);
  } catch (e) {
    emit('notify', `离线缓存失败：${e instanceof Error ? e.message : '网络异常'}`);
  } finally {
    isCaching.value = false;
  }
}
</script>

<template>
  <footer class="player-bar">
    <!-- 左侧：曲目信息与专辑光效 -->
    <div class="player-track-info">
      <button class="player-cover-box" :disabled="!player.current" :aria-expanded="props.lyricOpen" aria-label="打开沉浸播放" title="打开沉浸播放" @click="emit('openLyric')">
        <div
          v-if="player.current?.album.coverUrl"
          class="player-cover-glow"
          :style="{ backgroundImage: `url(${player.current.album.coverUrl})` }"
        />
        <img
          v-if="player.current?.album.coverUrl"
          class="player-cover"
          :src="player.current.album.coverUrl"
          :alt="`${player.current?.title ?? ''} 封面`"
        />
        <div v-else class="player-cover placeholder-disc">
          <Icon name="music" size="20" />
        </div>
        <span class="cover-expand" aria-hidden="true"><Icon name="external" size="18" /></span>
      </button>

      <div class="player-meta">
        <div class="player-title" :title="player.current?.title">
          {{ player.current?.title ?? '暂无播放' }}
        </div>
        <div class="player-artist">
          <template v-if="player.current">
            <PlatformBadge :platform="player.current.platform" compact />
            <span class="artist-text" :title="artistNames(player.current)">{{ artistNames(player.current) }}</span>
            <span v-if="player.resolved" class="quality-badge" :class="player.resolved.quality.toLowerCase()">
              {{ player.resolved.qualityLabel }}
            </span>
          </template>
          <template v-else>
            <span class="artist-text">从推荐或搜索中挑选歌曲</span>
          </template>
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

        <!-- 副歌高潮一键直达 -->
        <button
          v-if="chorus"
          class="chorus-badge-btn"
          :class="{ active: isPlayingChorus }"
          :title="`跳至副歌高潮 (${formatTime(chorus.startTimeMs / 1000)})`"
          @click="seekToChorus"
        >
          <Icon name="flame" size="13" />
          <span>副歌 {{ formatTime(chorus.startTimeMs / 1000) }}</span>
        </button>

        <!-- 歌词开关 -->
        <button
          class="transport-btn"
          :class="{ active: props.lyricOpen }"
          :title="props.lyricOpen ? '退出沉浸播放' : '沉浸播放与歌词'"
          :aria-pressed="props.lyricOpen"
          @click="emit('openLyric')"
        >
          <Icon name="lyrics" size="16" />
        </button>

        <!-- 队列开关 -->
        <button
          class="transport-btn"
          :class="{ active: props.queueOpen }"
          title="播放队列"
          :aria-expanded="props.queueOpen"
          @click="emit('openQueue')"
        >
          <Icon name="queue" size="16" />
          <span v-if="player.queue.length" class="queue-count-badge">{{ player.queue.length }}</span>
        </button>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar-wrap">
        <span>{{ formatTime(isDraggingProgress ? scrubbingTime : player.currentTime) }}</span>
        <div class="progress-track-container">
          <div class="progress-track-bg">
            <div class="progress-track-fill" :style="{ width: `${progressPercent}%` }" />
          </div>
          <!-- 副歌高潮点锚点标记 -->
          <div
            v-if="chorusPercent !== null"
            class="chorus-track-marker"
            :class="{ active: isPlayingChorus }"
            :style="{ left: `${chorusPercent}%` }"
            :title="`高潮副歌 ${formatTime(chorus!.startTimeMs / 1000)}（点击跳跃）`"
            @click.stop="seekToChorus"
          >
            <div class="chorus-track-marker-pin" />
            <div class="chorus-tooltip">
              <span class="chorus-tooltip-icon">🔥</span>
              <span>高潮 {{ formatTime(chorus!.startTimeMs / 1000) }}</span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            :max="Math.max(player.duration, 0)"
            step="0.5"
            :value="isDraggingProgress ? scrubbingTime : player.currentTime"
            :disabled="!player.current || player.loadingUrl || !player.streamUrl"
            aria-label="播放进度"
            :aria-valuetext="`${formatTime(isDraggingProgress ? scrubbingTime : player.currentTime)} / ${formatTime(player.duration)}`"
            @input="onProgressInput"
            @change="onProgressChange"
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
            aria-label="音量"
            @input="onVolumeInput"
          />
        </div>
      </div>

      <button
        v-if="isPipSupported"
        class="transport-btn"
        :class="{ active: isPipActive }"
        style="width: 28px; height: 28px"
        :title="isPipActive ? '关闭桌面歌词' : '开启桌面歌词 (画中画置顶小窗)'"
        @click="togglePip"
      >
        <Icon name="pip" size="16" />
      </button>

      <button
        class="transport-btn eq-toggle"
        :class="{ active: props.eqOpen }"
        style="width: 28px; height: 28px"
        title="打开专业音频均衡器 (EQ)"
        @click="emit('openEq')"
      >
        <Icon name="sliders" size="16" />
      </button>

      <button
        v-if="player.current"
        class="transport-btn"
        :disabled="isCaching"
        style="width: 28px; height: 28px"
        title="离线缓存 / 移除离线文件"
        @click="cacheCurrentTrack"
      >
        <Icon name="offline" size="16" />
      </button>

      <button
        v-if="player.current"
        class="transport-btn"
        style="width: 28px; height: 28px"
        title="下载当前音频文件"
        @click="downloadCurrentTrack"
      >
        <Icon name="download" size="16" />
      </button>

      <button
        v-if="player.current"
        class="transport-btn"
        style="width: 28px; height: 28px"
        title="跨平台换源（自动寻找另一平台匹配曲目）"
        @click="emit('switchSource')"
      >
        <Icon name="refresh" size="16" />
      </button>
      <button class="transport-btn more-toggle" aria-label="更多播放操作" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">•••</button>
      <div v-if="moreOpen" class="player-more" @keydown.esc="moreOpen = false">
        <button :disabled="!player.current || isCaching" @click="cacheCurrentTrack(); moreOpen = false"><Icon name="offline" size="16" />离线缓存</button>
        <button :disabled="!player.current" @click="downloadCurrentTrack(); moreOpen = false"><Icon name="download" size="16" />下载音频</button>
        <button :disabled="!player.current" @click="emit('switchSource'); moreOpen = false"><Icon name="refresh" size="16" />切换来源</button>
        <button v-if="isPipSupported" @click="togglePip(); moreOpen = false"><Icon name="pip" size="16" />桌面歌词</button>
        <button @click="settings.muted = !settings.muted">{{ settings.muted ? '取消静音' : '静音' }}</button>
        <button @click="moreOpen = false">收起</button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.more-toggle { display: none; }
.player-more { position: absolute; bottom: calc(100% + 10px); right: 0; width: 170px; padding: 8px; border: 1px solid var(--border-default); background: var(--bg-surface); box-shadow: var(--shadow-lg); border-radius: 10px; display: flex; flex-direction: column; gap: 3px; }
.player-more button { justify-content: flex-start; border: 0; background: transparent; padding: 10px; }
@media (max-width: 768px) { .more-toggle { display: inline-flex; } }
.player-cover-box {
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: var(--radius-sm);
}
.cover-expand {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  background: #19191766;
  border-radius: inherit;
  color: #fffefb;
  opacity: 0;
  transition: opacity 160ms ease;
}
.player-cover-box:hover .cover-expand,
.player-cover-box:focus-visible .cover-expand { opacity: 1; }
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
  color: var(--on-accent);
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

/* 控制栏副歌高潮一键直达小胶囊 */
.chorus-badge-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--warn);
  background: var(--warn-soft);
  border: 1px solid var(--warn-border);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  flex-shrink: 0;
}

.chorus-badge-btn:hover {
  background: var(--warn-soft);
  border-color: var(--warn);
  transform: translateY(-1px);
}

.chorus-badge-btn.active {
  color: var(--on-accent);
  background: var(--warn);
  border-color: var(--warn);
}


/* 进度条上的副歌高潮锚点 */
.chorus-track-marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  cursor: pointer;
}

.chorus-track-marker-pin {
  width: 4px;
  height: 10px;
  border-radius: 999px;
  background: var(--warn);
  box-shadow: 0 0 0 2px var(--bg-surface);
  transition: all 0.15s ease;
}

.progress-track-container:hover .chorus-track-marker-pin,
.chorus-track-marker:hover .chorus-track-marker-pin {
  height: 14px;
  width: 5px;
  box-shadow: 0 0 0 2px var(--bg-surface);
}

.chorus-track-marker.active .chorus-track-marker-pin {
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--bg-surface);
}


/* 悬浮气泡 */
.chorus-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  opacity: 0;
  pointer-events: none;
  background: var(--text-primary);
  border: 0;
  color: var(--bg-canvas);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: var(--shadow-md);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  align-items: center;
  gap: 4px;
}

.chorus-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: var(--text-primary);
}

.chorus-track-marker:hover .chorus-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.chorus-tooltip-icon {
  font-size: 12px;
}
</style>
