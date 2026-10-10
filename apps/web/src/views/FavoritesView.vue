<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/api/client';
import type { PlaylistCard, UserLibraryResponse } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { formatTime } from '@/format';
import { useAuthStore } from '@/stores/auth';
import { useFavoritesStore, type SavedPlaylistItem } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';

import { offlineStorage, type CachedTrackRecord } from '@/offlineStorage';

const emit = defineEmits<{ notify: [message: string] }>();
const router = useRouter();
const favorites = useFavoritesStore();
const player = usePlayerStore();
const auth = useAuthStore();

type TabType = 'cloud' | 'local' | 'custom' | 'saved' | 'offline';
const activeTab = ref<TabType>('cloud');

const userLibrary = ref<UserLibraryResponse | null>(null);
const libraryLoading = ref(false);
const actionLoadingId = ref<string | null>(null);
const cachedTracks = ref<CachedTrackRecord[]>([]);

async function loadCachedTracks(): Promise<void> {
  try {
    cachedTracks.value = await offlineStorage.getAllCachedTracks();
  } catch {
    cachedTracks.value = [];
  }
}

async function removeCachedTrack(trackId: string, title: string): Promise<void> {
  await offlineStorage.removeTrack(trackId);
  await loadCachedTracks();
  emit('notify', `已移除《${title}》的本地离线缓存`);
}

function playAllOffline(): void {
  if (cachedTracks.value.length === 0) return;
  const list = cachedTracks.value.map((c) => c.track);
  player.setQueue(list, 0);
  player.playing = true;
  emit('notify', `已开始离线播放 ${list.length} 首歌曲`);
}

// 自建歌单相关响应式状态
const activeCustomPlaylistId = ref<string | null>(null);
const newPlaylistName = ref('');
const isCreatingPlaylist = ref(false);

const activeCustomPlaylist = computed(() =>
  favorites.customPlaylists.find((p) => p.id === activeCustomPlaylistId.value) ?? null,
);

function handleCreatePlaylist(): void {
  const name = newPlaylistName.value.trim();
  if (!name) return;
  const created = favorites.createCustomPlaylist(name);
  newPlaylistName.value = '';
  isCreatingPlaylist.value = false;
  activeCustomPlaylistId.value = created.id;
  emit('notify', `自建歌单《${created.name}》创建成功`);
}

function playCustomPlaylist(p: { name: string; tracks: any[] }): void {
  if (p.tracks.length === 0) {
    emit('notify', '该自建歌单内暂无歌曲');
    return;
  }
  player.setQueue(p.tracks, 0);
  player.playing = true;
  emit('notify', `已开始播放《${p.name}》共 ${p.tracks.length} 首`);
}

function handleDeleteCustomPlaylist(id: string, name: string): void {
  if (!confirm(`确定要删除自建歌单《${name}》吗？`)) return;
  favorites.deleteCustomPlaylist(id);
  if (activeCustomPlaylistId.value === id) activeCustomPlaylistId.value = null;
  emit('notify', `已删除歌单《${name}》`);
}

function handleRenameCustomPlaylist(id: string, currentName: string): void {
  const updated = prompt('请输入新的歌单名称：', currentName);
  if (updated && updated.trim()) {
    favorites.renameCustomPlaylist(id, updated.trim());
    emit('notify', '歌单已重命名');
  }
}

const totalDuration = computed(() =>
  favorites.tracks.reduce((sum, t) => sum + t.durationMs / 1000, 0),
);

async function loadLibrary(): Promise<void> {
  libraryLoading.value = true;
  try {
    const res = await api.userPlaylists();
    userLibrary.value = res;
  } catch {
    // 忽略加载错误，退化展示
  } finally {
    libraryLoading.value = false;
  }
}

onMounted(() => {
  void loadLibrary();
});

function playAllLocal(): void {
  if (favorites.tracks.length === 0) return;
  player.setQueue(favorites.tracks, 0);
  player.playing = true;
  emit('notify', `已把收藏的 ${favorites.tracks.length} 首歌曲加入播放队列`);
}

function clearAllLocal(): void {
  if (!confirm('确定要清空全部收藏歌曲吗？此操作不可撤销。')) return;
  const count = favorites.tracks.length;
  favorites.clear();
  emit('notify', `已清空 ${count} 首收藏`);
}

async function playPlaylist(id: string, name: string): Promise<void> {
  actionLoadingId.value = id;
  try {
    const res = await api.playlist(id);
    if (!res.tracks || res.tracks.length === 0) {
      emit('notify', '该歌单暂无可用曲目');
      return;
    }
    player.setQueue(res.tracks, 0);
    player.playing = true;
    emit('notify', `已开始播放《${name}》共 ${res.tracks.length} 首`);
  } catch (e) {
    emit('notify', e instanceof ApiError ? e.message : '加载歌单失败');
  } finally {
    actionLoadingId.value = null;
  }
}

async function enqueuePlaylist(id: string, name: string): Promise<void> {
  actionLoadingId.value = id;
  try {
    const res = await api.playlist(id);
    if (!res.tracks || res.tracks.length === 0) {
      emit('notify', '该歌单暂无可用曲目');
      return;
    }
    const added = player.append(res.tracks);
    emit('notify', added > 0 ? `已追加《${name}》的 ${added} 首曲目到队列` : '曲目已在播放队列中');
  } catch (e) {
    emit('notify', e instanceof ApiError ? e.message : '追加到队列失败');
  } finally {
    actionLoadingId.value = null;
  }
}

function openDetail(id: string): void {
  router.push(`/playlist/${id}`);
}

function goToSettings(): void {
  router.push('/settings');
}
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">我的收藏</h1>
  </div>

  <!-- 分类导航 Tab -->
  <div class="fav-tabs-bar">
    <button
      class="fav-tab-btn"
      :class="{ active: activeTab === 'cloud' }"
      @click="activeTab = 'cloud'"
    >
      <Icon name="sparkles" size="16" />
      <span>云端红心与歌单</span>
    </button>
    <button
      class="fav-tab-btn"
      :class="{ active: activeTab === 'local' }"
      @click="activeTab = 'local'"
    >
      <Icon name="heart-filled" size="16" />
      <span>本机单曲 ({{ favorites.tracks.length }})</span>
    </button>
    <button
      class="fav-tab-btn"
      :class="{ active: activeTab === 'custom' }"
      @click="activeTab = 'custom'"
    >
      <Icon name="plus" size="16" />
      <span>自建歌单 ({{ favorites.customPlaylists.length }})</span>
    </button>
    <button
      class="fav-tab-btn"
      :class="{ active: activeTab === 'saved' }"
      @click="activeTab = 'saved'"
    >
      <Icon name="queue" size="16" />
      <span>收藏的歌单与专辑 ({{ favorites.playlists.length }})</span>
    </button>
    <button
      class="fav-tab-btn"
      :class="{ active: activeTab === 'offline' }"
      @click="activeTab = 'offline'; void loadCachedTracks();"
    >
      <Icon name="offline" size="16" />
      <span>离线缓存歌曲</span>
    </button>
  </div>

  <!-- Tab 1: 云端红心与账号歌单 -->
  <div v-if="activeTab === 'cloud'" class="tab-content">
    <div v-if="libraryLoading" class="notice ok">
      <Icon name="refresh" size="16" class="spin-icon" />
      <span>正在同步网易云与 QQ 音乐账号歌单...</span>
    </div>

    <!-- 顶栏核心：双平台红心专属播放卡片 -->
    <div class="heart-hero-grid">
      <!-- 网易云红心音乐卡片 -->
      <div class="heart-card netease-heart">
        <div class="heart-card-badge">
          <PlatformBadge platform="netease" />
          <span class="badge-text">网易云红心</span>
        </div>
        <div class="heart-card-body">
          <div class="heart-avatar">
            <Icon name="heart-filled" size="36" style="color: var(--netease)" />
          </div>
          <div class="heart-card-meta">
            <h3 class="heart-card-title">我喜欢的音乐</h3>
            <p v-if="userLibrary?.netease?.user" class="heart-card-sub">
              {{ userLibrary.netease.user.nickname ? `用户: ${userLibrary.netease.user.nickname}` : '已连接网易云' }}
              <span v-if="userLibrary.netease.favoritePlaylist?.trackCount"> · {{ userLibrary.netease.favoritePlaylist.trackCount }} 首</span>
            </p>
            <p v-else class="heart-card-sub muted">未配置登录凭证</p>
          </div>
        </div>
        <div class="heart-card-footer">
          <template v-if="userLibrary?.netease?.configured && userLibrary.netease.favoritePlaylist">
            <button
              class="primary heart-action-btn"
              :disabled="actionLoadingId === userLibrary.netease.favoritePlaylist.id"
              @click="playPlaylist(userLibrary.netease.favoritePlaylist.id, '网易云我喜欢的音乐')"
            >
              <Icon name="play" size="15" />
              <span>播放红心歌单</span>
            </button>
            <button
              class="ghost heart-action-btn"
              @click="openDetail(userLibrary.netease.favoritePlaylist.id)"
            >
              <span>查看全部曲目</span>
            </button>
          </template>
          <template v-else>
            <button class="ghost login-jump-btn" @click="goToSettings">
              <Icon name="settings" size="14" />
              <span>前往「设置」扫码登录网易云</span>
            </button>
          </template>
        </div>
      </div>

      <!-- QQ 音乐红心音乐卡片 -->
      <div class="heart-card qq-heart">
        <div class="heart-card-badge">
          <PlatformBadge platform="qq" />
          <span class="badge-text">QQ 音乐我喜欢</span>
        </div>
        <div class="heart-card-body">
          <div class="heart-avatar">
            <Icon name="heart-filled" size="36" style="color: var(--qq)" />
          </div>
          <div class="heart-card-meta">
            <h3 class="heart-card-title">我喜欢</h3>
            <p v-if="userLibrary?.qq?.user" class="heart-card-sub">
              {{ userLibrary.qq.user.uin ? `账号: ${userLibrary.qq.user.uin}` : '已连接 QQ 音乐' }}
              <span v-if="userLibrary.qq.favoritePlaylist?.trackCount"> · {{ userLibrary.qq.favoritePlaylist.trackCount }} 首</span>
            </p>
            <p v-else class="heart-card-sub muted">未配置登录凭证</p>
          </div>
        </div>
        <div class="heart-card-footer">
          <template v-if="userLibrary?.qq?.configured && userLibrary.qq.favoritePlaylist">
            <button
              class="primary heart-action-btn qq-play-theme"
              :disabled="actionLoadingId === userLibrary.qq.favoritePlaylist.id"
              @click="playPlaylist(userLibrary.qq.favoritePlaylist.id, 'QQ 音乐我喜欢')"
            >
              <Icon name="play" size="15" />
              <span>播放我喜欢</span>
            </button>
            <button
              class="ghost heart-action-btn"
              @click="openDetail(userLibrary.qq.favoritePlaylist.id)"
            >
              <span>查看全部曲目</span>
            </button>
          </template>
          <template v-else>
            <button class="ghost login-jump-btn" @click="goToSettings">
              <Icon name="settings" size="14" />
              <span>前往「设置」扫码登录 QQ 音乐</span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- 账号自建歌单列表展示 -->
    <div class="section-container" style="margin-top: 32px">
      <div class="section-header">
        <h3 class="section-title">我的自建与云端歌单</h3>
      </div>

      <div
        v-if="(userLibrary?.netease?.playlists.length || 0) + (userLibrary?.qq?.playlists.length || 0) === 0"
        class="empty-cloud-box"
      >
        <Icon name="queue" size="36" class="muted" />
        <p>暂未获取到云端歌单。请确保已在「设置」登录网易云或 QQ 音乐账号。</p>
        <button class="primary" style="margin-top: 10px" @click="goToSettings">
          前往登录
        </button>
      </div>

      <div v-else class="card-grid">
        <!-- 网易云自建歌单 (排除第一个已在顶栏展示的红心歌单) -->
        <template v-for="item in userLibrary?.netease?.playlists" :key="item.id">
          <div v-if="!item.isFavorite" class="collection-card">
            <div class="card-cover-wrapper" @click="openDetail(item.id)">
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
                  @click.stop="playPlaylist(item.id, item.name)"
                >
                  <Icon name="play" size="20" />
                </button>
              </div>
              <PlatformBadge platform="netease" class="card-platform-badge" />
            </div>

            <div class="card-info">
              <h4 class="card-title" :title="item.name" @click="openDetail(item.id)">
                {{ item.name }}
              </h4>
              <div class="card-meta">
                <span>{{ item.trackCount || 0 }} 首</span>
              </div>
              <div class="card-actions-bar">
                <button
                  class="ghost card-action-btn"
                  title="追加到队列"
                  :disabled="actionLoadingId === item.id"
                  @click.stop="enqueuePlaylist(item.id, item.name)"
                >
                  <Icon name="queue" size="14" />
                  <span>追加</span>
                </button>
                <button
                  class="ghost card-action-btn"
                  title="打开详情"
                  @click.stop="openDetail(item.id)"
                >
                  <Icon name="discover" size="14" />
                  <span>查看</span>
                </button>
              </div>
            </div>
          </div>
        </template>

        <!-- QQ 音乐自建歌单 (排除红心歌单) -->
        <template v-for="item in userLibrary?.qq?.playlists" :key="item.id">
          <div v-if="!item.isFavorite" class="collection-card">
            <div class="card-cover-wrapper" @click="openDetail(item.id)">
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
                  @click.stop="playPlaylist(item.id, item.name)"
                >
                  <Icon name="play" size="20" />
                </button>
              </div>
              <PlatformBadge platform="qq" class="card-platform-badge" />
            </div>

            <div class="card-info">
              <h4 class="card-title" :title="item.name" @click="openDetail(item.id)">
                {{ item.name }}
              </h4>
              <div class="card-meta">
                <span>{{ item.trackCount || 0 }} 首</span>
              </div>
              <div class="card-actions-bar">
                <button
                  class="ghost card-action-btn"
                  title="追加到队列"
                  :disabled="actionLoadingId === item.id"
                  @click.stop="enqueuePlaylist(item.id, item.name)"
                >
                  <Icon name="queue" size="14" />
                  <span>追加</span>
                </button>
                <button
                  class="ghost card-action-btn"
                  title="打开详情"
                  @click.stop="openDetail(item.id)"
                >
                  <Icon name="discover" size="14" />
                  <span>查看</span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>

  <!-- Tab 2: 本机单曲收藏 -->
  <div v-else-if="activeTab === 'local'" class="tab-content">
    <div class="favorites-banner">
      <div class="favorites-icon-badge">
        <Icon name="heart-filled" size="32" />
      </div>
      <div class="favorites-info">
        <h2 class="favorites-hero-title">喜欢的歌曲</h2>
        <div class="favorites-meta-row">
          <span>共 {{ favorites.tracks.length }} 首歌曲</span>
          <span class="meta-dot">·</span>
          <span>总时长 {{ formatTime(totalDuration) }}</span>
        </div>
        <div class="favorites-actions-row">
          <button
            class="primary play-all-btn"
            :disabled="favorites.tracks.length === 0"
            @click="playAllLocal"
          >
            <Icon name="play" size="16" />
            <span>播放全部</span>
          </button>
          <button
            class="ghost clear-btn"
            :disabled="favorites.tracks.length === 0"
            @click="clearAllLocal"
          >
            清空收藏
          </button>
        </div>
      </div>
    </div>

    <TrackList
      :tracks="favorites.tracks"
      empty-text="还没有收藏单曲。在歌曲列表中点击心形图标即可收藏。"
      @error="emit('notify', $event)"
    />
  </div>

  <!-- Tab: 自建歌单 -->
  <div v-else-if="activeTab === 'custom'" class="tab-content">
    <!-- 详情状态：展示当前查看的自建歌单 -->
    <template v-if="activeCustomPlaylist">
      <div class="favorites-banner">
        <div class="favorites-icon-badge" style="background: var(--qq-soft); color: var(--qq)">
          <Icon name="queue" size="32" />
        </div>
        <div class="favorites-info">
          <div class="row" style="gap: 8px; align-items: center">
            <button class="ghost small-btn" style="padding: 2px 8px" @click="activeCustomPlaylistId = null">
              ← 返回歌单列表
            </button>
          </div>
          <h2 class="favorites-hero-title" style="margin-top: 6px">
            {{ activeCustomPlaylist.name }}
          </h2>
          <p class="page-sub">
            自建本地歌单 · 共 {{ activeCustomPlaylist.tracks.length }} 首歌曲
          </p>
          <div class="favorites-actions-row">
            <button
              class="primary play-all-btn"
              :disabled="activeCustomPlaylist.tracks.length === 0"
              @click="playCustomPlaylist(activeCustomPlaylist)"
            >
              <Icon name="play" size="16" />
              <span>播放全部</span>
            </button>
            <button
              class="ghost"
              @click="handleRenameCustomPlaylist(activeCustomPlaylist.id, activeCustomPlaylist.name)"
            >
              重命名
            </button>
            <button
              class="ghost clear-btn"
              @click="handleDeleteCustomPlaylist(activeCustomPlaylist.id, activeCustomPlaylist.name)"
            >
              删除歌单
            </button>
          </div>
        </div>
      </div>

      <TrackList
        :tracks="activeCustomPlaylist.tracks"
        empty-text="该自建歌单暂无歌曲。在歌曲菜单或收藏中添加曲目。"
        @error="emit('notify', $event)"
      />
    </template>

    <!-- 列表状态：展示所有自建歌单网格与创建入口 -->
    <template v-else>
      <div class="section-header" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center">
        <div>
          <h3 class="section-title">我的自建歌单</h3>
        </div>
        <div class="row" style="gap: 8px">
          <input
            v-if="isCreatingPlaylist"
            v-model="newPlaylistName"
            type="text"
            placeholder="输入歌单名称..."
            style="padding: 6px 12px; font-size: 13px; border-radius: 6px; width: 160px"
            @keydown.enter="handleCreatePlaylist"
            @keydown.esc="isCreatingPlaylist = false"
          />
          <button
            v-if="isCreatingPlaylist"
            class="primary small-btn"
            :disabled="!newPlaylistName.trim()"
            @click="handleCreatePlaylist"
          >
            确认创建
          </button>
          <button
            v-if="isCreatingPlaylist"
            class="ghost small-btn"
            @click="isCreatingPlaylist = false"
          >
            取消
          </button>
          <button
            v-else
            class="primary small-btn"
            @click="isCreatingPlaylist = true"
          >
            <Icon name="plus" size="14" />
            <span>新建歌单</span>
          </button>
        </div>
      </div>

      <div v-if="favorites.customPlaylists.length === 0" class="empty-cloud-box">
        <Icon name="queue" size="36" class="muted" />
        <p>还没有自建歌单，点击上方「新建歌单」开始创建。</p>
      </div>

      <div v-else class="card-grid">
        <div
          v-for="item in favorites.customPlaylists"
          :key="item.id"
          class="collection-card"
        >
          <div class="card-cover-wrapper" @click="activeCustomPlaylistId = item.id">
            <img
              v-if="item.tracks[0]?.album.coverUrl"
              :src="item.tracks[0].album.coverUrl"
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
                @click.stop="playCustomPlaylist(item)"
              >
                <Icon name="play" size="20" />
              </button>
            </div>
          </div>

          <div class="card-info">
            <h4 class="card-title" :title="item.name" @click="activeCustomPlaylistId = item.id">
              {{ item.name }}
            </h4>
            <div class="card-meta">
              <span>{{ item.tracks.length }} 首歌曲</span>
            </div>
            <div class="card-actions-bar">
              <button
                class="ghost card-action-btn"
                title="播放全部"
                @click.stop="playCustomPlaylist(item)"
              >
                <Icon name="play" size="14" />
                <span>播放</span>
              </button>
              <button
                class="ghost card-action-btn"
                title="查看与管理"
                @click.stop="activeCustomPlaylistId = item.id"
              >
                <Icon name="discover" size="14" />
                <span>查看</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- Tab 4: 收藏的歌单与专辑 -->
  <div v-else-if="activeTab === 'saved'" class="tab-content">
    <div v-if="favorites.playlists.length === 0" class="empty-cloud-box">
      <Icon name="queue" size="36" class="muted" />
      <p>还没有收藏任何歌单或专辑。可在搜索页或详情页点击「收藏」按钮保存。</p>
      <button class="primary" style="margin-top: 10px" @click="router.push('/search')">
        去搜歌单与专辑
      </button>
    </div>

    <div v-else class="card-grid">
      <div
        v-for="item in favorites.playlists"
        :key="item.id"
        class="collection-card"
      >
        <div class="card-cover-wrapper" @click="openDetail(item.id)">
          <img
            v-if="item.coverUrl"
            :src="item.coverUrl"
            :alt="item.name"
            class="card-cover-img"
            loading="lazy"
          />
          <div v-else class="card-cover-placeholder">
            <Icon :name="item.type === 'album' ? 'album' : 'queue'" size="32" />
          </div>
          <div class="cover-overlay">
            <button
              class="cover-play-btn"
              title="立即播放全部"
              :disabled="actionLoadingId === item.id"
              @click.stop="playPlaylist(item.id, item.name)"
            >
              <Icon name="play" size="20" />
            </button>
          </div>
          <PlatformBadge :platform="item.platform" class="card-platform-badge" />
        </div>

        <div class="card-info">
          <div class="row" style="gap: 6px; margin-bottom: 4px">
            <span class="playlist-tag">{{ item.type === 'album' ? '专辑' : '歌单' }}</span>
          </div>
          <h4 class="card-title" :title="item.name" @click="openDetail(item.id)">
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
              @click.stop="enqueuePlaylist(item.id, item.name)"
            >
              <Icon name="queue" size="14" />
              <span>追加</span>
            </button>
            <button
              class="ghost card-action-btn favorited"
              title="取消收藏"
              @click.stop="favorites.removePlaylist(item.id)"
            >
              <Icon name="heart-filled" size="14" />
              <span>已收藏</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 5: 离线缓存音乐 -->
  <div v-else-if="activeTab === 'offline'" class="tab-content">
    <div class="collection-header">
      <div class="collection-title-box">
        <h2>本地离线音乐</h2>
      </div>
      <div class="row" style="gap: 10px">
        <button
          class="primary"
          :disabled="cachedTracks.length === 0"
          @click="playAllOffline"
        >
          <Icon name="play" size="16" />
          <span>离线播放全部 ({{ cachedTracks.length }})</span>
        </button>
      </div>
    </div>

    <div v-if="cachedTracks.length === 0" class="empty-cloud-box">
      <Icon name="offline" size="36" class="muted" />
      <p>暂无离线缓存歌曲。在播放任意歌曲时，点击底部播放条右侧的「离线缓存」按钮即可保存至本地！</p>
    </div>

    <TrackList
      v-else
      :tracks="cachedTracks.map((c) => c.track)"
      empty-text="暂无离线歌曲"
      @error="emit('notify', $event)"
    />
  </div>
</template>

<style scoped>
.fav-tabs-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}

.fav-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.fav-tab-btn:hover {
  border-color: var(--border-focus);
  color: var(--text-primary);
}

.fav-tab-btn.active {
  background: var(--accent);
  color: var(--on-accent);
  border-color: var(--accent);
  font-weight: 500;
  box-shadow: 0 2px 8px var(--accent-glow);
}

/* 红心专属卡片栅格 */
.heart-hero-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.heart-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 20px 24px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.heart-card.netease-heart {
  background: var(--bg-surface);
  border-color: var(--netease-border);
}

.heart-card.qq-heart {
  background: var(--bg-surface);
  border-color: var(--qq-border);
}

.heart-card-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.badge-text {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.heart-card-body {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.heart-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.heart-card-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.heart-card-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.heart-card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
}

.heart-action-btn {
  padding: 8px 18px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
}

.qq-play-theme {
  background: var(--qq);
}

.qq-play-theme:hover {
  background: var(--qq);
}

.login-jump-btn {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.login-jump-btn:hover {
  color: var(--accent);
}

.section-container {
  margin-bottom: 28px;
}

.section-header {
  margin-bottom: 16px;
}

.section-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.empty-cloud-box {
  padding: 48px;
  background: var(--bg-surface);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  text-align: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

/* 本机收藏横幅 */
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

.favorites-hero-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
}

.favorites-icon-badge {
  width: 90px;
  height: 90px;
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
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
  color: var(--text-secondary);
  font-size: 13px;
  margin: 10px 0 16px;
}

.meta-dot {
  opacity: 0.5;
}

.favorites-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.play-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--radius-full);
}

.clear-btn {
  color: var(--text-tertiary);
  font-size: 13px;
}

.clear-btn:hover:not(:disabled) {
  color: var(--danger);
}

/* 歌单网格 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 20px;
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

.playlist-tag {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--bg-elevated);
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
}
</style>
