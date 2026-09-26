<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { SearchResponse } from '@/api/types';
import Icon from '@/components/Icon.vue';
import TrackList from '@/components/TrackList.vue';
import { load, save, STORAGE_KEYS } from '@/storage';
import { useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();
const settings = useSettingsStore();

const keyword = ref('');
const loading = ref(false);
const error = ref('');
const result = ref<SearchResponse | null>(null);
const suggestions = ref<string[]>([]);
const submitted = ref('');
const currentPage = ref(0);

let suggestTimer: number | undefined;
let suggestAbort: AbortController | null = null;

const platforms = [
  { value: 'all', label: '双平台聚合' },
  { value: 'netease', label: '网易云音乐' },
  { value: 'qq', label: 'QQ 音乐' },
] as const;

const degradedText = computed(() => {
  const degraded = result.value?.degraded;
  if (!degraded) return '';
  return degraded.platforms
    .map((p) => `${p === 'netease' ? '网易云' : 'QQ 音乐'}：${degraded.reasons[p] ?? '不可用'}`)
    .join('；');
});

const canLoadMore = computed(() => {
  if (!result.value) return false;
  const loaded = result.value.tracks.length;
  const totals = result.value.totals;
  const maxTotal = Math.max(totals.netease ?? 0, totals.qq ?? 0);
  return maxTotal === 0 ? loaded > 0 : loaded < Math.min(maxTotal, 200);
});

async function runSearch(page = 0, append = false): Promise<void> {
  const query = keyword.value.trim();
  if (!query) return;
  loading.value = true;
  error.value = '';
  try {
    const body = await api.search({
      q: query,
      platform: settings.platform,
      limit: settings.limit,
      offset: page * settings.limit,
    });
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
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '搜索失败';
    if (!append) result.value = null;
  } finally {
    loading.value = false;
  }
}

function loadSuggestions(): void {
  if (suggestTimer) clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(async () => {
    const query = keyword.value.trim();
    if (query.length < 2) {
      suggestions.value = [];
      return;
    }
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    try {
      const body = await api.suggest(query);
      if (keyword.value.trim() === query) {
        suggestions.value = body.suggestions;
      }
    } catch {
      suggestions.value = [];
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
}

onMounted(() => {
  const saved = load(STORAGE_KEYS.lastQuery, '');
  if (saved) keyword.value = saved;
});

async function rememberQuery(): Promise<void> {
  save(STORAGE_KEYS.lastQuery, keyword.value.trim());
  await runSearch(0, false);
}
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">搜索曲库</h1>
    <p class="page-sub">
      跨平台智能检索网易云与 QQ 音乐，结果自动交替混合，即时切换音源。
    </p>
  </div>

  <!-- 搜索栏主容器 -->
  <div class="search-box-card">
    <form class="search-form-row" @submit.prevent="rememberQuery">
      <div class="search-input-wrapper">
        <Icon name="search" size="18" class="search-input-icon" />
        <input
          v-model="keyword"
          class="search-input-field"
          placeholder="搜索歌曲、歌手或专辑..."
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
        <select v-model="settings.platform">
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
  <div v-if="result" class="search-stats-bar">
    <div class="row" style="gap: 8px">
      <span class="stat-highlight">「{{ submitted }}」</span>
      <span class="muted">共检索到 {{ result.tracks.length }} 首结果</span>
    </div>
    <div class="row" style="gap: 8px">
      <span v-if="result.totals.netease" class="result-source-tag netease">
        网易云 {{ result.totals.netease }}
      </span>
      <span v-if="result.totals.qq" class="result-source-tag qq">
        QQ 音乐 {{ result.totals.qq }}
      </span>
    </div>
  </div>

  <!-- 曲目结果列表 -->
  <TrackList
    v-if="result"
    :tracks="result.tracks"
    empty-text="未找到匹配歌曲，尝试更换关键词或切换检索平台"
    @error="emit('notify', $event)"
  />

  <!-- 加载更多 -->
  <div v-if="result && canLoadMore" class="load-more-row">
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
  background: rgba(255, 255, 255, 0.04);
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
}

.result-source-tag.netease {
  color: #ff6b8b;
  border: 1px solid rgba(255, 75, 96, 0.2);
}

.result-source-tag.qq {
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
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
