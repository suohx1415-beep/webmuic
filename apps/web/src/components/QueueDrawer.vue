<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
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
  <aside v-if="props.open" class="drawer queue-drawer">
    <header>
      <Icon name="queue" size="18" style="color: var(--accent)" />
      <h3>播放队列</h3>
      <span class="queue-meta-pill">
        {{ player.queue.length }} 首 · {{ formatTime(totalDuration) }}
      </span>
      <span class="spacer" />
      <button
        class="ghost clear-btn"
        :disabled="player.queue.length === 0"
        title="清空队列"
        @click="player.clearQueue()"
      >
        清空
      </button>
      <button class="ghost close-btn" title="关闭" @click="emit('close')">
        <Icon name="close" size="16" />
      </button>
    </header>

    <div class="body">
      <div v-if="player.queue.length === 0" class="queue-empty">
        <Icon name="music" size="24" style="margin-bottom: 8px; opacity: 0.4" />
        <div>播放队列空空如也</div>
        <div class="small muted" style="margin-top: 4px">双击曲目或点击「＋」添加歌曲</div>
      </div>
      <div v-else class="queue-list">
        <div
          v-for="(track, i) in player.queue"
          :key="`${track.id}-${i}`"
          class="queue-item"
          :class="{ active: i === player.index }"
          @dblclick="playIndex(i)"
        >
          <div class="queue-idx">{{ i + 1 }}</div>
          <div style="min-width: 0">
            <div class="title" :title="track.title">
              {{ track.title }}
            </div>
            <div class="meta small muted">
              <PlatformBadge :platform="track.platform" compact />
              <span>{{ artistNames(track) }}</span>
              <span style="opacity: 0.4">·</span>
              <span>{{ formatTime(track.durationMs / 1000) }}</span>
            </div>
          </div>
          <div class="row" style="gap: 4px">
            <button class="ghost queue-action-btn" title="播放" @click.stop="playIndex(i)">
              <Icon :name="i === player.index && player.playing ? 'pause' : 'play'" size="14" />
            </button>
            <button class="ghost queue-action-btn" title="移除" @click.stop="player.removeAt(i)">
              <Icon name="close" size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.queue-meta-pill {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 2px 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
}

.clear-btn {
  font-size: 12px;
  padding: 4px 8px;
}

.close-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: var(--radius-sm);
}

.queue-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 13.5px;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.queue-idx {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.queue-action-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
}

.queue-action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}
</style>
