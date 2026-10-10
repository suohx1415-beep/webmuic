<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { hasMoreSearchResults } from '@/api/searchPage';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '@/api/client';
import type {
  AlbumCard,
  PlaylistCard,
  SearchAlbumsResponse,
  SearchPlaylistsResponse,
  SearchResponse,
  SearchType,
} from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { load, save, STORAGE_KEYS } from '@/storage';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();
const router = useRouter();
const route = useRoute();
const settings = useSettingsStore();
const player = usePlayerStore();
const favorites = useFavoritesStore();

const keyword = ref('');
const searchType = ref<SearchType>('song');
const loading = ref(false);
const error = ref('');
const result = ref<SearchResponse | null>(null);
const playlistResult = ref<SearchPlaylistsResponse | null>(null);
const albumResult = ref<SearchAlbumsResponse | null>(null);
const suggestions = ref<string[]>([]);
const submitted = ref('');
const currentPage = ref(0);
const actionLoadingId = ref<string | null>(null);

let suggestTimer: number | undefined;
let suggestToken = 0;
let searchToken = 0;
let submittedParams: { q: string; platform: string; limit: number } | null = null;

const platforms = [
  { value: 'all', label: '双平台聚合' },
  { value: 'netease', label: '网易云音乐' },
  { value: 'qq', label: 'QQ 音乐' },
] as const;

const searchTypeTabs = [
  { value: 'song', label: '单曲', icon: 'music' },
  { value: 'playlist', label: '歌单', icon: 'queue' },
  { value: 'album', label: '专辑', icon: 'album' },
] as const;

const currentTotals = computed(() => {
  if (searchType.value === 'song') return result.value?.totals ?? {};
  if (searchType.value === 'playlist') return playlistResult.value?.totals ?? {};
  return albumResult.value?.totals ?? {};
});

const currentDegraded = computed(() => {
  if (searchType.value === 'song') return result.value?.degraded;
  if (searchType.value === 'playlist') return playlistResult.value?.degraded;
  return albumResult.value?.degraded;
});

const degradedText = computed(() => {
  const degraded = currentDegraded.value;
  if (!degraded) return '';
  return degraded.platforms
    .map((p) => `${p === 'netease' ? '网易云' : 'QQ 音乐'}：${degraded.reasons[p] ?? '不可用'}`)
    .join('；');
});

const canLoadMore = computed(() => {
  const body = searchType.value === 'song' ? result.value
    : searchType.value === 'playlist' ? playlistResult.value : albumResult.value;
  return !!body && hasMoreSearchResults(body, searchType.value === 'song' ? 200 : 150);
});

async function runSearch(page = 0, append = false): Promise<void> {
  if (append && (loading.value || !submittedParams)) return;
  const params = append && submittedParams ? submittedParams : {
    q: keyword.value.trim(), platform: settings.platform, limit: settings.limit,
  };
  const query = params.q;
  const token = ++searchToken;
  if (!query) {
    error.value = '';
    submittedParams = null;
    loading.value = false;
    result.value = null;
    playlistResult.value = null;
    albumResult.value = null;
    return;
  }
  if (!append) {
    result.value = null;
    playlistResult.value = null;
    albumResult.value = null;
  }
  loading.value = true;
  error.value = '';
  try {
    if (searchType.value === 'playlist') {
      const body = await api.searchPlaylists({ ...params, offset: page * params.limit });
      if (token !== searchToken) return;
      submittedParams = params;
      submitted.value = query;
      currentPage.value = page;
      if (append && playlistResult.value) {
        const seen = new Set(playlistResult.value.playlists.map((p) => p.id));
        playlistResult.value = {
          ...body,
          playlists: [...playlistResult.value.playlists, ...body.playlists.filter((p) => !seen.has(p.id))],
        };
      } else {
        playlistResult.value = body;
      }
    } else if (searchType.value === 'album') {
      const body = await api.searchAlbums({ ...params, offset: page * params.limit });
      if (token !== searchToken) return;
      submittedParams = params;
      submitted.value = query;
      currentPage.value = page;
      if (append && albumResult.value) {
        const seen = new Set(albumResult.value.albums.map((a) => a.id));
        albumResult.value = {
          ...body,
          albums: [...albumResult.value.albums, ...body.albums.filter((a) => !seen.has(a.id))],
        };
      } else {
        albumResult.value = body;
      }
    } else {
      const body = await api.search({ ...params, offset: page * params.limit });
      if (token !== searchToken) return;
      submittedParams = params;
      submitted.value = query;
      currentPage.value = page;
      if (append && result.value) {
        const seen = new Set(result.value.tracks.map((t) => t.id));
        result.value = {
          ...body,
          tracks: [...result.value.tracks, ...body.tracks.filter((t) => !seen.has(t.id))],
        };
      } else {
        result.value = body;
      }
    }
  } catch (e) {
    if (token !== searchToken) return;
    error.value = e instanceof ApiError ? e.message : '搜索失败';
    if (!append) {
      if (searchType.value === 'song') result.value = null;
      else if (searchType.value === 'playlist') playlistResult.value = null;
      else albumResult.value = null;
    }
  } finally {
    if (token === searchToken) loading.value = false;
  }
}

function loadSuggestions(): void {
  if (suggestTimer) clearTimeout(suggestTimer);
  const token = ++suggestToken;
  suggestions.value = [];
  suggestTimer = window.setTimeout(async () => {
    const query = keyword.value.trim();
    if (query.length < 2) {
      suggestions.value = [];
      return;
    }
    try {
      const body = await api.suggest(query);
      if (token === suggestToken && keyword.value.trim() === query) {
        suggestions.value = body.suggestions;
      }
    } catch {
      if (token === suggestToken) suggestions.value = [];
    }
  }, 200);
}

function pickSuggestion(text: string): void {
  keyword.value = text;
  suggestions.value = [];
  void rememberQuery();
}

function clearQuery(): void {
  keyword.value = '';
  suggestions.value = [];
  ++suggestToken;
  clearTimeout(suggestTimer);
}

onMounted(() => {
  const query = typeof route.query.q === 'string' ? route.query.q.trim() : '';
  keyword.value = query || load(STORAGE_KEYS.lastQuery, '');
  if (query) void rememberQuery();
});

watch(() => route.query.q, (value) => {
  if (typeof value !== 'string' || !value.trim()) return;
  keyword.value = value.trim();
  void rememberQuery();
});

watch(searchType, () => {
  void runSearch(0, false);
});

onBeforeUnmount(() => {
  ++searchToken;
  ++suggestToken;
  clearTimeout(suggestTimer);
});

async function rememberQuery(): Promise<void> {
  ++suggestToken;
  clearTimeout(suggestTimer);
  suggestions.value = [];
  save(STORAGE_KEYS.lastQuery, keyword.value.trim());
  await runSearch(0, false);
}

async function playCollection(item: PlaylistCard | AlbumCard): Promise<void> {
  actionLoadingId.value = item.id;
  try {
    const res = await api.playlist(item.id);
    if (!res.tracks || res.tracks.length === 0) {
      emit('notify', '该集合暂无可用曲目');
      return;
    }
    player.setQueue(res.tracks, 0);
    player.playing = true;
    emit('notify', `已播放《${res.name}》共 ${res.tracks.length} 首`);
  } catch (e) {
    emit('notify', e instanceof ApiError ? e.message : '加载曲目失败');
  } finally {
    actionLoadingId.value = null;
  }
}

async function enqueueCollection(item: PlaylistCard | AlbumCard): Promise<void> {
  actionLoadingId.value = item.id;
  try {
    const res = await api.playlist(item.id);
    if (!res.tracks || res.tracks.length === 0) {
      emit('notify', '该集合暂无可用曲目');
      return;
    }
    const added = player.append(res.tracks);
    emit('notify', added > 0 ? `已追加 ${added} 首曲目到队列` : '曲目已在播放队列中');
  } catch (e) {
    emit('notify', e instanceof ApiError ? e.message : '追加到队列失败');
  } finally {
    actionLoadingId.value = null;
  }
}

function toggleFavoriteCollection(item: PlaylistCard | AlbumCard): void {
  const isNowSaved = favorites.togglePlaylist({
    id: item.id,
    platform: item.platform,
    name: item.name,
    coverUrl: item.coverUrl,
    creator: 'creator' in item ? item.creator : 'artist' in item ? item.artist : undefined,
    trackCount: item.trackCount,
    type: item.type,
  });
  emit('notify', isNowSaved ? `已收藏${item.type === 'album' ? '专辑' : '歌单'}《${item.name}》` : `已取消收藏《${item.name}》`);
}

function openCollectionDetail(id: string): void {
  router.push(`/playlist/${id}`);
}
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">搜索曲库</h1>
  </div>

  <!-- 搜索栏主容器 -->
  <div class="search-box-card">
    <form class="search-form-row" @submit.prevent="rememberQuery">
      <div class="search-input-wrapper">
        <Icon name="search" size="18" class="search-input-icon" />
        <input
          v-model="keyword"
          class="search-input-field"
          aria-label="搜索歌曲、歌手、歌单或专辑"
          placeholder="搜索歌曲、歌手、歌单或专辑"
          autofocus
          @input="loadSuggestions"
        />
        <button
          v-if="keyword"
          type="button"
          class="ghost search-clear-btn"
          title="清空"
          @click="clearQuery"
        >
          <Icon name="close" size="14" />
        </button>
      </div>

      <!-- 平台筛选选择 -->
      <div class="platform-selector">
        <select v-model="settings.platform" @change="rememberQuery">
          <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>

      <button class="primary search-submit-btn" type="submit" :disabled="loading || !keyword.trim()">
        <span v-if="loading">搜索中…</span>
        <template v-else>
          <Icon name="search" size="15" />
          <span>搜索</span>
        </template>
      </button>
    </form>

    <!-- 搜索类型切换 Tab (单曲 / 歌单 / 专辑) -->
    <div class="search-type-tabs">
      <button
        v-for="tab in searchTypeTabs"
        :key="tab.value"
        type="button"
        class="type-tab-btn"
        :class="{ active: searchType === tab.value }"
        @click="searchType = tab.value"
      >
        <Icon :name="tab.icon" size="15" />
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- 联想建议气泡 -->
    <div v-if="suggestions.length" class="suggestions-row">
      <span class="small muted" style="margin-right: 4px">推荐词：</span>
      <button
        v-for="s in suggestions"
        :key="s"
        class="ghost suggestion-chip"
        @click="pickSuggestion(s)"
      >
        {{ s }}
      </button>
    </div>
  </div>

  <!-- 异常状态提示 -->
  <div v-if="error" class="notice error">
    <Icon name="close" size="16" />
    <span>{{ error }}</span>
  </div>
  <div v-else-if="degradedText" class="notice warn">
    <Icon name="sparkles" size="16" />
    <span>{{ degradedText }}</span>
  </div>

  <!-- 结果元数据概览 -->
  <div v-if="(searchType === 'song' && result) || (searchType === 'playlist' && playlistResult) || (searchType === 'album' && albumResult)" class="search-stats-bar">
    <div class="row" style="gap: 8px">
      <span class="stat-highlight">「{{ submitted }}」</span>
      <span class="muted">
        共检索到 {{
          searchType === 'song' ? result?.tracks.length :
          searchType === 'playlist' ? playlistResult?.playlists.length :
          albumResult?.albums.length
        }} 个{{ searchType === 'song' ? '单曲' : searchType === 'playlist' ? '歌单' : '专辑' }}
      </span>
    </div>
    <div class="row" style="gap: 8px">
      <span v-if="currentTotals.netease" class="result-source-tag netease">
        网易云 {{ currentTotals.netease }}
      </span>
      <span v-if="currentTotals.qq" class="result-source-tag qq">
        QQ 音乐 {{ currentTotals.qq }}
      </span>
    </div>
  </div>

  <!-- 单曲结果列表 -->
  <TrackList
    v-if="searchType === 'song' && result"
    :tracks="result.tracks"
    empty-text="未找到匹配歌曲，尝试更换关键词或切换检索平台"
    @error="emit('notify', $event)"
  />

  <!-- 歌单卡片网格 -->
  <div v-else-if="searchType === 'playlist' && playlistResult" class="card-grid">
    <div
      v-for="item in playlistResult.playlists"
      :key="item.id"
      class="collection-card"
    >
      <div class="card-cover-wrapper" @click="openCollectionDetail(item.id)">
        <img
          v-if="item.coverUrl"
          :src="item.coverUrl"
          :alt="item.name"
          class="card-cover-img"
          loading="lazy"
        />
        <div v-else class="card-cover-placeholder">
          <Icon name="queue" size="32" />
        </div>
        <div class="cover-overlay">
          <button
            class="cover-play-btn"
            title="立即播放全部"
            :disabled="actionLoadingId === item.id"
            @click.stop="playCollection(item)"
          >
            <Icon name="play" size="20" />
          </button>
        </div>
        <PlatformBadge :platform="item.platform" class="card-platform-badge" />
      </div>

      <div class="card-info">
        <h4 class="card-title" :title="item.name" @click="openCollectionDetail(item.id)">
          {{ item.name }}
        </h4>
        <div class="card-meta">
          <span v-if="item.creator" class="creator-name" :title="item.creator">{{ item.creator }}</span>
          <span v-if="item.trackCount" class="track-count">{{ item.trackCount }} 首</span>
        </div>
        <div class="card-actions-bar">
          <button
            class="ghost card-action-btn"
            title="追加到队列"
            :disabled="actionLoadingId === item.id"
            @click.stop="enqueueCollection(item)"
          >
            <Icon name="queue" size="14" />
            <span>追加</span>
          </button>
          <button
            class="ghost card-action-btn"
            :class="{ favorited: favorites.hasPlaylist(item.id) }"
            :title="favorites.hasPlaylist(item.id) ? '已收藏' : '收藏歌单'"
            @click.stop="toggleFavoriteCollection(item)"
          >
            <Icon name="heart" size="14" />
            <span>{{ favorites.hasPlaylist(item.id) ? '已收藏' : '收藏' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 专辑卡片网格 -->
  <div v-else-if="searchType === 'album' && albumResult" class="card-grid">
    <div
      v-for="item in albumResult.albums"
      :key="item.id"
      class="collection-card"
    >
      <div class="card-cover-wrapper" @click="openCollectionDetail(item.id)">
        <img
          v-if="item.coverUrl"
          :src="item.coverUrl"
          :alt="item.name"
          class="card-cover-img"
          loading="lazy"
        />
        <div v-else class="card-cover-placeholder">
          <Icon name="album" size="32" />
        </div>
        <div class="cover-overlay">
          <button
            class="cover-play-btn"
            title="立即播放全部"
            :disabled="actionLoadingId === item.id"
            @click.stop="playCollection(item)"
          >
            <Icon name="play" size="20" />
          </button>
        </div>
        <PlatformBadge :platform="item.platform" class="card-platform-badge" />
      </div>

      <div class="card-info">
        <h4 class="card-title" :title="item.name" @click="openCollectionDetail(item.id)">
          {{ item.name }}
        </h4>
        <div class="card-meta">
          <span v-if="item.artist" class="creator-name" :title="item.artist">{{ item.artist }}</span>
          <span v-if="item.trackCount" class="track-count">{{ item.trackCount }} 首</span>
        </div>
        <div class="card-actions-bar">
          <button
            class="ghost card-action-btn"
            title="追加到队列"
            :disabled="actionLoadingId === item.id"
            @click.stop="enqueueCollection(item)"
          >
            <Icon name="queue" size="14" />
            <span>追加</span>
          </button>
          <button
            class="ghost card-action-btn"
            :class="{ favorited: favorites.hasPlaylist(item.id) }"
            :title="favorites.hasPlaylist(item.id) ? '已收藏' : '收藏专辑'"
            @click.stop="toggleFavoriteCollection(item)"
          >
            <Icon name="heart" size="14" />
            <span>{{ favorites.hasPlaylist(item.id) ? '已收藏' : '收藏' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="!loading && ((searchType === 'playlist' && playlistResult?.playlists.length === 0) || (searchType === 'album' && albumResult?.albums.length === 0))" class="notice" role="status">
    未找到匹配结果，试试其他关键词或平台。
  </div>

  <!-- 加载更多 -->
  <div
    v-if="((searchType === 'song' && result) || (searchType === 'playlist' && playlistResult) || (searchType === 'album' && albumResult)) && canLoadMore"
    class="load-more-row"
  >
    <button :disabled="loading" class="load-more-btn" @click="runSearch(currentPage + 1, true)">
      {{ loading ? '加载中…' : '查看更多结果' }}
    </button>
  </div>
</template>

<style scoped>
.search-box-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.search-form-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.search-input-icon {
  position: absolute;
  left: 14px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input-field {
  padding-left: 42px;
  padding-right: 36px;
  height: 42px;
  background: var(--bg-canvas);
  border-color: var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 14px;
}

.search-clear-btn {
  position: absolute;
  right: 6px;
  padding: 4px;
  color: var(--text-tertiary);
  border-radius: var(--radius-xs);
}

.platform-selector {
  width: 140px;
  flex-shrink: 0;
}

.platform-selector select {
  height: 42px;
  background: var(--bg-canvas);
  border-radius: var(--radius-sm);
}

.search-submit-btn {
  height: 42px;
  padding: 0 20px;
  flex-shrink: 0;
}

.search-type-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.type-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-full);
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.type-tab-btn:hover {
  background: var(--bg-canvas);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.type-tab-btn.active {
  background: var(--accent);
  color: var(--bg-canvas);
  border-color: var(--accent);
  font-weight: 500;
}

.suggestions-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.suggestion-chip {
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  font-size: 12px;
  color: var(--text-secondary);
}

.suggestion-chip:hover {
  background: var(--bg-elevated);
  color: var(--accent);
}

.search-stats-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 4px;
  font-size: 13px;
}

.stat-highlight {
  font-weight: 600;
  color: var(--text-primary);
}

.result-source-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.result-source-tag.netease {
  color: var(--netease);
  border: 1px solid var(--netease-border);
}

.result-source-tag.qq {
  color: var(--qq);
  border: 1px solid var(--qq-border);
}

/* 歌单/专辑卡片网格布局 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.collection-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.collection-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-focus);
  box-shadow: var(--shadow-md);
}

.card-cover-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-canvas);
  cursor: pointer;
  overflow: hidden;
}

.card-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.collection-card:hover .card-cover-img {
  transform: scale(1.05);
}

.card-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.card-platform-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  box-shadow: var(--shadow-sm);
}

.cover-overlay {
  position: absolute;
  inset: 0;
  background: #19191759;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.card-cover-wrapper:hover .cover-overlay {
  opacity: 1;
}

.cover-play-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transform: scale(0.9);
  transition: transform var(--transition-fast);
}

.cover-play-btn:hover {
  transform: scale(1.06);
}

.card-info {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-title:hover {
  color: var(--accent);
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.creator-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
}

.track-count {
  font-size: 11px;
  opacity: 0.8;
}

.card-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.card-action-btn {
  font-size: 12px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
}

.card-action-btn:hover {
  color: var(--accent);
}

.card-action-btn.favorited {
  color: var(--accent);
}

.load-more-row {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

.load-more-btn {
  padding: 8px 24px;
  border-radius: var(--radius-full);
}
</style>
