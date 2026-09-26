import { onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError } from '@/api/client';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

/**
 * 音频元素与播放器 store 的桥接层。
 *
 * 关键点：src 永远指向网关的 /api/stream/...，浏览器因此只与本机通信；
 * 平台 CDN 地址、凭证都不会出现在页面里（验收标准 8）。
 * 拖动进度依赖网关把 Range 请求透传给平台 CDN。
 */
export function useAudio() {
  const player = usePlayerStore();
  const settings = useSettingsStore();

  const element = new Audio();
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';

  const errorText = ref('');
  /** 连续解析失败次数：用来区分"单曲不可播"与"这批歌基本都要会员" */
  const consecutiveFailures = ref(0);
  let currentLoadToken = 0;
  let currentLyricToken = 0;

  const onTimeUpdate = () => {
    player.currentTime = element.currentTime;
  };
  const onDurationChange = () => {
    if (Number.isFinite(element.duration)) player.mediaDuration = element.duration;
  };
  const onEnded = () => {
    if (player.mode === 'repeat-one') {
      element.currentTime = 0;
      void element.play().catch(() => undefined);
    } else {
      player.advance(false);
    }
  };
  const onError = () => {
    if (player.streamUrl) errorText.value = '音频加载失败，可能是地址已过期，请重试或切歌';
  };
  const onPlay = () => {
    if (!player.playing) player.playing = true;
  };
  const onPause = () => {
    if (player.playing) player.playing = false;
  };

  function bind(): void {
    element.volume = settings.muted ? 0 : settings.volume;

    element.addEventListener('timeupdate', onTimeUpdate);
    element.addEventListener('durationchange', onDurationChange);
    element.addEventListener('ended', onEnded);
    element.addEventListener('error', onError);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
  }

  async function loadCurrent(): Promise<void> {
    const track = player.current;
    const token = ++currentLoadToken;
    if (!track) {
      player.streamUrl = '';
      player.resolved = null;
      player.lyric = [];
      element.removeAttribute('src');
      player.loadingUrl = false;
      return;
    }

    player.loadingUrl = true;
    errorText.value = '';
    player.urlError = '';
    player.degradedNotice = '';

    try {
      const info = await api.trackUrl(track.id, settings.quality);
      if (token !== currentLoadToken || player.current?.id !== track.id) return;
      player.resolved = info;
      // 网关返回的是相对路径（/api/stream/...），这里保持同源
      player.streamUrl = info.url;
      if (info.degraded) {
        player.degradedNotice = `当前音质降级：${info.degraded.reason}`;
      }
      consecutiveFailures.value = 0;
      element.src = info.url;
      element.currentTime = 0;
      player.currentTime = 0;
      if (player.playing) await element.play().catch(() => undefined);
    } catch (e) {
      if (token !== currentLoadToken || player.current?.id !== track.id) return;
      const apiError = e instanceof ApiError ? e : null;
      player.streamUrl = '';
      player.resolved = null;
      player.playing = false;
      consecutiveFailures.value += 1;

      if (apiError?.code === 'URL_UNAVAILABLE') {
        const hint =
          track.platform === 'qq'
            ? 'QQ 会员曲需要先在「设置」里填 cookie'
            : '网易云该曲目当前凭证不可播，可在「设置」里登录会员账号';
        player.urlError = `《${track.title}》暂无可用播放地址：${hint}`;
        // 连续多首都不可播时，不再自动跳过，避免整列表空转
        if (consecutiveFailures.value <= 3 && player.queue.length > 1) {
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
    try {
      const body = await api.lyric(track.id);
      if (token !== currentLyricToken || player.current?.id !== track.id) return;
      const lines = player.parseLrc(body.lrc);
      player.lyric = settings.showTranslation ? player.mergeTranslation(lines, body.translated) : lines;
      if (lines.length === 0) player.lyricError = '这首歌没有可用的歌词';
    } catch (e) {
      if (token !== currentLyricToken || player.current?.id !== track.id) return;
      player.lyricError = e instanceof ApiError ? e.message : '歌词加载失败';
    }
  }

  function seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    element.currentTime = Math.max(0, seconds);
    player.currentTime = element.currentTime;
  }

  function toggle(): void {
    if (!player.current) return;
    if (element.paused) {
      player.playing = true;
      void element.play().catch(() => {
        player.playing = false;
      });
    } else {
      player.playing = false;
      element.pause();
    }
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
      if (shouldPlay && element.paused && player.streamUrl) {
        void element.play().catch(() => {
          player.playing = false;
        });
      } else if (!shouldPlay && !element.paused) {
        element.pause();
      }
    },
  );

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
    element.pause();
    element.removeAttribute('src');
    element.removeEventListener('timeupdate', onTimeUpdate);
    element.removeEventListener('durationchange', onDurationChange);
    element.removeEventListener('ended', onEnded);
    element.removeEventListener('error', onError);
    element.removeEventListener('play', onPlay);
    element.removeEventListener('pause', onPause);
  });

  return {
    element,
    errorText,
    bind,
    toggle,
    seek,
    reload: loadCurrent,
  };
}
