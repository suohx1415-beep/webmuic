import { onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError } from '@/api/client';
import type { LyricResponse } from '@/api/types';
import { initWebAudioFx, resumeAudioContext } from '@/composables/useAudioEngine';
import { offlineStorage } from '@/offlineStorage';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

/**
 * 音频元素与播放器 store 的桥接层。
 *
 * 关键点：src 永远指向网关的 /api/stream/...，浏览器因此只与本机通信；
 * 平台 CDN 地址、凭证都不会出现在页面里（验收标准 8）。
 * 拖动进度依赖网关把 Range 请求透传给平台 CDN。
 */
// 全局单例音频元素与生命周期控制，杜绝多组件实例重复创建硬件通道与幽灵重音
let singletonAudio: HTMLAudioElement | null = null;
let currentLoadToken = 0;
let currentLyricToken = 0;
let playAttempt = 0;
let bound = false;
let cachedLyricTrackId = '';
let cachedRawLyric: LyricResponse | null = null;
let currentObjectUrl = '';

export function useAudio() {
  const player = usePlayerStore();
  const settings = useSettingsStore();

  if (!singletonAudio && typeof Audio !== 'undefined') {
    singletonAudio = new Audio();
    singletonAudio.preload = 'auto';
    singletonAudio.crossOrigin = 'anonymous';
    initWebAudioFx(singletonAudio);
  }
  const element = singletonAudio!;

  const errorText = ref('');
  /** 连续解析失败次数：用来区分"单曲不可播"与"这批歌基本都要会员" */
  const consecutiveFailures = ref(0);

  async function playMedia(): Promise<void> {
    if (!player.streamUrl || player.loadingUrl || !player.playing) return;
    const attempt = ++playAttempt;
    const token = currentLoadToken;
    try {
      await element.play();
    } catch (error) {
      // 快速切歌或调用 pause() 会中断之前的 play() 请求并抛出 AbortError，属于正常控制流，静默忽略
      if (error instanceof Error && error.name === 'AbortError') return;
      if (attempt !== playAttempt || token !== currentLoadToken || !player.playing) return;
      player.playing = false;
      errorText.value = error instanceof Error && error.name === 'NotAllowedError'
        ? '浏览器阻止了自动播放，请点击播放按钮继续'
        : '播放失败，请点击播放按钮重试或切换歌曲';
    }
  }

  const onTimeUpdate = () => {
    if (!player.loadingUrl && player.streamUrl) player.currentTime = element.currentTime;
  };
  const onDurationChange = () => {
    if (player.streamUrl && Number.isFinite(element.duration)) player.mediaDuration = element.duration;
  };
  const onEnded = () => {
    if (!player.loadingUrl && player.streamUrl) player.advance(false);
  };
  const onError = () => {
    if (!player.streamUrl || player.loadingUrl || !element.error) return;
    player.playing = false;
    errorText.value = '音频加载失败，可能是地址已过期，请点击播放重试或切歌';
  };

  function bind(): void {
    if (bound) return;
    bound = true;
    element.volume = settings.muted ? 0 : settings.volume;
    element.muted = settings.muted;

    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('durationchange', onDurationChange);
    element.addEventListener('ended', onEnded);
    element.addEventListener('error', onError);
  }

  async function loadCurrent(): Promise<void> {
    const track = player.current;
    const token = ++currentLoadToken;
    ++playAttempt;
    player.loadingUrl = !!track;
    player.streamUrl = '';
    player.resolved = null;
    player.currentTime = 0;
    player.mediaDuration = 0;
    errorText.value = '';
    player.urlError = '';
    player.degradedNotice = '';
    element.pause();
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = '';
    }
    element.removeAttribute('src');
    element.load();
    if (!track) {
      player.lyric = [];
      consecutiveFailures.value = 0;
      return;
    }

    // 1. 优先尝试本地离线缓存
    try {
      const cachedBlob = await offlineStorage.getTrackBlob(track.id);
      if (cachedBlob && token === currentLoadToken && player.current?.id === track.id) {
        currentObjectUrl = URL.createObjectURL(cachedBlob);
        player.streamUrl = currentObjectUrl;
        player.degradedNotice = '正在播放本地离线缓存版本';
        consecutiveFailures.value = 0;
        element.src = currentObjectUrl;
        element.currentTime = 0;
        player.currentTime = 0;
        player.loadingUrl = false;
        resumeAudioContext();
        if (player.playing) await playMedia();
        return;
      }
    } catch {
      // 离线读取失败时自动回退在线网关流
    }

    try {
      const info = await api.trackUrl(track.id, settings.quality);
      if (token !== currentLoadToken || player.current?.id !== track.id) return;
      player.resolved = info;
      if (info.chorus && player.current) {
        player.current.chorus = info.chorus;
      }
      // 网关返回的是相对路径（/api/stream/...），这里保持同源
      player.streamUrl = info.url;
      if (info.degraded) {
        player.degradedNotice = `当前音质降级：${info.degraded.reason}`;
      }
      consecutiveFailures.value = 0;
      element.src = info.url;
      element.currentTime = 0;
      player.currentTime = 0;
      player.loadingUrl = false;
      resumeAudioContext();
      if (player.playing) await playMedia();
    } catch (e) {
      if (token !== currentLoadToken || player.current?.id !== track.id) return;
      const apiError = e instanceof ApiError ? e : null;
      const shouldContinue = player.playing;
      player.streamUrl = '';
      player.resolved = null;
      player.playing = false;
      consecutiveFailures.value += 1;

      if (apiError?.code === 'URL_UNAVAILABLE') {
        // 尝试跨平台智能找替补音轨
        try {
          const matchRes = await api.matchTrack(track.id);
          if (matchRes.bestMatch && token === currentLoadToken && player.current?.id === track.id) {
            const alt = matchRes.bestMatch;
            const targetPlatformName = alt.platform === 'netease' ? '网易云' : 'QQ 音乐';
            player.degradedNotice = `原曲暂无权限，已自动切换至【${targetPlatformName}】版本播放`;
            const newQueue = [...player.queue];
            newQueue[player.index] = alt;
            player.queue = newQueue;
            player.playing = shouldContinue;
            void loadCurrent();
            return;
          }
        } catch {
          // 匹配失败则继续走默认提示
        }

        const hint =
          track.platform === 'qq'
            ? 'QQ 会员曲需要先在「设置」里填 cookie'
            : '网易云该曲目当前凭证不可播，可在「设置」里登录会员账号';
        player.urlError = `《${track.title}》暂无可用播放地址：${hint}`;
        // 连续多首都不可播时，不再自动跳过，避免整列表空转
        if (shouldContinue && consecutiveFailures.value <= 3 && player.queue.length > 1) {
          player.advance(false, true);
          return;
        }
        consecutiveFailures.value = 0;
      } else {
        player.urlError = apiError?.message ?? '获取播放地址失败';
      }
      errorText.value = player.urlError;
    } finally {
      if (token === currentLoadToken) {
        player.loadingUrl = false;
      }
    }
  }

  async function loadLyric(): Promise<void> {
    const track = player.current;
    const token = ++currentLyricToken;
    player.lyric = [];
    player.lyricError = '';
    if (!track) return;

    // 内存缓存命中：切换翻译开关时无需重复发起 HTTP 请求，直接从内存重新拼装
    if (cachedLyricTrackId === track.id && cachedRawLyric) {
      const lines = player.parseLrc(cachedRawLyric.lrc);
      player.lyric = settings.showTranslation
        ? player.mergeTranslation(lines, cachedRawLyric.translated)
        : lines;
      if (lines.length === 0) player.lyricError = '这首歌没有可用的歌词';
      return;
    }

    try {
      const body = await api.lyric(track.id);
      if (token !== currentLyricToken || player.current?.id !== track.id) return;
      cachedLyricTrackId = track.id;
      cachedRawLyric = body;
      const lines = player.parseLrc(body.lrc);
      player.lyric = settings.showTranslation ? player.mergeTranslation(lines, body.translated) : lines;
      if (lines.length === 0) player.lyricError = '这首歌没有可用的歌词';
    } catch (e) {
      if (token !== currentLyricToken || player.current?.id !== track.id) return;
      player.lyricError = e instanceof ApiError ? e.message : '歌词加载失败';
    }
  }

  function seek(seconds: number): void {
    if (!Number.isFinite(seconds) || !player.streamUrl || player.loadingUrl) return;
    const end = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : player.duration;
    element.currentTime = Math.max(0, end > 0 ? Math.min(seconds, end) : seconds);
    player.currentTime = element.currentTime;
  }

  function toggle(): void {
    if (!player.current || player.loadingUrl) return;
    errorText.value = '';
    if (!player.streamUrl || element.error) {
      consecutiveFailures.value = 0;
      player.playing = true;
      void loadCurrent();
      return;
    }
    player.playing = !player.playing;
  }

  // 切歌 → 重新解析地址与歌词
  watch(
    () => player.current?.id,
    () => {
      void loadCurrent();
      void loadLyric();
    },
    { immediate: true },
  );

  // 播放/暂停状态 → 同步到媒体元素
  watch(
    () => player.playing,
    (shouldPlay) => {
      if (shouldPlay && element.paused && !player.loadingUrl) {
        void playMedia();
      } else if (!shouldPlay) {
        ++playAttempt;
        element.pause();
      }
    },
  );

  watch(() => player.restartRequest, () => {
    seek(0);
    if (player.playing) void playMedia();
  });

  watch(() => settings.showTranslation, () => void loadLyric());

  // 音量/静音
  watch(
    () => [settings.volume, settings.muted] as const,
    ([volume, muted]) => {
      element.volume = muted ? 0 : volume;
      element.muted = muted;
    },
  );

  // 音质偏好变化时重解析当前曲目
  watch(
    () => settings.quality,
    () => {
      if (player.current) void loadCurrent();
    },
  );

  onBeforeUnmount(() => {
    ++currentLoadToken;
    ++currentLyricToken;
    ++playAttempt;
    bound = false;
    element.pause();
    element.removeAttribute('src');
    element.load();
    element.removeEventListener('timeupdate', onTimeUpdate);
    element.removeEventListener('durationchange', onDurationChange);
    element.removeEventListener('ended', onEnded);
    element.removeEventListener('error', onError);
  });

  async function switchSource(): Promise<boolean> {
    const track = player.current;
    if (!track) return false;
    errorText.value = '正在跨平台寻找可用音源…';
    try {
      const matchRes = await api.matchTrack(track.id);
      if (!matchRes.bestMatch) {
        errorText.value = `未在${matchRes.targetPlatform === 'netease' ? '网易云' : 'QQ 音乐'}找到匹配曲目`;
        return false;
      }
      const alt = matchRes.bestMatch;
      const targetPlatformName = alt.platform === 'netease' ? '网易云' : 'QQ 音乐';
      const newQueue = [...player.queue];
      newQueue[player.index] = alt;
      player.queue = newQueue;
      player.degradedNotice = `已手动切换至【${targetPlatformName}】版本播放`;
      player.playing = true;
      errorText.value = '';
      void loadCurrent();
      return true;
    } catch (e) {
      errorText.value = e instanceof Error ? e.message : '换源失败';
      return false;
    }
  }

  return {
    element,
    errorText,
    bind,
    toggle,
    seek,
    reload: loadCurrent,
    switchSource,
  };
}
