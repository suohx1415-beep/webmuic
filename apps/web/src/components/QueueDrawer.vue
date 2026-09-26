<script setup lang="ts">
import { computed } from 'vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { artistNames, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const player = usePlayerStore();

const totalDuration = computed(() =>
  player.queue.reduce((sum, t) => sum + t.durationMs / 1000, 0),
);

function playIndex(i: number): void {
  player.playAt(i);
}
</script>

<template>
  <aside v-if="props.open" class="drawer">
    <header>
      <strong>播放队列</strong>
      <span class="muted small">
        {{ player.queue.length }} 首 · {{ formatTime(totalDuration) }}
      </span>
      <span class="spacer" />
      <button class="ghost" title="清空队列" @click="player.clearQueue()">清空</button>
      <button class="ghost" title="关闭" @click="emit('close')">✕</button>
    </header>
    <div class="body">
      <div v-if="player.queue.length === 0" class="muted">队列为空。</div>
      <div
        v-for="(track, i) in player.queue"
        :key="`${track.id}-${i}`"
        class="queue-item"
        :class="{ active: i === player.index }"
      >
        <div style="min-width: 0" @dblclick="playIndex(i)">
          <div class="title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ i + 1 }}. {{ track.title }}
          </div>
          <div class="meta small muted" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            <PlatformBadge :platform="track.platform" compact />
            {{ artistNames(track) }} · {{ formatTime(track.durationMs / 1000) }}
          </div>
        </div>
        <div class="row">
          <button class="ghost" title="播放" @click="playIndex(i)">▶</button>
          <button class="ghost" title="移除" @click="player.removeAt(i)">✕</button>
        </div>
      </div>
    </div>
  </aside>
</template>
