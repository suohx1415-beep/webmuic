import { describe, expect, it } from 'vitest';
import { QUALITY_LADDER, isQualityLevel, parseTrackId, trackId } from '../src/types.js';

describe('trackId', () => {
  it('拼装与解析互为逆运算', () => {
    const id = trackId('netease', '12345');
    expect(id).toBe('netease:12345');
    expect(parseTrackId(id)).toEqual({ platform: 'netease', platformTrackId: '12345' });
  });

  it('QQ 的 songmid 里含字母也照常解析', () => {
    expect(parseTrackId('qq:0039MnYb0qxYhV')).toEqual({
      platform: 'qq',
      platformTrackId: '0039MnYb0qxYhV',
    });
  });

  it('非法 id 返回 null', () => {
    for (const bad of ['', 'netease', 'netease:', ':123', 'kugou:123', 'netease:']) {
      expect(parseTrackId(bad)).toBeNull();
    }
  });

  it('只按第一个冒号切分，避免平台 id 里含冒号时被截断', () => {
    expect(parseTrackId('qq:a:b')?.platformTrackId).toBe('a:b');
  });
});

describe('音质', () => {
  it('按高到低给出降级阶梯', () => {
    expect(QUALITY_LADDER).toEqual(['hires', 'lossless', 'high', 'standard']);
  });

  it('只接受四档归一化音质', () => {
    expect(isQualityLevel('lossless')).toBe(true);
    expect(isQualityLevel('exhigh')).toBe(false);
    expect(isQualityLevel(undefined)).toBe(false);
  });
});
