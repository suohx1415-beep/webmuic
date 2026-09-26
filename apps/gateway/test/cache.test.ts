import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache.js';

describe('TtlCache', () => {
  it('过期后不再返回', async () => {
    const cache = new TtlCache<string>(10);
    cache.set('a', '1', 20);
    expect(cache.get('a')).toBe('1');
    await new Promise((r) => setTimeout(r, 30));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('超过容量时淘汰最久未使用的一项', () => {
    const cache = new TtlCache<number>(2);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.get('a'); // 让 a 变新
    cache.set('c', 3, 1000);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('delete 与 clear 生效', () => {
    const cache = new TtlCache<number>(10);
    cache.set('a', 1, 1000);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 2, 1000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
