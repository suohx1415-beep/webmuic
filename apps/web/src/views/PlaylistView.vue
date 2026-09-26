<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '@/api/client';
import type { PlaylistResponse } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const favorites = useFavoritesStore();

const data = ref<PlaylistResponse | null>(null);
const loading = ref(false);
const error = ref('');
const manualId = ref('');
let currentLoadToken = 0;

async function load(id: string): Promise<void> {
  if (!id) return;
  const token = ++currentLoadToken;
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const res = await api.playlist(id);
    if (token !== currentLoadToken || route.params.id !== id) return;
    data.value = res;
  } catch (e) {
    if (token !== currentLoadToken || route.params.id !== id) return;
    error.value = e instanceof ApiError ? e.message : '歌单加载失败';
  } finally {
    if (token === currentLoadToken) {
      loading.value = false;
    }
  }
}

function playAll(): void {
  if (!data.value || data.value.tracks.length === 0) return;
  player.setQueue(data.value.tracks, 0);
  player.playing = true;
  emit('notify', `已把《${data.value.name}》共 ${data.value.tracks.length} 首加入队列并开始播放`);
}

function enqueueAll(): void {
  if (!data.value) return;
  const added = player.append(data.value.tracks);
  emit('notify', added > 0 ? `已追加 ${added} 首到队列` : '这些曲目已在队列中');
}

function toggleFavorite(): void {
  if (!data.value) return;
  const isSaved = favorites.togglePlaylist({
    id: data.value.id,
    platform: data.value.platform,
    name: data.value.name,
    coverUrl: data.value.coverUrl,
    creator: data.value.creator,
    trackCount: data.value.tracks.length,
    type: data.value.isAlbum ? 'album' : 'playlist',
  });
  emit('notify', isSaved ? `已收藏${data.value.isAlbum ? '专辑' : '歌单'}《${data.value.name}》` : `已取消收藏《${data.value.name}》`);
}

function openManual(): void {
  const id = manualId.value.trim();
  if (!id) return;
  router.push(`/playlist/${id}`);
}

watch(
  () => route.params.id,
  (id) => {
    manualId.value = String(id ?? '');
    void load(String(id ?? ''));
  },
);

onMounted(() => {
  manualId.value = String(route.params.id ?? '');
  void load(manualId.value);
});
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">歌单与专辑详情</h1>
    <p class="page-sub">
      支持直接加载网易云（<code>netease:id</code> / <code>netease:album:id</code>）与 QQ 音乐（<code>qq:id</code> / <code>qq:album:mid</code>）公开歌单与专辑。
    </p>
  </div>

  <!-- 歌单快速输入查询 -->
  <div class="playlist-search-card">
    <form class="row" @submit.prevent="openManual">
      <div class="input-with-icon">
        <Icon name="music" size="16" class="field-icon" />
        <input
          v-model="manualId"
          placeholder="输入歌单/专辑识别码，如 netease:3778678 或 qq:7614366897 或 qq:album:000I5jJB3blWeN"
          class="manual-input"
        />
      </div>
      <button type="submit" class="open-btn" :disabled="!manualId.trim() || loading">
        打开解析
      </button>
    </form>
  </div>

  <!-- 加载状态 -->
  <div v-if="loading" class="notice ok">
    <Icon name="refresh" size="16" class="spin-icon" />
    <span>正在加载曲目...</span>
  </div>
  <div v-else-if="error" class="notice error">
    <Icon name="close" size="16" />
    <span>{{ error }}</span>
  </div>

  <!-- 歌单内容 -->
  <template v-if="data">
    <div class="playlist-hero-banner">
      <img
        v-if="data.coverUrl"
        :src="data.coverUrl"
        :alt="data.name"
        class="playlist-cover"
      />
      <div v-else class="playlist-cover-placeholder">
        <Icon :name="data.isAlbum ? 'album' : 'queue'" size="44" />
      </div>
      <div class="playlist-meta-info">
        <div class="row" style="gap: 8px; margin-bottom: 6px">
          <PlatformBadge :platform="data.platform" />
          <span class="playlist-tag">{{ data.isAlbum ? '专辑' : '歌单' }}</span>
          <span v-if="data.creator" class="creator-name-tag">{{ data.creator }}</span>
        </div>
        <h2 class="playlist-title">{{ data.name }}</h2>
        <div class="playlist-stats">
          <span>{{ data.tracks.length }} 首歌曲</span>
          <span v-if="data.id" class="meta-dot">·</span>
          <span v-if="data.id" class="mono-id">{{ data.id }}</span>
        </div>
        <div class="row" style="gap: 10px; margin-top: 16px">
          <button class="primary hero-action-btn" @click="playAll">
            <Icon name="play" size="15" />
            <span>播放全部</span>
          </button>
          <button class="hero-action-btn" @click="enqueueAll">
            <Icon name="plus" size="15" />
            <span>追加至队列</span>
          </button>
          <button
            class="hero-action-btn"
            :class="{ favorited: favorites.hasPlaylist(data.id) }"
            @click="toggleFavorite"
          >
            <Icon name="heart" size="15" />
            <span>{{ favorites.hasPlaylist(data.id) ? '已收藏' : '收藏' }}</span>
          </button>
        </div>
      </div>
    </div>

    <TrackList :tracks="data.tracks" @error="emit('notify', $event)" />
  </template>
</template>

<style scoped>
.playlist-search-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  margin-bottom: 24px;
}

.input-with-icon {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.field-icon {
  position: absolute;
  left: 12px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.manual-input {
  padding-left: 38px;
  height: 38px;
  background: var(--bg-canvas);
  font-size: 13.5px;
}

.open-btn {
  height: 38px;
  padding: 0 16px;
  flex-shrink: 0;
}

.playlist-hero-banner {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.playlist-cover {
  width: 120px;
  height: 120px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
}

.playlist-meta-info {
  flex: 1;
  min-width: 0;
}

.playlist-tag {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: rgba(255, 255, 255, 0.05);
}

.playlist-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.playlist-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}

.mono-id {
  font-family: monospace;
  font-size: 11.5px;
  opacity: 0.7;
}

.meta-dot {
  opacity: 0.5;
}

.hero-action-btn {
  padding: 8px 18px;
  font-size: 13px;
}

.spin-icon {
  transform-origin: center;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
