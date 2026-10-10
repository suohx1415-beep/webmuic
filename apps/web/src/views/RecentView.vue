<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Track } from '@/api/types';
import Icon from '@/components/Icon.vue';
import TrackList from '@/components/TrackList.vue';
import { useHistoryStore } from '@/stores/history';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();
const history = useHistoryStore();
const player = usePlayerStore();
const tab = ref<'recent' | 'weekly'>('recent');

const DAY_MS = 24 * 60 * 60 * 1000;

/** 按「今天 / 昨天 / 本周 / 更早」分组 */
const groups = computed(() => {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const buckets: { label: string; tracks: Track[] }[] = [
    { label: '今天', tracks: [] },
    { label: '昨天', tracks: [] },
    { label: '本周', tracks: [] },
    { label: '更早', tracks: [] },
  ];
  for (const entry of history.recent) {
    const t = entry.lastPlayedAt;
    const bucket = t >= startOfToday ? 0 : t >= startOfToday - DAY_MS ? 1 : t >= startOfToday - 6 * DAY_MS ? 2 : 3;
    buckets[bucket]!.tracks.push(entry.track);
  }
  return buckets.filter((b) => b.tracks.length > 0);
});

const allRecentTracks = computed(() => history.recent.map((e) => e.track));
const weeklyTracks = computed(() => history.weeklyTop.slice(0, 30).map((item) => item.entry.track));
const weeklyCounts = computed(() => new Map(history.weeklyTop.map((item) => [item.entry.track.id, item.weekly])));
const totalWeekPlays = computed(() => history.weeklyTop.reduce((sum, item) => sum + item.weekly, 0));

function playAll(tracks: Track[]): void {
  const first = tracks[0];
  if (first) player.playTrackList(tracks, first);
}

function removeEntry(track: Track): void {
  history.remove(track.id);
  emit('notify', `已从最近播放中移除《${track.title}》`);
}

function clearAll(): void {
  if (!window.confirm('确定清空全部播放记录吗？此操作不可撤销。')) return;
  history.clear();
  emit('notify', '播放记录已清空');
}
</script>

<template>
  <div class="page-header recent-header">
    <div>
      <h1 class="page-title">最近播放</h1>
      <p class="recent-sub">听满 30 秒才会记一次，只保存在这台电脑的浏览器里。</p>
    </div>
    <button v-if="history.entries.length" class="ghost" @click="clearAll"><Icon name="trash" size="15" />清空记录</button>
  </div>

  <div class="fav-tabs-bar recent-tabs">
    <button class="fav-tab-btn" :class="{ active: tab === 'recent' }" @click="tab = 'recent'">
      <Icon name="history" size="16" /><span>最近播放 ({{ history.entries.length }})</span>
    </button>
    <button class="fav-tab-btn" :class="{ active: tab === 'weekly' }" @click="tab = 'weekly'">
      <Icon name="flame" size="16" /><span>本周常听</span>
    </button>
  </div>

  <template v-if="tab === 'recent'">
    <div v-if="history.entries.length === 0" class="recent-empty">
      <Icon name="history" size="34" />
      <p>还没有播放记录。去「发现音乐」挑首歌听听吧。</p>
      <RouterLink to="/discover" class="recent-link">去发现音乐</RouterLink>
    </div>
    <template v-else>
      <div class="recent-actions">
        <button class="primary" @click="playAll(allRecentTracks)"><Icon name="play" size="15" />全部播放</button>
      </div>
      <section v-for="group in groups" :key="group.label" class="recent-group">
        <h2>{{ group.label }}</h2>
        <TrackList :tracks="group.tracks" :queue-context="allRecentTracks" removable @remove="removeEntry" @error="emit('notify', $event)" />
      </section>
    </template>
  </template>

  <template v-else>
    <div v-if="weeklyTracks.length === 0" class="recent-empty">
      <Icon name="flame" size="34" />
      <p>最近 7 天还没有听歌记录。</p>
    </div>
    <template v-else>
      <div class="weekly-summary">
        <div><strong>{{ totalWeekPlays }}</strong><span>本周播放次数</span></div>
        <div><strong>{{ history.weeklyTop.length }}</strong><span>听过的歌曲</span></div>
        <div v-if="weeklyTracks[0]" class="weekly-top">
          <strong>{{ weeklyTracks[0].title }}</strong>
          <span>本周最爱 · {{ weeklyCounts.get(weeklyTracks[0].id) }} 次</span>
        </div>
      </div>
      <div class="recent-actions">
        <button class="primary" @click="playAll(weeklyTracks)"><Icon name="play" size="15" />播放本周常听</button>
      </div>
      <TrackList :tracks="weeklyTracks" @error="emit('notify', $event)" />
    </template>
  </template>
</template>

<style scoped>
.recent-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.recent-header > button { font-size: 12px; white-space: nowrap; }
.recent-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
.recent-tabs { display: flex; gap: 6px; margin-bottom: 20px; }
.recent-actions { display: flex; gap: 10px; margin-bottom: 14px; }
.recent-actions button { padding: 8px 16px; }
.recent-group { margin-bottom: 26px; }
.recent-group h2 { font-size: 15px; font-weight: 500; color: var(--text-secondary); margin: 0 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border-default); }
.recent-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 16px; color: var(--text-tertiary); text-align: center; }
.recent-empty p { margin: 0; font-size: 13.5px; }
.recent-link { color: var(--accent); font-size: 13px; }
.weekly-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
.weekly-summary > div { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface); min-width: 0; }
.weekly-summary strong { font-family: var(--font-serif); font-size: 26px; font-weight: 500; font-variant-numeric: tabular-nums; }
.weekly-summary span { font-size: 12px; color: var(--text-tertiary); }
.weekly-top strong { font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); }
@media (max-width: 600px) { .weekly-summary { grid-template-columns: 1fr 1fr; } .weekly-top { grid-column: 1 / -1; } }
</style>
