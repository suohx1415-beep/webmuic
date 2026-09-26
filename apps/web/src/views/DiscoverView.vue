<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { RecommendResponse } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();
const settings = useSettingsStore();

const data = ref<RecommendResponse | null>(null);
const loading = ref(false);
const error = ref('');

/** 网易云官方榜单精选 */
const NETEASE_PRESETS = [
  { id: 'netease:3778678', name: '热歌榜', desc: '全网高热度精选' },
  { id: 'netease:3779629', name: '新歌榜', desc: '流行新风向标' },
  { id: 'netease:19723756', name: '飙升榜', desc: '上升最快单曲' },
  { id: 'netease:2884035', name: '原创榜', desc: '独立音乐原创力量' },
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
  <div class="page-header row" style="justify-content: space-between; align-items: flex-start">
    <div>
      <h1 class="page-title">发现音乐</h1>
      <p class="page-sub">
        精选网易云每日推荐与官方权威榜单，聚合 QQ 音乐热门曲目。
      </p>
    </div>
    <button class="primary refresh-btn" :disabled="loading" @click="load">
      <Icon name="refresh" size="15" />
      <span>{{ loading ? '刷新中…' : '刷新推荐' }}</span>
    </button>
  </div>

  <div v-if="error" class="notice error">
    <Icon name="close" size="16" />
    <span>{{ error }}</span>
  </div>
  <div v-if="data?.degraded" class="notice warn">
    <Icon name="sparkles" size="16" />
    <div>
      <div v-for="p in data.degraded.platforms" :key="p">
        {{ p === 'netease' ? '网易云' : 'QQ 音乐' }}暂时不可用：{{ data.degraded.reasons[p] }}
      </div>
    </div>
  </div>

  <!-- 官方精选榜单快捷入口 -->
  <section class="section-container">
    <div class="section-header">
      <div class="section-title-wrap">
        <PlatformBadge platform="netease" />
        <h2 class="section-title">官方权威榜单</h2>
      </div>
    </div>
    <div class="preset-grid">
      <RouterLink
        v-for="item in NETEASE_PRESETS"
        :key="item.id"
        :to="`/playlist/${item.id}`"
        class="preset-card"
      >
        <div class="preset-icon">
          <Icon name="music" size="20" />
        </div>
        <div class="preset-info">
          <div class="preset-name">{{ item.name }}</div>
          <div class="preset-desc">{{ item.desc }}</div>
        </div>
        <Icon name="external" size="14" class="preset-arrow" />
      </RouterLink>
    </div>
  </section>

  <!-- 推荐板块列表 -->
  <section
    v-for="section in data?.sections ?? []"
    :key="section.platform"
    class="section-container"
  >
    <div class="section-header">
      <div class="section-title-wrap">
        <PlatformBadge :platform="section.platform" />
        <h2 class="section-title">{{ section.title }}</h2>
        <span class="track-count-tag">{{ section.tracks.length }} 首</span>
      </div>
      <RouterLink v-if="section.playlistId" :to="`/playlist/${section.playlistId}`">
        <button class="ghost see-all-btn">
          <span>查看完整歌单</span>
          <Icon name="external" size="13" />
        </button>
      </RouterLink>
    </div>

    <div v-if="section.source" class="section-source-hint">
      {{ section.source }}
    </div>

    <TrackList :tracks="section.tracks" @error="emit('notify', $event)" />
  </section>
</template>

<style scoped>
.refresh-btn {
  height: 38px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.section-container {
  margin-bottom: 36px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.2px;
}

.track-count-tag {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 1px 7px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
}

.see-all-btn {
  font-size: 12.5px;
  gap: 4px;
  padding: 4px 8px;
}

.section-source-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

/* 官方榜单卡片网格 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.preset-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.preset-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-default);
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.preset-card:hover .preset-arrow {
  opacity: 1;
  transform: translateX(0);
}

.preset-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: rgba(255, 51, 88, 0.1);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.preset-info {
  flex: 1;
  min-width: 0;
}

.preset-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.preset-desc {
  font-size: 11.5px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.preset-arrow {
  color: var(--text-tertiary);
  opacity: 0;
  transform: translateX(-4px);
  transition: all 0.15s ease;
}
</style>
