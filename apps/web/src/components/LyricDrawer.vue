<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; seek: [seconds: number] }>();

const player = usePlayerStore();
const listRef = ref<HTMLElement | null>(null);
const isUserScrolling = ref(false);
let resumeTimer: number | undefined;

async function scrollToActive(force = false): Promise<void> {
  if (!force && isUserScrolling.value) return;
  const index = player.activeLyricIndex;
  if (!props.open || index < 0) return;
  await nextTick();
  const container = listRef.value;
  const line = container?.querySelector<HTMLElement>(`[data-line="${index}"]`);
  if (!container || !line) return;
  const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

function onManualScroll(): void {
  isUserScrolling.value = true;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = window.setTimeout(() => {
    isUserScrolling.value = false;
    void scrollToActive();
  }, 4000);
}

function resumeAutoScroll(): void {
  isUserScrolling.value = false;
  if (resumeTimer) clearTimeout(resumeTimer);
  void scrollToActive(true);
}

function onLineClick(line: { time: number }): void {
  emit('seek', line.time);
  if (!player.playing) {
    player.playing = true;
  }
  isUserScrolling.value = false;
  void scrollToActive(true);
}

onBeforeUnmount(() => {
  if (resumeTimer) clearTimeout(resumeTimer);
});

/** 当前行变化或抽屉打开时滚到可视区中部 */
watch(
  () => player.activeLyricIndex,
  () => {
    void scrollToActive();
  },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      isUserScrolling.value = false;
      void scrollToActive(true);
    }
  },
);
</script>

<template>
  <aside v-if="props.open" class="drawer lyric-drawer">
    <!-- 头部 -->
    <header>
      <Icon name="lyrics" size="18" style="color: var(--accent)" />
      <h3>歌词</h3>
      <span class="muted small header-song-title" :title="player.current?.title">
        {{ player.current ? `· ${player.current.title}` : '' }}
      </span>
      <span class="spacer" />
      <button class="ghost close-btn" title="关闭" @click="emit('close')">
        <Icon name="close" size="16" />
      </button>
    </header>

    <!-- 歌词正文 -->
    <div
      ref="listRef"
      class="body lyric-scroll-area"
      @wheel="onManualScroll"
      @touchstart="onManualScroll"
    >
      <div v-if="player.lyricError" class="lyric-state-message">
        {{ player.lyricError }}
      </div>
      <div v-else-if="player.lyric.length === 0" class="lyric-state-message">
        {{ player.current ? '暂无歌词或纯音乐' : '未在播放歌曲' }}
      </div>
      <div v-else class="lyric-container">
        <div
          v-for="(line, i) in player.lyric"
          :key="i"
          class="lyric-line"
          :class="{ active: i === player.activeLyricIndex }"
          :data-line="i"
          :title="`点击跳转播放至 ${formatTime(line.time)}`"
          @click="onLineClick(line)"
        >
          <div class="line-content">
            <span class="line-text">{{ line.text }}</span>
          </div>
          <div v-if="line.translation" class="trans">{{ line.translation }}</div>
        </div>
      </div>

      <!-- 回到正在播放悬浮按钮 -->
      <transition name="fade">
        <button
          v-if="isUserScrolling && player.activeLyricIndex >= 0"
          type="button"
          class="resume-scroll-pill"
          @click="resumeAutoScroll"
        >
          <Icon name="play" size="13" />
          <span>回到正在播放</span>
        </button>
      </transition>
    </div>
  </aside>
</template>

<style scoped>
.header-song-title {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: var(--radius-sm);
}

.lyric-scroll-area {
  position: relative;
  scroll-behavior: smooth;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 1) 12%,
    rgba(0, 0, 0, 1) 88%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 1) 12%,
    rgba(0, 0, 0, 1) 88%,
    transparent 100%
  );
}

.lyric-state-message {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 14px;
}

.resume-scroll-pill {
  position: sticky;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  z-index: 10;
  transition: transform var(--transition-fast), background var(--transition-fast);
}

.resume-scroll-pill:hover {
  transform: translateX(-50%) scale(1.05);
  background: var(--accent-hover, #ff4b60);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
