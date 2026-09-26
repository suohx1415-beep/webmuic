<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import LyricDrawer from '@/components/LyricDrawer.vue';
import PlayerBar from '@/components/PlayerBar.vue';
import QueueDrawer from '@/components/QueueDrawer.vue';
import { useAudio } from '@/composables/useAudio';
import { useAuthStore } from '@/stores/auth';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const player = usePlayerStore();
const auth = useAuthStore();
const settings = useSettingsStore();
const { errorText, bind, toggle, seek } = useAudio();

const queueOpen = ref(false);
const lyricOpen = ref(false);
const toast = ref('');
let toastTimer: number | undefined;

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
  <div class="layout">
    <!-- 侧边导航栏 -->
    <nav class="sidebar">
      <div class="brand-wrapper">
        <div class="brand-logo">
          <Icon name="music" size="18" />
        </div>
        <div class="brand-info">
          <div class="brand-title">webmuic</div>
          <div class="brand-subtitle">聚合双平台 · 纯净播放器</div>
        </div>
      </div>

      <div class="nav-group-title">浏览</div>
      <RouterLink to="/search" class="nav-item" active-class="active">
        <Icon name="search" size="17" />
        <span>搜索曲库</span>
      </RouterLink>
      <RouterLink to="/discover" class="nav-item" active-class="active">
        <Icon name="discover" size="17" />
        <span>发现推荐</span>
      </RouterLink>

      <div class="nav-group-title" style="margin-top: 10px">我的</div>
      <RouterLink to="/favorites" class="nav-item" active-class="active">
        <Icon name="heart" size="17" />
        <span>我的收藏</span>
      </RouterLink>
      <RouterLink to="/settings" class="nav-item" active-class="active">
        <Icon name="settings" size="17" />
        <span>偏好与凭证</span>
      </RouterLink>

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
    <main class="main">
      <!-- 平台离线告警 -->
      <div v-if="banners.length" class="notice warn">
        <div>
          <div v-for="line in banners" :key="line" style="font-weight: 500">{{ line }}</div>
          <div class="small muted" style="margin-top: 2px">离线平台的曲目会自动跳过，其余平台正常可用。可在设置页检查状态。</div>
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
      <RouterView v-slot="{ Component }">
        <component :is="Component" @notify="showToast" />
      </RouterView>
    </main>

    <!-- 抽屉背景遮罩 -->
    <div
      v-if="queueOpen || lyricOpen"
      class="drawer-backdrop"
      @click="queueOpen = false; lyricOpen = false"
    />

    <!-- 底部常驻播放条 -->
    <PlayerBar
      :queue-open="queueOpen"
      :lyric-open="lyricOpen"
      @toggle="toggle"
      @seek="seek"
      @open-queue="queueOpen = !queueOpen; if (queueOpen) lyricOpen = false;"
      @open-lyric="lyricOpen = !lyricOpen; if (lyricOpen) queueOpen = false;"
    />

    <!-- 抽屉组件 -->
    <QueueDrawer :open="queueOpen" @close="queueOpen = false" />
    <LyricDrawer :open="lyricOpen" @close="lyricOpen = false" />

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
