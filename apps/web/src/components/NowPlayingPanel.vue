<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import { artistNames, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';
import { useFavoritesStore } from '@/stores/favorites';

const emit = defineEmits<{ openLyric: []; openQueue: []; seek: [seconds: number] }>();
const player = usePlayerStore();
const favorites = useFavoritesStore();
const lines = computed(() => {
  const start = Math.max(0, player.activeLyricIndex - 1);
  return player.lyric.slice(start, start + 3).map((line, offset) => ({ ...line, index: start + offset }));
});
const upcoming = computed(() => player.queue.slice(player.index + 1, player.index + 4));
</script>

<template>
  <aside v-if="player.current" class="now-panel" aria-label="正在播放">
    <header><h2>正在播放</h2><button class="ghost" aria-label="打开播放队列" @click="emit('openQueue')"><Icon name="queue" size="17" /></button></header>
    <button class="now-cover" aria-label="展开歌词" @click="emit('openLyric')">
      <img v-if="player.current.album.coverUrl" :src="player.current.album.coverUrl" :alt="player.current.album.name || player.current.title">
      <Icon v-else name="music" size="64" />
    </button>
    <div class="now-heading">
      <h3>{{ player.current.title }}</h3>
      <button class="ghost" :aria-label="favorites.has(player.current.id) ? '取消收藏' : '收藏'" :aria-pressed="favorites.has(player.current.id)" @click="favorites.toggle(player.current)">
        <Icon :name="favorites.has(player.current.id) ? 'heart-filled' : 'heart'" size="18" />
      </button>
    </div>
    <p class="now-artist">{{ artistNames(player.current) }}</p>
    <div v-if="lines.length" class="now-lyrics">
      <button v-for="line in lines" :key="line.index" :class="{ active: line.index === player.activeLyricIndex }" @click="emit('seek', line.time)">{{ line.text }}</button>
    </div>
    <button class="ghost now-expand" @click="emit('openLyric')">展开歌词 <Icon name="external" size="13" /></button>
    <template v-if="upcoming.length">
      <header class="up-next"><h2>接下来播放</h2><button class="ghost" @click="emit('openQueue')">{{ player.queue.length }} 首</button></header>
      <button v-for="(track, offset) in upcoming" :key="track.id" class="next-track" @click="player.playAt(player.index + offset + 1)">
        <img v-if="track.album.coverUrl" :src="track.album.coverUrl" alt="" loading="lazy">
        <span v-else class="next-placeholder"><Icon name="music" size="18" /></span>
        <span class="next-meta"><strong>{{ track.title }}</strong><span>{{ artistNames(track) }}</span></span>
        <time>{{ formatTime(track.durationMs / 1000) }}</time>
      </button>
    </template>
  </aside>
</template>

<style scoped>
.now-panel{position:sticky;top:0;align-self:start;min-width:0;border-left:1px solid var(--border-default);padding-left:26px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}header h2{font-size:13px;font-weight:500;margin:0}header button{font-size:11px;padding:4px}
.now-cover{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1;padding:0;border:0;border-radius:10px;background:var(--bg-elevated);color:var(--accent);overflow:hidden;box-shadow:6px 7px 0 var(--bg-elevated)}.now-cover img{width:100%;height:100%;object-fit:cover}
.now-heading{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-top:23px}.now-heading h3{font-size:19px;font-weight:600;margin:0;overflow-wrap:anywhere}.now-heading button{padding:6px;flex-shrink:0}.now-heading [aria-pressed=true]{color:var(--accent)}.now-artist{font-size:12px;color:var(--text-secondary);margin:5px 0 0}
.now-lyrics{display:flex;flex-direction:column;justify-content:center;gap:14px;min-height:155px;padding:24px 0 12px}.now-lyrics button{padding:0;background:none;border:0;font-size:12px;color:var(--text-secondary);line-height:1.8;display:block}.now-lyrics .active{color:var(--accent);font-size:14px;font-weight:600}.now-expand{margin:14px auto 24px;display:flex;font-size:11px}.up-next{border-top:1px solid var(--border-default);padding-top:20px;margin-bottom:12px}.next-track{display:flex;width:100%;border:0;background:none;gap:10px;padding:9px 0;text-align:left;justify-content:flex-start}.next-track img,.next-placeholder{width:36px;height:36px;border-radius:5px;object-fit:cover;flex-shrink:0}.next-placeholder{display:grid;place-items:center;background:var(--bg-elevated)}.next-meta{display:flex;flex-direction:column;min-width:0;flex:1;gap:4px}.next-meta strong{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.next-meta>span,.next-track time{font-size:10px;color:var(--text-secondary)}
@media(max-width:1199px){.now-panel{display:none}}
</style>
