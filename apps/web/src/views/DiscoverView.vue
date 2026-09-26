<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { RecommendResponse } from '@/api/types';
import TrackList from '@/components/TrackList.vue';
import { useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();
const settings = useSettingsStore();

const data = ref<RecommendResponse | null>(null);
const loading = ref(false);
const error = ref('');

/** 网易云榜单：公开歌单 id 固定，可直接作为「发现」入口 */
const NETEASE_PRESETS = [
  { id: 'netease:3778678', name: '热歌榜' },
  { id: 'netease:3779629', name: '新歌榜' },
  { id: 'netease:19723756', name: '飙升榜' },
  { id: 'netease:2884035', name: '原创榜' },
];

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.recommendDaily(Math.max(settings.limit, 20));
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '推荐加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <h1 class="page-title">发现</h1>
  <p class="page-sub">
    网易云每日推荐 + QQ 平台曲目。QQ 没有面向匿名的每日推荐接口，这里用它公开的热歌歌单代替，来源如实标注。
  </p>

  <div class="row" style="margin-bottom: 16px">
    <button class="primary" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新推荐' }}</button>
  </div>

  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-if="data?.degraded" class="notice warn">
    <div v-for="p in data.degraded.platforms" :key="p">
      {{ p === 'netease' ? '网易云' : 'QQ 音乐' }}不可用：{{ data.degraded.reasons[p] }}
    </div>
  </div>

  <div class="card" style="margin-bottom: 20px">
    <strong>网易云榜单</strong>
    <div class="row wrap" style="margin-top: 10px">
      <RouterLink v-for="item in NETEASE_PRESETS" :key="item.id" :to="`/playlist/${item.id}`">
        <button>{{ item.name }}</button>
      </RouterLink>
    </div>
    <p class="small muted" style="margin: 10px 0 0">
      QQ 歌单需要具体 id（形如 <code>qq:7614366897</code>），可以从下方 QQ 热歌分组跳转。
    </p>
  </div>

  <section v-for="section in data?.sections ?? []" :key="section.platform" style="margin-bottom: 26px">
    <div class="row" style="margin-bottom: 8px">
      <h2 style="font-size: 16px; margin: 0">{{ section.title }}</h2>
      <span class="small muted">{{ section.tracks.length }} 首</span>
      <span class="spacer" />
      <RouterLink v-if="section.playlistId" :to="`/playlist/${section.playlistId}`">
        <button class="ghost">查看完整歌单</button>
      </RouterLink>
    </div>
    <div v-if="section.source" class="small muted" style="margin-bottom: 8px">{{ section.source }}</div>
    <TrackList :tracks="section.tracks" @error="emit('notify', $event)" />
  </section>
</template>
