<script setup lang="ts">
import { computed } from 'vue';
import type { Track } from '@/api/types';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { artistNames, formatTime, qualityHint } from '@/format';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{
  tracks: Track[];
  /** 点击行时把哪一份列表作为播放队列 */
  queueContext?: Track[];
  emptyText?: string;
}>();

const emit = defineEmits<{ error: [message: string] }>();

const player = usePlayerStore();
const favorites = useFavoritesStore();

const context = computed(() => props.queueContext ?? props.tracks);

function isCurrent(track: Track): boolean {
  return player.current?.id === track.id;
}

function play(track: Track): void {
  player.playTrackList(context.value, track);
}

function enqueue(track: Track): void {
  const added = player.append([track]);
  if (added === 0) emit('error', `《${track.title}》已在队列中`);
}

function toggleFavorite(track: Track): void {
  const added = favorites.toggle(track);
  emit('error', added ? `已收藏《${track.title}》` : `已取消收藏《${track.title}》`);
}
</script>

<template>
  <div v-if="tracks.length === 0" class="muted" style="padding: 20px 4px">
    {{ emptyText ?? '没有曲目' }}
  </div>
  <div v-else class="track-list">
    <div
      v-for="(track, i) in tracks"
      :key="track.id"
      class="track-row"
      :class="{ active: isCurrent(track) }"
      @dblclick="play(track)"
    >
      <div class="idx">{{ i + 1 }}</div>
      <img class="cover" :src="track.album.coverUrl || ''" alt="" loading="lazy" />
      <div style="min-width: 0">
        <div class="title" :title="track.title">
          {{ track.title }}
          <span v-if="isCurrent(track) && player.playing" class="badge" style="margin-left: 6px">播放中</span>
        </div>
        <div class="meta" :title="`${artistNames(track)} · ${track.album.name}`">
          <PlatformBadge :platform="track.platform" compact />
          {{ artistNames(track) }} · {{ track.album.name }}
        </div>
      </div>
      <div class="actions">
        <span v-if="qualityHint(track)" class="badge quality">{{ qualityHint(track) }}</span>
        <button class="ghost" :title="favorites.has(track.id) ? '取消收藏' : '收藏'" @click="toggleFavorite(track)">
          {{ favorites.has(track.id) ? '★' : '☆' }}
        </button>
        <button class="ghost" title="加入队列" @click="enqueue(track)">＋</button>
        <button class="ghost" title="播放" @click="play(track)">▶</button>
        <span class="duration">{{ formatTime(track.durationMs / 1000) }}</span>
      </div>
    </div>
  </div>
</template>
