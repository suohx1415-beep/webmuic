<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const player = usePlayerStore();
const listRef = ref<HTMLElement | null>(null);

async function scrollToActive(): Promise<void> {
  const index = player.activeLyricIndex;
  if (!props.open || index < 0) return;
  await nextTick();
  const container = listRef.value;
  const line = container?.querySelector<HTMLElement>(`[data-line="${index}"]`);
  if (!container || !line) return;
  const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

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
    if (open) void scrollToActive();
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
    <div ref="listRef" class="body lyric-scroll-area">
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
        >
          <div class="line-text">{{ line.text }}</div>
          <div v-if="line.translation" class="trans">{{ line.translation }}</div>
        </div>
      </div>
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
  scroll-behavior: smooth;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 1) 15%,
    rgba(0, 0, 0, 1) 85%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    rgba(0, 0, 0, 1) 15%,
    rgba(0, 0, 0, 1) 85%,
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
</style>
