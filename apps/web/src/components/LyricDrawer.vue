<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const player = usePlayerStore();
const listRef = ref<HTMLElement | null>(null);

/** 当前行变化时把它滚到可视区中部 */
watch(
  () => player.activeLyricIndex,
  async (index) => {
    if (!props.open || index < 0) return;
    await nextTick();
    const container = listRef.value;
    const line = container?.querySelector<HTMLElement>(`[data-line="${index}"]`);
    if (!container || !line) return;
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  },
);
</script>

<template>
  <aside v-if="props.open" class="drawer">
    <header>
      <strong>歌词</strong>
      <span class="muted small">{{ player.current?.title ?? '未在播放' }}</span>
      <span class="spacer" />
      <button class="ghost" title="关闭" @click="emit('close')">✕</button>
    </header>
    <div ref="listRef" class="body">
      <div v-if="player.lyricError" class="muted">{{ player.lyricError }}</div>
      <div v-else-if="player.lyric.length === 0" class="muted">暂无歌词。</div>
      <div v-else class="lyric-lines">
        <div
          v-for="(line, i) in player.lyric"
          :key="i"
          class="lyric-line"
          :class="{ active: i === player.activeLyricIndex }"
          :data-line="i"
        >
          {{ line.text }}
          <span v-if="line.translation" class="trans">{{ line.translation }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
