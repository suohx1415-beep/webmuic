<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AudioFxDrawer from '@/components/AudioFxDrawer.vue';
import Icon from '@/components/Icon.vue';
import LyricDrawer from '@/components/LyricDrawer.vue';
import PlayerBar from '@/components/PlayerBar.vue';
import QueueDrawer from '@/components/QueueDrawer.vue';
import NowPlayingPanel from '@/components/NowPlayingPanel.vue';
import { useRoute, useRouter } from 'vue-router';
import { useFavoritesStore } from '@/stores/favorites';
import { useAudio } from '@/composables/useAudio';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useMediaSession } from '@/composables/useMediaSession';
import { useAuthStore } from '@/stores/auth';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const player = usePlayerStore();
const auth = useAuthStore();
const settings = useSettingsStore();
const favorites = useFavoritesStore();
const route = useRoute();
const router = useRouter();
const searchQuery = ref('');
function search(): void {
  const q = searchQuery.value.trim();
  if (q) void router.push({ path: '/search', query: { q } });
}
const { errorText, bind, toggle, seek, switchSource } = useAudio();

const queueOpen = ref(false);
const lyricOpen = ref(false);
const eqOpen = ref(false);
const toast = ref('');
let toastTimer: number | undefined;
let listeningTrigger: HTMLElement | null = null;

watch(lyricOpen, async (open) => {
  if (open) {
    listeningTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    document.getElementById('close-listening')?.focus();
  } else {
    await nextTick();
    listeningTrigger?.focus();
  }
});

// 启用系统锁屏 / 媒体控制与全局快捷键
useMediaSession({ toggle, seek });
useKeyboardShortcuts({
  togglePlay: toggle,
  seek,
  toggleLyric: () => {
    lyricOpen.value = !lyricOpen.value;
  },
  closeDrawers: () => {
    lyricOpen.value = false;
    queueOpen.value = false;
  },
});

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
});

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200);
}

const banners = computed(() =>
  auth.health
    .filter((h) => !h.reachable)
    .map((h) => `${h.platform === 'netease' ? '网易云音乐' : 'QQ 音乐'}后端连接异常：${h.detail ?? '服务未能响应'}`),
);

onMounted(async () => {
  bind();
  player.playing = false;
  await auth.refresh();
});
</script>

<template>
  <div class="layout" :class="{ 'is-listening': lyricOpen }">
    <!-- 侧边导航栏 -->
    <nav class="sidebar" aria-label="主导航" :inert="lyricOpen">
      <div class="brand-wrapper">
        <span class="brand-wave" aria-hidden="true"><i /><i /><i /></span>
        <div class="brand-title">webmuic</div>
      </div>

      <RouterLink to="/discover" class="nav-item" active-class="active">
        <Icon name="discover" size="18" />
        <span>发现音乐</span>
      </RouterLink>
      <RouterLink to="/search" class="nav-item" active-class="active">
        <Icon name="search" size="18" />
        <span>搜索曲库</span>
      </RouterLink>

      <div class="nav-group-title" style="margin-top: 10px">我的</div>
      <RouterLink to="/favorites" class="nav-item" active-class="active">
        <Icon name="heart" size="17" />
        <span>我的收藏</span>
      </RouterLink>
      <RouterLink to="/settings" class="nav-item" active-class="active">
        <Icon name="settings" size="17" />
        <span>偏好与设置</span>
      </RouterLink>

      <div v-if="favorites.playlists.length" class="sidebar-library">
        <div class="nav-group-title">收藏的歌单</div>
        <RouterLink v-for="item in favorites.playlists.slice(0, 5)" :key="item.id" :to="`/playlist/${item.id}`" class="library-link">
          <img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy">
          <Icon v-else name="music" size="24" />
          <span>{{ item.name }}</span>
        </RouterLink>
      </div>
      <span class="spacer" />

      <!-- 主题切换 -->
      <button
        type="button"
        class="ghost theme-toggle-btn"
        :title="settings.theme === 'light' ? '切换为深色模式' : '切换为浅色模式'"
        @click="settings.toggleTheme()"
      >
        <Icon :name="settings.theme === 'light' ? 'moon' : 'sun'" size="16" />
        <span>{{ settings.theme === 'light' ? '深色主题' : '浅色主题' }}</span>
      </button>

      <!-- 侧边栏底部：平台在线态 -->
      <div class="sidebar-footer">
        <div
          v-for="status in auth.statuses"
          :key="status.platform"
          class="status-chip"
          :class="auth.healthOf(status.platform)?.reachable ? 'online' : 'warning'"
        >
          <div class="row" style="gap: 6px">
            <span class="status-indicator" />
            <span>{{ status.platform === 'netease' ? '网易云' : 'QQ 音乐' }}</span>
          </div>
          <span style="font-size: 11px; opacity: 0.8">
            {{ status.state === 'configured' ? (status.hasMemberKey ? '已登录' : '已配置') : '匿名' }}
          </span>
        </div>
      </div>
    </nav>

    <!-- 主展示区 -->
    <main class="main" :inert="lyricOpen">
      <header v-if="route.name !== 'search'" class="app-topbar">
        <form class="global-search" role="search" @submit.prevent="search">
          <Icon name="search" size="18" />
          <input v-model="searchQuery" aria-label="搜索歌曲、歌手或专辑" placeholder="搜索歌曲、歌手或专辑">
          <button type="submit" class="ghost" aria-label="搜索" :disabled="!searchQuery.trim()"><Icon name="external" size="15" /></button>
        </form>
        <button class="ghost topbar-theme" :aria-label="settings.theme === 'light' ? '切换深色主题' : '切换浅色主题'" @click="settings.toggleTheme()"><Icon :name="settings.theme === 'light' ? 'moon' : 'sun'" size="19" /></button>
      </header>
      <!-- 平台离线告警 -->
      <div v-if="banners.length" class="notice warn">
        <div>
          <div v-for="line in banners" :key="line" style="font-weight: 500">{{ line }}</div>
          <div class="small muted" style="margin-top: 2px">可切换至其他平台，或在设置页检查连接状态。</div>
        </div>
      </div>

      <!-- 悬浮通知消息 -->
      <transition name="toast-fade">
        <div v-if="toast" class="toast-popup">
          <Icon name="check" size="15" style="color: var(--accent)" />
          <span>{{ toast }}</span>
        </div>
      </transition>

      <!-- 视图挂载 -->
      <div class="content-columns" :class="{ 'with-now-playing': player.current && route.name !== 'settings' }">
        <div class="page-content">
          <RouterView v-slot="{ Component }">
            <component :is="Component" @notify="showToast" />
          </RouterView>
        </div>
        <NowPlayingPanel v-if="route.name !== 'settings'" @open-lyric="lyricOpen = true; queueOpen = false; eqOpen = false" @open-queue="queueOpen = true; lyricOpen = false; eqOpen = false" @seek="seek" />
      </div>
    </main>

    <!-- 抽屉背景遮罩 -->
    <div
      v-if="queueOpen"
      class="drawer-backdrop"
      @click="queueOpen = false; lyricOpen = false"
    />

    <!-- 底部常驻播放条 -->
    <PlayerBar
      :queue-open="queueOpen"
      :lyric-open="lyricOpen"
      :eq-open="eqOpen"
      @toggle="toggle"
      @seek="seek"
      @switch-source="switchSource"
      @open-queue="queueOpen = !queueOpen; if (queueOpen) { lyricOpen = false; eqOpen = false; }"
      @open-lyric="lyricOpen = !lyricOpen; if (lyricOpen) { queueOpen = false; eqOpen = false; }"
      @open-eq="eqOpen = !eqOpen; if (eqOpen) { queueOpen = false; lyricOpen = false; }"
      @notify="showToast"
    />

    <!-- 抽屉组件 -->
    <QueueDrawer :open="queueOpen" @close="queueOpen = false" />
    <LyricDrawer :open="lyricOpen" @close="lyricOpen = false" @seek="seek" />
    <AudioFxDrawer :open="eqOpen" @close="eqOpen = false" />

    <!-- 播放致命异常弹条 -->
    <div
      v-if="errorText"
      class="notice error player-error-banner"
    >
      <Icon name="close" size="16" />
      <span>{{ errorText }}</span>
    </div>
  </div>
</template>

<style scoped>
.theme-toggle-btn {
  justify-content: flex-start;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  gap: 10px;
  margin-bottom: 6px;
  width: 100%;
}

.theme-toggle-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.toast-popup {
  position: fixed;
  top: 24px;
  right: 28px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13.5px;
  box-shadow: var(--shadow-lg);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.player-error-banner {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--player-height) + 16px);
  max-width: 600px;
  z-index: 200;
  box-shadow: var(--shadow-lg);
}
</style>
