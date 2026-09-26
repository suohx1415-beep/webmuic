<script setup lang="ts">
import TrackList from '@/components/TrackList.vue';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();

const favorites = useFavoritesStore();
const player = usePlayerStore();

function playAll(): void {
  if (favorites.tracks.length === 0) return;
  player.setQueue(favorites.tracks, 0);
  player.playing = true;
  emit('notify', `已把收藏的 ${favorites.tracks.length} 首加入队列`);
}

function clearAll(): void {
  const count = favorites.tracks.length;
  favorites.clear();
  emit('notify', `已清空 ${count} 首收藏`);
}
</script>

<template>
  <h1 class="page-title">收藏</h1>
  <p class="page-sub">收藏只保存在这个浏览器的本地存储里，不上传、不同步。</p>

  <div class="row" style="margin-bottom: 16px">
    <button class="primary" :disabled="favorites.tracks.length === 0" @click="playAll">播放全部</button>
    <button :disabled="favorites.tracks.length === 0" @click="clearAll">清空收藏</button>
  </div>

  <TrackList
    :tracks="favorites.tracks"
    empty-text="还没有收藏。在曲目行上点 ☆ 即可收藏。"
    @error="emit('notify', $event)"
  />
</template>
