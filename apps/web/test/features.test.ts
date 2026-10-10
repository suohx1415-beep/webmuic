import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../src/api/types';
import { useHistoryStore } from '../src/stores/history';
import { usePlayerStore } from '../src/stores/player';
import { useSleepTimerStore } from '../src/stores/sleepTimer';

function makeTrack(id: string): Track {
  return {
    id,
    platform: id.startsWith('local:') ? 'local' : 'netease',
    platformTrackId: id.split(':')[1] ?? id,
    title: `歌曲 ${id}`,
    artists: [{ name: '歌手' }],
    album: { name: '专辑' },
    durationMs: 200_000,
    qualities: [],
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('播放历史', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('同一首歌重复播放只保留一条并累计次数，按最近时间排序', () => {
    const history = useHistoryStore();
    history.record(makeTrack('netease:1'), 1000);
    history.record(makeTrack('netease:2'), 2000);
    history.record(makeTrack('netease:1'), 3000);
    expect(history.entries).toHaveLength(2);
    expect(history.recent.map((e) => e.track.id)).toEqual(['netease:1', 'netease:2']);
    expect(history.entries.find((e) => e.track.id === 'netease:1')?.count).toBe(2);
  });

  it('本周常听只统计最近 7 天，并按次数排序', () => {
    const history = useHistoryStore();
    const now = Date.now();
    history.record(makeTrack('netease:old'), now - 10 * DAY);
    history.record(makeTrack('netease:a'), now - DAY);
    history.record(makeTrack('netease:b'), now - 2 * DAY);
    history.record(makeTrack('netease:b'), now - DAY);
    expect(history.weeklyTop.map((item) => [item.entry.track.id, item.weekly])).toEqual([
      ['netease:b', 2],
      ['netease:a', 1],
    ]);
  });

  it('移除与清空', () => {
    const history = useHistoryStore();
    history.record(makeTrack('netease:1'));
    history.record(makeTrack('netease:2'));
    history.remove('netease:1');
    expect(history.entries.map((e) => e.track.id)).toEqual(['netease:2']);
    history.clear();
    expect(history.entries).toHaveLength(0);
  });
});

describe('下一首播放', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('插到当前曲目之后，已在队列里的会被挪过去而不是重复', () => {
    const player = usePlayerStore();
    const [a, b, c, d] = ['netease:a', 'netease:b', 'netease:c', 'netease:d'].map(makeTrack);
    player.setQueue([a!, b!, c!, d!], 1);
    player.playNext(d!);
    expect(player.queue.map((t) => t.id)).toEqual(['netease:a', 'netease:b', 'netease:d', 'netease:c']);
    expect(player.current?.id).toBe('netease:b');
  });

  it('当前曲目在被挪动歌曲之后时，索引仍指向当前曲目', () => {
    const player = usePlayerStore();
    const [a, b, c] = ['netease:a', 'netease:b', 'netease:c'].map(makeTrack);
    player.setQueue([a!, b!, c!], 2);
    player.playNext(a!);
    expect(player.queue.map((t) => t.id)).toEqual(['netease:b', 'netease:c', 'netease:a']);
    expect(player.current?.id).toBe('netease:c');
  });

  it('空队列时直接开始播放', () => {
    const player = usePlayerStore();
    player.playNext(makeTrack('local:x'));
    expect(player.current?.id).toBe('local:x');
    expect(player.playing).toBe(true);
  });
});

describe('定时关闭', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('倒计时结束时触发 expired 并自动取消', () => {
    const timer = useSleepTimerStore();
    timer.startMinutes(15);
    expect(timer.active).toBe(true);
    expect(timer.label).toBe('15:00');
    vi.advanceTimersByTime(14 * 60_000);
    expect(timer.expired).toBe(0);
    expect(timer.label).toBe('1:00');
    vi.advanceTimersByTime(60_000);
    expect(timer.expired).toBe(1);
    expect(timer.active).toBe(false);
  });

  it('「播完这首」模式不计时，取消后恢复关闭', () => {
    const timer = useSleepTimerStore();
    timer.startEndOfTrack();
    expect(timer.label).toBe('播完这首');
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(timer.expired).toBe(0);
    timer.cancel();
    expect(timer.mode).toBe('off');
  });
});
