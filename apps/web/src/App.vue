<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import LyricDrawer from '@/components/LyricDrawer.vue';
import PlayerBar from '@/components/PlayerBar.vue';
import QueueDrawer from '@/components/QueueDrawer.vue';
import { useAudio } from '@/composables/useAudio';
import { useAuthStore } from '@/stores/auth';
import { usePlayerStore } from '@/stores/player';

const player = usePlayerStore();
const auth = useAuthStore();
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
    .map((h) => `${h.platform === 'netease' ? '网易云' : 'QQ 音乐'}后端不可达：${h.detail ?? '连接失败'}`),
);

onMounted(async () => {
  bind();
  player.playing = false;
  await auth.refresh();
});
</script>

<template>
  <div class="layout">
    <nav class="sidebar">
      <div class="brand">
        webmuic
        <small>网易云 + QQ 音乐 · 仅本机</small>
      </div>
      <RouterLink to="/search" class="nav-item" active-class="active">🔍 搜索</RouterLink>
      <RouterLink to="/discover" class="nav-item" active-class="active">✨ 发现</RouterLink>
      <RouterLink to="/favorites" class="nav-item" active-class="active">★ 收藏</RouterLink>
      <RouterLink to="/settings" class="nav-item" active-class="active">⚙ 设置</RouterLink>
      <span class="spacer" />
      <div class="small muted" style="padding: 0 10px">
        <div v-for="status in auth.statuses" :key="status.platform">
          {{ status.platform === 'netease' ? '网易云' : 'QQ' }}：
          {{ status.state === 'configured' ? (status.hasMemberKey ? '已登录' : '已配置') : '匿名' }}
        </div>
      </div>
    </nav>

    <main class="main">
      <div v-if="banners.length" class="notice warn">
        <div v-for="line in banners" :key="line">{{ line }}</div>
        <div class="small muted">对应平台的曲目会自动跳过，另一个平台可正常使用。</div>
      </div>
      <div v-if="toast" class="notice">{{ toast }}</div>
      <RouterView v-slot="{ Component }">
        <component :is="Component" @notify="showToast" />
      </RouterView>
    </main>

    <PlayerBar
      :queue-open="queueOpen"
      :lyric-open="lyricOpen"
      @toggle="toggle"
      @seek="seek"
      @open-queue="queueOpen = !queueOpen"
      @open-lyric="lyricOpen = !lyricOpen"
    />

    <QueueDrawer :open="queueOpen" @close="queueOpen = false" />
    <LyricDrawer :open="lyricOpen" @close="lyricOpen = false" />

    <div v-if="errorText" class="notice error" style="position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--player-height) + 14px); max-width: 620px; z-index: 30">
      {{ errorText }}
    </div>
  </div>
</template>
