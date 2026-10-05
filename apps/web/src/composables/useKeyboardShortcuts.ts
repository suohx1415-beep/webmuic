import { onBeforeUnmount, onMounted } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';

export function useKeyboardShortcuts(actions: {
  togglePlay: () => void;
  seek: (seconds: number) => void;
  toggleLyric: () => void;
  closeDrawers: () => void;
}) {
  const player = usePlayerStore();
  const settings = useSettingsStore();

  function onKeydown(e: KeyboardEvent) {
    // 若当前聚焦在 input / textarea / contenteditable 等表单元素，忽略全局快捷键
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active?.getAttribute('contenteditable') === 'true'
    ) {
      if (e.key === 'Escape') {
        (active as HTMLElement).blur();
        actions.closeDrawers();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        actions.togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        actions.seek(Math.max(0, player.currentTime - 5));
        break;
      case 'ArrowRight':
        e.preventDefault();
        actions.seek(Math.min(player.duration, player.currentTime + 5));
        break;
      case 'ArrowUp':
        e.preventDefault();
        settings.volume = Math.min(1, Number((settings.volume + 0.05).toFixed(2)));
        settings.muted = false;
        break;
      case 'ArrowDown':
        e.preventDefault();
        settings.volume = Math.max(0, Number((settings.volume - 0.05).toFixed(2)));
        if (settings.volume === 0) settings.muted = true;
        break;
      case 'BracketLeft': // [ 上一首
        e.preventDefault();
        player.advance(true);
        break;
      case 'BracketRight': // ] 下一首
        e.preventDefault();
        player.advance(false);
        break;
      case 'KeyM':
        e.preventDefault();
        settings.muted = !settings.muted;
        break;
      case 'KeyL':
        e.preventDefault();
        actions.toggleLyric();
        break;
      case 'Escape':
        e.preventDefault();
        actions.closeDrawers();
        break;
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
  });
}
