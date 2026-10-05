import { onBeforeUnmount, ref } from 'vue';
import { artistNames, formatTime } from '@/format';
import { usePlayerStore } from '@/stores/player';

export function useDesktopLyricPip() {
  const player = usePlayerStore();
  const isPipActive = ref(false);
  const isSupported = ref(typeof document !== 'undefined' && 'pictureInPictureEnabled' in document);

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let video: HTMLVideoElement | null = null;
  let animId: number | null = null;

  function initElements() {
    if (canvas && video) return;
    canvas = document.createElement('canvas');
    canvas.width = 540;
    canvas.height = 300;
    ctx = canvas.getContext('2d');

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    video.addEventListener('enterpictureinpicture', () => {
      isPipActive.value = true;
    });
    video.addEventListener('leavepictureinpicture', () => {
      isPipActive.value = false;
      stopRender();
    });
  }

  function renderFrame() {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    // 1. 深色优雅背景
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. 标题与歌手
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    const artist = player.current ? artistNames(player.current) : '';
    const title = player.current?.title || '暂无播放';
    ctx.fillText(`${title} · ${artist}`, w / 2, 34);

    // 3. 歌词渲染
    const activeIdx = player.activeLyricIndex;
    const currentLine = activeIdx >= 0 ? player.lyric[activeIdx] : null;
    const prevLine = activeIdx > 0 ? player.lyric[activeIdx - 1] : null;
    const nextLine =
      activeIdx >= 0 && activeIdx < player.lyric.length - 1 ? player.lyric[activeIdx + 1] : null;

    // 前一句
    if (prevLine) {
      ctx.fillStyle = '#64748b';
      ctx.font = '15px sans-serif';
      ctx.fillText(prevLine.text, w / 2, 82);
    }

    // 当前主歌词（高亮大字）
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px sans-serif';
    const currentText = currentLine
      ? currentLine.text
      : player.current
        ? '♪ 音乐播放中 ♪'
        : 'Webmuic 桌面歌词';
    ctx.fillText(currentText, w / 2, 134);

    // 当前翻译（若有）
    if (currentLine?.translation) {
      ctx.fillStyle = '#a5f3fc';
      ctx.font = '15px sans-serif';
      ctx.fillText(currentLine.translation, w / 2, 168);
    }

    // 后一句
    if (nextLine) {
      ctx.fillStyle = '#64748b';
      ctx.font = '15px sans-serif';
      ctx.fillText(nextLine.text, w / 2, 215);
    }

    // 4. 底部播放进度条
    const progress =
      player.duration > 0 ? Math.min(1, Math.max(0, player.currentTime / player.duration)) : 0;
    const barY = 265;
    const barH = 4;
    const barPad = 40;
    const barW = w - barPad * 2;

    ctx.fillStyle = '#334155';
    ctx.fillRect(barPad, barY, barW, barH);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(barPad, barY, barW * progress, barH);

    // 时间显示
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(player.currentTime), barPad, barY + 18);
    ctx.textAlign = 'right';
    ctx.fillText(formatTime(player.duration), w - barPad, barY + 18);
  }

  function startRender() {
    if (animId) return;
    const loop = () => {
      renderFrame();
      animId = requestAnimationFrame(loop);
    };
    loop();
  }

  function stopRender() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  async function togglePip(): Promise<void> {
    if (!isSupported.value) return;
    initElements();
    if (!video || !canvas) return;

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
      return;
    }

    try {
      startRender();
      if (!video.srcObject) {
        const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(25);
        video.srcObject = stream ?? null;
      }
      await video.play().catch(() => {});
      await video.requestPictureInPicture();
    } catch {
      stopRender();
    }
  }

  onBeforeUnmount(() => {
    stopRender();
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
  });

  return {
    isPipActive,
    isSupported,
    togglePip,
  };
}
