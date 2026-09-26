<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import TrackList from '@/components/TrackList.vue';
import { formatTime } from '@/format';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();

const favorites = useFavoritesStore();
const player = usePlayerStore();

const totalDuration = computed(() =>
  favorites.tracks.reduce((sum, t) => sum + t.durationMs / 1000, 0),
);

function playAll(): void {
  if (favorites.tracks.length === 0) return;
  player.setQueue(favorites.tracks, 0);
  player.playing = true;
  emit('notify', `已把收藏的 ${favorites.tracks.length} 首歌曲加入播放队列`);
}

function clearAll(): void {
  if (!confirm('确定要清空全部收藏歌曲吗？此操作不可撤销。')) return;
  const count = favorites.tracks.length;
  favorites.clear();
  emit('notify', `已清空 ${count} 首收藏`);
}
</script>

<template>
  <!-- 收藏头部横幅 -->
  <div class="favorites-banner">
    <div class="favorites-icon-badge">
      <Icon name="heart-filled" size="32" />
    </div>
    <div class="favorites-info">
      <h1 class="page-title">我的音乐收藏</h1>
      <p class="page-sub">
        曲目数据仅保存在本机浏览器 LocalStorage 中，隐私绝不上云。
      </p>
      <div class="favorites-meta-row">
        <span>共 {{ favorites.tracks.length }} 首歌曲</span>
        <span class="meta-dot">·</span>
        <span>总时长 {{ formatTime(totalDuration) }}</span>
      </div>
      <div class="favorites-actions-row">
        <button
          class="primary play-all-btn"
          :disabled="favorites.tracks.length === 0"
          @click="playAll"
        >
          <Icon name="play" size="16" />
          <span>播放全部</span>
        </button>
        <button
          class="ghost clear-btn"
          :disabled="favorites.tracks.length === 0"
          @click="clearAll"
        >
          清空收藏
        </button>
      </div>
    </div>
  </div>

  <TrackList
    :tracks="favorites.tracks"
    empty-text="还没有收藏曲目。在歌曲列表中点击心形图标即可收藏。"
    @error="emit('notify', $event)"
  />
</template>

<style scoped>
.favorites-banner {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  padding: 24px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  margin-bottom: 28px;
  box-shadow: var(--shadow-sm);
}

.favorites-icon-badge {
  width: 90px;
  height: 90px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, rgba(255, 51, 88, 0.2), rgba(255, 75, 96, 0.05));
  border: 1px solid rgba(255, 51, 88, 0.3);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px var(--accent-glow);
}

.favorites-info {
  flex: 1;
}

.favorites-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 8px;
}

.meta-dot {
  opacity: 0.5;
}

.favorites-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.play-all-btn {
  padding: 8px 20px;
  font-size: 13.5px;
}

.clear-btn {
  font-size: 13px;
}
</style>
