<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { SearchResponse } from '@/api/types';
import TrackList from '@/components/TrackList.vue';
import { useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();
const settings = useSettingsStore();

const keyword = ref('');
const loading = ref(false);
const error = ref('');
const result = ref<SearchResponse | null>(null);
const suggestions = ref<string[]>([]);
const submitted = ref('');

const platforms = [
  { value: 'all', label: '全部平台' },
  { value: 'netease', label: '网易云' },
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

async function runSearch(offset = 0, append = false): Promise<void> {
  const query = keyword.value.trim();
  if (!query) return;
  loading.value = true;
  error.value = '';
  try {
    const body = await api.search({
      q: query,
      platform: settings.platform,
      limit: settings.limit,
      offset,
    });
    submitted.value = query;
    if (append && result.value) {
      // 追加时按 id 去重，避免两个平台穿插后重复
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

async function loadSuggestions(): Promise<void> {
  const query = keyword.value.trim();
  if (query.length < 2) {
    suggestions.value = [];
    return;
  }
  try {
    const body = await api.suggest(query);
    suggestions.value = body.suggestions;
  } catch {
    suggestions.value = [];
  }
}

function pickSuggestion(text: string): void {
  keyword.value = text;
  suggestions.value = [];
  void runSearch();
}

onMounted(() => {
  const saved = localStorage.getItem('webmuic:lastQuery');
  if (saved) keyword.value = saved;
});

async function rememberQuery(): Promise<void> {
  localStorage.setItem('webmuic:lastQuery', keyword.value.trim());
  await runSearch();
}
</script>

<template>
  <h1 class="page-title">搜索</h1>
  <p class="page-sub">一次搜索同时查询两个平台，结果按平台交替展示，平台标记在每行曲目上。</p>

  <div class="card" style="margin-bottom: 18px">
    <form class="row" @submit.prevent="rememberQuery">
      <input
        v-model="keyword"
        placeholder="歌名 / 歌手 / 专辑"
        style="flex: 1"
        @input="loadSuggestions"
      />
      <select v-model="settings.platform" style="width: 130px">
        <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
      </select>
      <button class="primary" type="submit" :disabled="loading || !keyword.trim()">
        {{ loading ? '搜索中…' : '搜索' }}
      </button>
    </form>
    <div v-if="suggestions.length" class="row wrap" style="margin-top: 10px">
      <button v-for="s in suggestions" :key="s" class="ghost small" @click="pickSuggestion(s)">{{ s }}</button>
    </div>
  </div>

  <div v-if="error" class="notice error">{{ error }}</div>
  <div v-else-if="degradedText" class="notice warn">{{ degradedText }}</div>

  <div v-if="result" class="row small muted" style="margin-bottom: 8px">
    <span>「{{ submitted }}」共 {{ result.tracks.length }} 条</span>
    <span v-if="result.totals.netease">· 网易云命中 {{ result.totals.netease }}</span>
    <span v-if="result.totals.qq">· QQ 命中 {{ result.totals.qq }}</span>
  </div>

  <TrackList
    v-if="result"
    :tracks="result.tracks"
    empty-text="没有找到结果，换个关键词试试"
    @error="emit('notify', $event)"
  />

  <div v-if="result && canLoadMore" class="row" style="justify-content: center; margin-top: 18px">
    <button :disabled="loading" @click="runSearch(result.tracks.length, true)">
      {{ loading ? '加载中…' : '加载更多' }}
    </button>
  </div>
</template>
