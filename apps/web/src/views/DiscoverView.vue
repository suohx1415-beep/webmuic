<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { RecommendResponse } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { useSettingsStore } from '@/stores/settings';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();
const settings = useSettingsStore();
const player = usePlayerStore();
const data = ref<RecommendResponse | null>(null);
const loading = ref(false);
const error = ref('');
let disposed = false;
const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
const tracks = computed(() => data.value?.tracks ?? []);
const presets = [
  { id: 'netease:3778678', name: '热歌榜', color: 'coast', icon: 'music' },
  { id: 'netease:3779629', name: '新歌榜', color: 'sun', icon: 'album' },
  { id: 'netease:19723756', name: '飙升榜', color: 'leaf', icon: 'sparkles' },
  { id: 'netease:2884035', name: '原创榜', color: 'city', icon: 'lyrics' },
] as const;
async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.recommendDaily(Math.max(settings.limit, 20));
    if (!disposed) data.value = result;
  } catch (e) {
    if (!disposed) error.value = e instanceof ApiError ? e.message : '推荐加载失败，请重试';
  } finally {
    if (!disposed) loading.value = false;
  }
}
function playRecommendations(): void {
  const first = tracks.value[0];
  if (first) player.playTrackList(tracks.value, first);
}
onMounted(load);
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <div class="page-header discover-header">
    <h1 class="page-title">发现音乐</h1>
    <button class="ghost" :disabled="loading" @click="load"><Icon name="refresh" size="15" />{{ loading ? '刷新中…' : '刷新推荐' }}</button>
  </div>
  <section class="daily-feature" aria-label="今日推荐">
    <svg class="sunset-scene" viewBox="0 0 900 310" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <mask id="sun-stripes">
          <rect width="900" height="310" fill="#fff" />
          <g fill="#000"><rect x="600" y="170" width="200" height="4" /><rect x="600" y="183" width="200" height="6" /><rect x="600" y="198" width="200" height="8" /><rect x="600" y="215" width="200" height="10" /></g>
        </mask>
      </defs>
      <rect class="sky" width="900" height="310" />
      <circle class="sun-disc" cx="700" cy="206" r="80" mask="url(#sun-stripes)" />
      <path class="hill-far" d="M0 232q120-46 250-20t250-8 230-30 170 14v122H0Z" />
      <path class="hill-mid" d="M0 262q160-40 330-6t300-14 270 4v64H0Z" />
      <path class="hill-near" d="M0 288q220-30 470-4t430-8v34H0Z" />
      <g class="birds" fill="none" stroke-width="2" stroke-linecap="round"><path d="M520 150q8-8 16 0 8-8 16 0" /><path d="M560 172q6-6 12 0 6-6 12 0" /></g>
    </svg>
    <div class="feature-content"><span class="feature-eyebrow">今日推荐 · {{ today }}</span><h2>把这一刻<br>交给音乐。</h2>
      <button class="feature-play" :disabled="loading || !tracks.length" @click="playRecommendations"><Icon name="play" size="15" />{{ loading ? '正在加载' : '播放今日推荐' }}</button>
    </div>
    <span v-if="tracks.length" class="feature-count">{{ tracks.length }} 首</span>
  </section>
  <div v-if="error" class="notice error" role="alert"><span>{{ error }}</span><button class="ghost" @click="load">重试</button></div>
  <div v-if="data?.degraded" class="notice warn" role="status"><div><div v-for="p in data.degraded.platforms" :key="p">{{ p === 'netease' ? '网易云' : 'QQ 音乐' }}暂时不可用：{{ data.degraded.reasons[p] }}</div></div></div>
  <section class="discover-section">
    <div class="section-heading"><h2>精选榜单</h2><PlatformBadge platform="netease" /></div>
    <div class="chart-grid">
      <RouterLink v-for="item in presets" :key="item.id" :to="`/playlist/${item.id}`" class="chart-link">
        <div class="chart-art" :class="item.color"><span class="art-circle"/><span class="art-wave"/><Icon :name="item.icon" size="48" /><strong>{{ item.name }}</strong></div>
        <span class="chart-name">{{ item.name }}<Icon name="external" size="13" /></span>
      </RouterLink>
    </div>
  </section>
  <div v-if="loading && !data" class="recommend-loading" role="status" aria-live="polite">正在加载推荐…</div>
  <section v-for="section in data?.sections ?? []" :key="section.platform" class="discover-section">
    <div class="section-heading"><div class="section-title-row"><h2>{{ section.title }}</h2><PlatformBadge :platform="section.platform" /></div><RouterLink v-if="section.playlistId" :to="`/playlist/${section.playlistId}`" class="view-playlist">完整歌单 <Icon name="external" size="13" /></RouterLink></div>
    <TrackList :tracks="section.tracks" @error="emit('notify', $event)" />
  </section>
  <div v-if="!loading && data && !tracks.length" class="notice">暂无推荐，<RouterLink to="/search">去搜索音乐</RouterLink></div>
</template>

<style scoped>
.discover-header{display:flex;align-items:center;justify-content:space-between;gap:12px}.discover-header>button{font-size:12px;white-space:nowrap}
.daily-feature{--sky:#f1e4cc;--sun:#d97757;--hill-far:#d9b98c;--hill-mid:#b4794f;--hill-near:#6e5340;--ink:#2b2118;--bird:#6e5340;position:relative;isolation:isolate;overflow:hidden;min-height:270px;border-radius:var(--radius-lg);background:var(--sky);margin-bottom:34px;color:var(--ink);border:1px solid var(--border-default)}
:root[data-theme='dark'] .daily-feature{--sky:#3a2f28;--sun:#d97757;--hill-far:#5a4434;--hill-mid:#4a372b;--hill-near:#2f2621;--ink:#f6ead8;--bird:#c9a98a}
.sunset-scene{position:absolute;inset:0;width:100%;height:100%;z-index:-1}.sky{fill:var(--sky)}.sun-disc{fill:var(--sun)}.hill-far{fill:var(--hill-far)}.hill-mid{fill:var(--hill-mid)}.hill-near{fill:var(--hill-near)}.birds{stroke:var(--bird)}
.feature-content{padding:34px 36px}.feature-eyebrow{display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.75;margin-bottom:14px}
.feature-content h2{font-family:var(--font-serif);font-size:40px;line-height:1.3;font-weight:500;letter-spacing:.5px;margin:0 0 26px}
.feature-play{background:var(--ink);color:var(--sky);border:0;border-radius:999px;padding:11px 22px;font-size:12.5px}.feature-play:hover:not(:disabled){background:var(--sun);color:#fffefb}.feature-play:disabled{opacity:.6}
.feature-count{position:absolute;right:24px;bottom:20px;font-size:12px;color:#f6ead8;font-variant-numeric:tabular-nums}
.discover-section{margin-bottom:34px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border-default)}.section-heading h2{font-size:20px;font-weight:500;margin:0}.section-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.view-playlist{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-secondary);white-space:nowrap}.view-playlist:hover{color:var(--accent)}
.chart-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.chart-link{min-width:0;color:inherit}
.chart-art{position:relative;isolation:isolate;overflow:hidden;aspect-ratio:1.35;border-radius:var(--radius-md);padding:18px 20px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;color:#fbf6ea;transition:transform 180ms ease}.chart-link:hover .chart-art{transform:translateY(-2px)}
.chart-art strong{font-family:var(--font-serif);font-size:23px;font-weight:500;position:relative}.chart-art>.icon{position:relative;opacity:.85}
.coast{background:#4f6f73}.sun{background:#c08a3e}.leaf{background:#6f7d4e}.city{background:#a5533a}
.art-circle{position:absolute;width:80%;aspect-ratio:1;border-radius:50%;border:14px solid #fbf6ea22;right:-22%;top:-24%;z-index:-1}.art-wave{position:absolute;width:160%;height:70%;border-radius:50%;background:#1919171a;left:-30%;bottom:-32%;transform:rotate(-12deg);z-index:-1}
.chart-name{display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-size:13px}.chart-name>.icon{color:var(--text-tertiary)}
.recommend-loading{padding:35px 0;color:var(--text-secondary);text-align:center}.notice{justify-content:space-between}
@media(min-width:1600px){.daily-feature{min-height:310px}.feature-content{padding:42px}.feature-content h2{font-size:44px}}
@media(max-width:600px){.daily-feature{min-height:250px}.feature-content{padding:26px 22px}.feature-content h2{font-size:32px}.chart-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 14px}.chart-art{padding:16px}.chart-art strong{font-size:20px}.section-heading h2{font-size:18px}.view-playlist{font-size:11px}}
@media(prefers-reduced-motion:reduce){.chart-art{transition:none}}
</style>
