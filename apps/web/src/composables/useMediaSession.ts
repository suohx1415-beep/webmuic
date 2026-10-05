import { watch } from 'vue';
import { artistNames } from '@/format';
import { usePlayerStore } from '@/stores/player';

export function useMediaSession(handlers: {
  toggle: () => void;
  seek: (seconds: number) => void;
}) {
  const player = usePlayerStore();

  if (typeof window === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }

  const ms = navigator.mediaSession;

  // 注册系统快捷键与锁屏动作
  try {
    ms.setActionHandler('play', () => {
      if (!player.playing) handlers.toggle();
    });
    ms.setActionHandler('pause', () => {
      if (player.playing) handlers.toggle();
    });
    ms.setActionHandler('previoustrack', () => {
      player.advance(true);
    });
    ms.setActionHandler('nexttrack', () => {
      player.advance(false);
    });
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        handlers.seek(details.seekTime);
      }
    });
    ms.setActionHandler('seekforward', (details) => {
      const step = details.seekOffset ?? 10;
      handlers.seek(player.currentTime + step);
    });
    ms.setActionHandler('seekbackward', (details) => {
      const step = details.seekOffset ?? 10;
      handlers.seek(Math.max(0, player.currentTime - step));
    });
  } catch {
    // 某些环境或浏览器可能不支持部分 action
  }

  // 同步曲目元数据（标题、歌手、专辑、封面）
  watch(
    () => player.current,
    (track) => {
      if (!track) {
        ms.metadata = null;
        return;
      }
      if (typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: track.title,
          artist: artistNames(track),
          album: track.album.name || '未知专辑',
          artwork: track.album.coverUrl
            ? [
                { src: track.album.coverUrl, sizes: '96x96' },
                { src: track.album.coverUrl, sizes: '128x128' },
                { src: track.album.coverUrl, sizes: '256x256' },
                { src: track.album.coverUrl, sizes: '512x512' },
              ]
            : [],
        });
      }
    },
    { immediate: true },
  );

  // 同步播放状态
  watch(
    () => player.playing,
    (playing) => {
      ms.playbackState = playing ? 'playing' : 'paused';
    },
    { immediate: true },
  );

  // 同步进度状态
  watch(
    () => [player.currentTime, player.duration] as const,
    ([position, duration]) => {
      if ('setPositionState' in ms && duration > 0 && position >= 0 && position <= duration) {
        try {
          ms.setPositionState({
            duration,
            playbackRate: 1,
            position,
          });
        } catch {
          // ignore potential rounding out of bounds
        }
      }
    },
  );
}
