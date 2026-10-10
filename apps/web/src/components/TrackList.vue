<script setup lang="ts">
import { computed } from 'vue';
import type { Track } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { artistNames, formatTime, qualityHint, thumb } from '@/format';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

const props = defineProps<{
  tracks: Track[];
  queueContext?: Track[];
  emptyText?: string;
  /** 显示「移除」按钮（最近播放、本地音乐等列表用） */
  removable?: boolean;
}>();

const emit = defineEmits<{ error: [message: string]; remove: [track: Track] }>();

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

function playNext(track: Track): void {
  player.playNext(track);
  emit('error', `《${track.title}》将在下一首播放`);
}

function toggleFavorite(track: Track): void {
  const added = favorites.toggle(track);
  emit('error', added ? `已收藏《${track.title}》` : `已取消收藏《${track.title}》`);
}
</script>

<template>
  <div v-if="tracks.length === 0" class="empty-state">
    <div class="empty-icon-wrap">
      <Icon name="music" size="28" />
    </div>
    <div class="empty-text">{{ emptyText ?? '暂无曲目' }}</div>
  </div>

  <div v-else class="track-list">
    <div
      v-for="(track, i) in tracks"
      :key="track.id"
      class="track-row"
      :class="{ active: isCurrent(track) }"
      @dblclick="play(track)"
    >
      <!-- 序号或正在播放声波动效 -->
      <div class="idx">
        <span v-if="isCurrent(track) && player.playing" class="playing-bars">
          <span class="bar" />
          <span class="bar" />
          <span class="bar" />
        </span>
        <span v-else>{{ i + 1 }}</span>
      </div>

      <!-- 封面与悬浮试听入口 -->
      <button class="cover-wrapper" :aria-label="`播放 ${track.title}`" @click.stop="play(track)">
        <img v-if="track.album.coverUrl" class="cover" :src="thumb(track.album.coverUrl, 96)" alt="" loading="lazy" />
        <div v-else class="cover cover-placeholder">
          <Icon name="music" size="16" />
        </div>
        <div class="cover-play-btn" title="点击播放">
          <Icon :name="isCurrent(track) && player.playing ? 'pause' : 'play'" size="16" />
        </div>
      </button>

      <!-- 标题与歌手专辑元数据 -->
      <div style="min-width: 0">
        <div class="title-wrap">
          <span class="title" :title="track.title">{{ track.title }}</span>
          <span v-if="qualityHint(track)" class="quality-badge">{{ qualityHint(track) }}</span>
        </div>
        <div class="meta" :title="`${artistNames(track)} · ${track.album.name}`">
          <PlatformBadge :platform="track.platform" compact />
          <span class="artist-name">{{ artistNames(track) }}</span>
          <span class="meta-dot">·</span>
          <span class="album-name">{{ track.album.name || '单曲' }}</span>
        </div>
      </div>

      <!-- 操作按钮群 -->
      <div class="actions">
        <!-- 收藏 -->
        <button
          class="ghost"
          :class="{ favorited: favorites.has(track.id) }"
          :title="favorites.has(track.id) ? '取消收藏' : '收藏'"
          @click.stop="toggleFavorite(track)"
        >
          <Icon :name="favorites.has(track.id) ? 'heart-filled' : 'heart'" size="16" />
        </button>

        <!-- 下一首播放 -->
        <button
          v-if="!isCurrent(track)"
          class="ghost wide-only"
          title="下一首播放"
          @click.stop="playNext(track)"
        >
          <Icon name="next" size="15" />
        </button>

        <!-- 添加到队列 -->
        <button
          class="ghost"
          title="加入队列"
          @click.stop="enqueue(track)"
        >
          <Icon name="plus" size="16" />
        </button>

        <!-- 从列表移除 -->
        <button
          v-if="removable"
          class="ghost"
          title="从列表移除"
          @click.stop="emit('remove', track)"
        >
          <Icon name="close" size="15" />
        </button>

        <!-- 播放 -->
        <button
          class="ghost"
          title="播放"
          @click.stop="play(track)"
        >
          <Icon name="play" size="15" />
        </button>

        <span class="duration">{{ formatTime(track.durationMs / 1000) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media (max-width: 768px) { .track-row .actions button.ghost.wide-only { display: none; } }
button.cover-wrapper { padding: 0; border: 0; }
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-tertiary);
  gap: 12px;
}

.empty-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.empty-text {
  font-size: 13.5px;
}

.artist-name {
  color: var(--text-secondary);
}

.meta-dot {
  opacity: 0.5;
}

.album-name {
  opacity: 0.8;
}

/* 动效：正在播放的声波动效 */
.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  color: var(--text-tertiary);
}

.playing-bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.playing-bars .bar {
  width: 2.5px;
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
  transform-origin: bottom;
  animation: bounce 0.8s ease-in-out infinite alternate;
}

.playing-bars .bar:nth-child(1) {
  animation-delay: 0s;
}

.playing-bars .bar:nth-child(2) {
  animation-delay: 0.2s;
}

.playing-bars .bar:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  from {
    transform: scaleY(0.25);
  }
  to {
    transform: scaleY(1);
  }
}
</style>
