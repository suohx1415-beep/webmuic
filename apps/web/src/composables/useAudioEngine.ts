import { useAudioFxStore, EQ_FREQUENCIES } from '@/stores/audioFx';

let audioCtx: AudioContext | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let biquadFilters: BiquadFilterNode[] = [];
let bassFilter: BiquadFilterNode | null = null;
let connectedElement: HTMLAudioElement | null = null;

export function initWebAudioFx(element: HTMLAudioElement): void {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }

  if (connectedElement !== element) {
    try {
      sourceNode = audioCtx.createMediaElementSource(element);
      connectedElement = element;
    } catch {
      // 避免重复连接同一个元素抛出的 InvalidStateError
      return;
    }

    // 创建多频段均衡器滤镜
    biquadFilters = EQ_FREQUENCIES.map((freq) => {
      const filter = audioCtx!.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = 0;
      return filter;
    });

    // 额外的重低音低通增强
    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 100;
    bassFilter.gain.value = 0;

    // 链式串联: Source -> Filters[0..N] -> BassFilter -> Destination
    let prevNode: AudioNode = sourceNode;
    for (const filter of biquadFilters) {
      prevNode.connect(filter);
      prevNode = filter;
    }
    prevNode.connect(bassFilter);
    bassFilter.connect(audioCtx.destination);
  }

  // 监听并同步 Store
  const store = useAudioFxStore();
  const applyParams = () => {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const enabled = store.enabled;
    biquadFilters.forEach((filter, idx) => {
      const targetGain = enabled ? store.gains[idx] ?? 0 : 0;
      filter.gain.setTargetAtTime(targetGain, audioCtx!.currentTime, 0.05);
    });

    if (bassFilter) {
      const targetBass = enabled ? store.bassBoost * 1.5 : 0;
      bassFilter.gain.setTargetAtTime(targetBass, audioCtx!.currentTime, 0.05);
    }
  };

  store.$subscribe(() => {
    applyParams();
  });

  applyParams();
}

export function resumeAudioContext(): void {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}
