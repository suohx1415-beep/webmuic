<script setup lang="ts">
import { thumb } from '@/format';
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
      <button type="submit" class="primary open-btn" :disabled="!manualId.trim() || loading">
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
        :src="thumb(data.coverUrl, 500)"
        :alt="data.name"
        class="playlist-cover"
      />
      <div v-else class="playlist-cover-placeholder">
        <Icon :name="data.isAlbum ? 'album' : 'queue'" size="44" />
      </div>
      <div class="playlist-meta-info">
        <div class="row" style="gap: 8px; margin-bottom: 8px">
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
        <div class="row" style="gap: 12px; margin-top: 18px">
          <button class="hero-action-btn primary" @click="playAll">
            <Icon name="play" size="16" />
            <span>播放全部</span>
          </button>
          <button class="hero-action-btn secondary" @click="enqueueAll">
            <Icon name="plus" size="16" />
            <span>追加至队列</span>
          </button>
          <button
            class="hero-action-btn secondary"
            :class="{ favorited: favorites.hasPlaylist(data.id) }"
            @click="toggleFavorite"
          >
            <Icon :name="favorites.hasPlaylist(data.id) ? 'heart-filled' : 'heart'" size="16" />
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
  padding: 10px 14px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.playlist-search-card:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-soft);
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
  padding-left: 36px;
  height: 38px;
  background: transparent;
  border: none;
  font-size: 13.5px;
  width: 100%;
}

.manual-input:focus {
  outline: none;
  box-shadow: none;
}

.open-btn {
  height: 36px;
  padding: 0 18px;
  border-radius: var(--radius-full);
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
}

.playlist-hero-banner {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.playlist-cover {
  width: 130px;
  height: 130px;
  border-radius: var(--radius-md);
  object-fit: cover;
  box-shadow: var(--shadow-md);
  flex-shrink: 0;
}

.playlist-cover-placeholder {
  width: 130px;
  height: 130px;
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.playlist-meta-info {
  flex: 1;
  min-width: 0;
}

.playlist-tag {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}

.creator-name-tag {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
}

.playlist-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--text-primary);
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.playlist-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.mono-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  opacity: 0.7;
}

.meta-dot {
  opacity: 0.5;
}

.hero-action-btn {
  height: 38px;
  padding: 0 20px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}

.hero-action-btn:hover {
  transform: translateY(-1px);
}

.hero-action-btn.primary {
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  box-shadow: 0 4px 14px var(--accent-glow);
}

.hero-action-btn.primary:hover {
  box-shadow: none;
}

.hero-action-btn.secondary {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.hero-action-btn.secondary:hover {
  background: var(--bg-elevated-hover);
}

.hero-action-btn.favorited {
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--accent-soft);
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
