<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
import { artistNames, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; seek: [seconds: number] }>();
const player = usePlayerStore();
const settings = useSettingsStore();
const listRef = ref<HTMLElement | null>(null);
const isUserScrolling = ref(false);
const coverFailed = ref(false);
let resumeTimer: number | undefined;
const cover = computed(() => coverFailed.value ? '' : player.current?.album.coverUrl ?? '');

const chorusLineIndex = computed(() => {
  const chorus = player.current?.chorus;
  if (!chorus) return -1;
  let bestIdx = -1;
  let minDiff = Infinity;
  player.lyric.forEach((line, i) => {
    const diff = Math.abs(line.time - chorus.startTimeMs / 1000);
    if (diff < minDiff) { minDiff = diff; bestIdx = i; }
  });
  return minDiff <= 3.5 ? bestIdx : -1;
});

async function scrollToActive(force = false): Promise<void> {
  if (!props.open || (!force && isUserScrolling.value)) return;
  await nextTick();
  const container = listRef.value;
  const line = container?.querySelector<HTMLElement>(`[data-line="${Math.max(0, player.activeLyricIndex)}"]`);
  if (!container || !line) return;
  const target = Math.max(0, line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2);
  // 若目标滚动位置与当前几乎一致，跳过滚动以减少动画重绘
  if (Math.abs(container.scrollTop - target) < 4) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
}

let lastManualScrollTime = 0;
function onManualScroll(): void {
  const now = Date.now();
  if (now - lastManualScrollTime < 120) return;
  lastManualScrollTime = now;
  isUserScrolling.value = true;
  clearTimeout(resumeTimer);
  resumeTimer = window.setTimeout(resumeAutoScroll, 4000);
}
function resumeAutoScroll(): void {
  isUserScrolling.value = false;
  clearTimeout(resumeTimer);
  void scrollToActive(true);
}
function onLineClick(line: { time: number }): void {
  if (!player.streamUrl || player.loadingUrl) return;
  emit('seek', line.time);
  player.playing = true;
  resumeAutoScroll();
}
function jumpToChorus(): void {
  if (player.current?.chorus) onLineClick({ time: player.current.chorus.startTimeMs / 1000 });
}
watch(() => player.current?.album.coverUrl, () => { coverFailed.value = false; });
watch(() => [player.activeLyricIndex, player.lyric] as const, () => void scrollToActive());
watch(() => props.open, (open) => {
  clearTimeout(resumeTimer);
  if (open) resumeAutoScroll();
});
onBeforeUnmount(() => clearTimeout(resumeTimer));
</script>

<template>
  <section v-if="open" class="listening-room" role="region" aria-label="正在播放">
    <div class="listening-atmosphere" aria-hidden="true">
      <img v-if="cover" :src="cover" alt="" />
    </div>
    <header class="listening-header">
      <span class="listening-label"><Icon name="music" size="16" /> 正在播放</span>
      <button id="close-listening" class="ghost listening-close" aria-label="退出沉浸播放" @click="emit('close')">
        <span>返回曲库</span><Icon name="close" size="18" />
      </button>
    </header>

    <div class="listening-stage">
      <div class="record-panel">
        <div class="record-artwork">
          <img v-if="cover" :src="cover" :alt="`${player.current?.album.name || player.current?.title} 封面`" @error="coverFailed = true" />
          <div v-else class="record-placeholder" aria-hidden="true">
            <div class="record-groove"><Icon name="music" size="38" /></div>
          </div>
        </div>
        <div class="record-info">
          <div class="record-source">
            <PlatformBadge v-if="player.current" :platform="player.current.platform" />
            <span v-if="player.resolved" class="record-quality">{{ player.resolved.qualityLabel }}</span>
          </div>
          <h2>{{ player.current?.title ?? '让音乐占据这一刻' }}</h2>
          <p class="record-artist">{{ player.current ? artistNames(player.current) : '从曲库挑选一首喜欢的歌' }}</p>
          <p v-if="player.current?.album.name" class="record-album">{{ player.current.album.name }}</p>
          <button v-if="player.current?.chorus" class="record-chorus" :disabled="!player.streamUrl || player.loadingUrl" @click="jumpToChorus">
            <Icon name="flame" size="15" /> 跳至副歌 <span>{{ formatTime(player.current.chorus.startTimeMs / 1000) }}</span>
          </button>
        </div>
      </div>

      <div class="lyrics-panel">
        <div class="lyrics-toolbar">
          <span>歌词 <span class="lyrics-hint">点击一句，从这里听</span></span>
          <button class="ghost translation-toggle" :aria-pressed="settings.showTranslation" @click="settings.showTranslation = !settings.showTranslation">
            {{ settings.showTranslation ? '译文已开启' : '显示译文' }}
          </button>
        </div>
        <div ref="listRef" class="listening-lyrics" tabindex="0" aria-label="歌词，可上下滚动" @wheel="onManualScroll" @touchstart="onManualScroll" @keydown.up="onManualScroll" @keydown.down="onManualScroll" @keydown.page-up="onManualScroll" @keydown.page-down="onManualScroll">
          <div v-if="player.lyricError || !player.lyric.length" class="listening-empty" role="status">
            <Icon name="lyrics" size="30" />
            <p>{{ player.lyricError || (player.current ? '等待歌词' : '还没有正在播放的歌曲') }}</p>
            <span>{{ player.current ? '音乐与播放控制仍在这里' : '返回曲库，搜索或发现你喜欢的音乐' }}</span>
            <button v-if="!player.current" class="ghost" @click="emit('close')">返回曲库</button>
          </div>
          <div v-else class="listening-lines">
            <button
              v-for="(line, i) in player.lyric"
              :key="`${i}-${line.time}`"
              class="listening-line"
              :class="{ 'is-current': i === player.activeLyricIndex }"
              :data-line="i"
              :aria-current="i === player.activeLyricIndex ? 'true' : undefined"
              :aria-label="`${line.text}，跳至 ${formatTime(line.time)}`"
              :disabled="!player.streamUrl || player.loadingUrl"
              @click="onLineClick(line)"
            >
              <span v-if="i === chorusLineIndex" class="listening-chorus-label"><Icon name="flame" size="12" /> 副歌</span>
              <!-- 支持卡拉OK逐字高亮动效 -->
              <span v-if="line.words && i === player.activeLyricIndex" class="karaoke-text">
                <span
                  v-for="(w, wi) in line.words"
                  :key="wi"
                  class="karaoke-word"
                  :class="{ 'is-sung': player.currentTime >= w.start }"
                >{{ w.text }}</span>
              </span>
              <span v-else class="normal-text">{{ line.text }}</span>
              <span v-if="line.translation" class="listening-translation">{{ line.translation }}</span>
            </button>
          </div>
        </div>
        <div class="lyrics-follow">
          <button v-if="isUserScrolling && player.activeLyricIndex >= 0" class="ghost" @click="resumeAutoScroll"><Icon name="play" size="12" /> 回到正在播放</button>
          <span v-else>{{ player.playing ? '歌词随音乐滚动' : '慢慢听，不着急' }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.listening-room {
  --listen-bg: #1f1b17;
  --listen-text: #f6ead8;
  --listen-secondary: #c3b39c;
  --listen-quiet: #93856f;
  position: fixed;
  inset: 0 0 var(--player-height);
  z-index: 160;
  isolation: isolate;
  overflow: hidden;
  background: var(--listen-bg);
  color: var(--listen-text);
  display: flex;
  flex-direction: column;
  animation: room-enter 220ms ease-out;
}
:root[data-theme='light'] .listening-room {
  --listen-bg: #f3ebdb;
  --listen-text: #2b2118;
  --listen-secondary: #6b5a47;
  --listen-quiet: #857560;
}
.listening-atmosphere { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.listening-atmosphere img { width: 100%; height: 100%; object-fit: cover; filter: blur(90px) saturate(.65); opacity: .2; transform: scale(1.2); }
.listening-header { display: flex; justify-content: space-between; align-items: center; padding: 22px 4vw; flex-shrink: 0; }
.listening-label { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--listen-secondary); }
.listening-room .listening-close { color: var(--listen-text); min-height: 44px; gap: 18px; }
.listening-stage { width: min(1200px, 100%); margin: 0 auto; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(48px, 8vw, 140px); padding: 12px 5vw 40px; }
.record-panel { align-self: center; min-width: 0; }
.record-artwork { width: min(100%, 42vh, 420px); aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: var(--bg-elevated); box-shadow: 0 22px 65px #0004, 0 0 0 1px #ffffff12; }
.record-artwork > img { width: 100%; height: 100%; display: block; object-fit: cover; }
.record-placeholder { width: 100%; height: 100%; display: grid; place-items: center; background: #2b2118; color: #c3b39c; }
.record-groove { width: 76%; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; background: repeating-radial-gradient(circle, #1c1612 0 3px, #352b23 4px 5px); }
.record-groove .app-icon { box-sizing: content-box; padding: 20px; background: #b5532f; color: #fbf6ea; border-radius: 50%; }
.record-info { padding-top: 26px; }
.record-source { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 20px; }
.record-quality { font-size: 11px; color: var(--listen-secondary); }
.record-info h2 { font-family: var(--font-serif); margin: 12px 0 6px; font-size: clamp(24px, 2.6vw, 38px); line-height: 1.25; font-weight: 500; letter-spacing: -.01em; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.record-artist { font-size: 16px; color: var(--listen-secondary); margin: 0; }
.record-album { color: var(--listen-quiet); font-size: 13px; margin: 6px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.listening-room .record-chorus { margin-top: 22px; padding: 8px 12px; color: var(--listen-text); background: transparent; border-color: var(--border-default); border-radius: 24px; font-size: 12px; }
.record-chorus span { color: var(--listen-secondary); font-variant-numeric: tabular-nums; margin-left: 8px; }
.lyrics-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.lyrics-toolbar { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--listen-secondary); min-height: 44px; }
.lyrics-hint { margin-left: 16px; color: var(--listen-quiet); font-size: 11px; }
.listening-room .translation-toggle { color: var(--listen-secondary); font-size: 12px; min-height: 40px; }
.listening-lyrics { flex: 1; min-height: 0; position: relative; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; mask-image: linear-gradient(transparent, #000 12%, #000 84%, transparent); }
.listening-lyrics::-webkit-scrollbar { display: none; }
.listening-lines { padding: 42% 0; display: flex; flex-direction: column; align-items: stretch; gap: 18px; }
.listening-room .listening-line { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 6px; border: 0; border-radius: 6px; color: var(--listen-quiet); background: transparent; box-shadow: none; text-align: left; font-size: clamp(21px, 2.2vw, 30px); font-weight: 600; line-height: 1.5; transition: color 200ms ease; transform: none; opacity: 1; overflow-wrap: anywhere; }
.listening-room .listening-line:hover:not(:disabled), .listening-room .listening-line:focus-visible { color: var(--listen-text); background: transparent; }
.listening-room .listening-line.is-current { color: var(--listen-text); }
.karaoke-text { display: inline; }
.karaoke-word {
  display: inline;
  color: var(--listen-secondary);
  transition: color 150ms ease, text-shadow 200ms ease;
}
.karaoke-word.is-sung {
  color: var(--listen-text);
  text-shadow: none;
}
.listening-translation { color: var(--listen-secondary); font-size: .53em; font-weight: 400; line-height: 1.6; }
.listening-chorus-label { display: inline-flex; align-items: center; gap: 4px; color: var(--listen-secondary); font-size: 10px; font-weight: 400; }
.listening-empty { min-height: 100%; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; color: var(--listen-secondary); gap: 10px; padding: 20px; }
.listening-empty p { margin: 0; font-size: 20px; color: var(--listen-text); }
.listening-empty > span { font-size: 13px; }
.lyrics-follow { min-height: 44px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--listen-quiet); }
.listening-room .lyrics-follow button { color: var(--listen-text); min-height: 40px; font-size: 12px; }
@keyframes room-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@media (max-width: 768px) {
  .listening-header { padding: 8px 18px; }
  .listening-stage { display: flex; flex-direction: column; gap: 22px; padding: 12px 24px 0; }
  .record-panel { width: 100%; display: flex; align-items: center; gap: 18px; }
  .record-artwork { width: 88px; flex-shrink: 0; border-radius: 8px; box-shadow: 0 8px 20px #0003; }
  .record-info { min-width: 0; padding: 0; }
  .record-info h2 { font-size: 22px; margin-top: 6px; }
  .record-artist { font-size: 13px; }
  .record-album, .record-quality { display: none; }
  .listening-room .record-chorus { margin-top: 8px; padding: 4px 8px; font-size: 11px; }
  .lyrics-panel { flex: 1; }
  .lyrics-hint { display: none; }
  .listening-room .listening-line { font-size: 23px; padding: 10px 4px; }
  .listening-lines { padding: 40% 0; gap: 14px; }
  .record-groove .app-icon { width: 20px; height: 20px; padding: 8px; }
}
@media (max-height: 600px) and (min-width: 769px) {
  .listening-header { padding-block: 8px; }
  .listening-stage { padding-bottom: 12px; }
  .record-panel { display: flex; gap: 20px; align-items: center; }
  .record-artwork { width: 130px; flex-shrink: 0; }
  .record-info { padding: 0; min-width: 0; }
  .record-info h2 { font-size: 22px; }
}
@media (prefers-reduced-motion: reduce) { .listening-room { animation: none; } .listening-line { transition: none; } }
</style>
