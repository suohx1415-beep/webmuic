import { describe, expect, it } from 'vitest';
import { PlatformHealth, RateQueueFullError, SingleFlight, TokenBucket, stableKey } from '../src/limiter.js';

describe('TokenBucket', () => {
  it('有令牌时立即通过', async () => {
    const bucket = new TokenBucket(100, 3, 10);
    const started = Date.now();
    await bucket.take();
    await bucket.take();
    await bucket.take();
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('令牌耗尽后排队而非直接失败', async () => {
    const bucket = new TokenBucket(50, 1, 10);
    await bucket.take();
    const started = Date.now();
    await bucket.take();
    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
  });

  it('队列超过上限抛出 RateQueueFullError', async () => {
    const bucket = new TokenBucket(1, 1, 1);
    await bucket.take();
    // 第一个进入排队（占满队列），第二个被拒绝
    const queued = bucket.take();
    await expect(bucket.take()).rejects.toBeInstanceOf(RateQueueFullError);
    await queued;
  });
});

describe('SingleFlight', () => {
  it('相同 key 并发只执行一次', async () => {
    const flight = new SingleFlight();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'value';
    };
    const [a, b, c] = await Promise.all([
      flight.run('k', fn),
      flight.run('k', fn),
      flight.run('k', fn),
    ]);
    expect([a, b, c]).toEqual(['value', 'value', 'value']);
    expect(calls).toBe(1);
    expect(flight.size).toBe(0);
  });

  it('不同 key 互不影响，失败后不缓存结果', async () => {
    const flight = new SingleFlight();
    await expect(flight.run('bad', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    let retried = false;
    await flight.run('bad', async () => {
      retried = true;
      return 1;
    });
    expect(retried).toBe(true);
  });
});

describe('stableKey', () => {
  it('对象参数按键名排序，顺序不同也视为同一个 key', () => {
    expect(stableKey(['search', { b: 2, a: 1 }])).toBe(stableKey(['search', { a: 1, b: 2 }]));
  });

  it('空值归一化', () => {
    expect(stableKey(['a', undefined, null, ''])).toBe('a|||');
  });
});

describe('PlatformHealth', () => {
  it('连续异常达阈值后进入冷却，成功会清零计数', () => {
    const health = new PlatformHealth();
    // 阈值取自 config.limits.cooldownThreshold（5）
    for (let i = 0; i < 4; i += 1) {
      expect(health.recordFailure('qq', 'UPSTREAM_UNAVAILABLE')).toBe(false);
    }
    expect(health.isCoolingDown('qq')).toBe(false);
    expect(health.recordFailure('qq', 'UPSTREAM_UNAVAILABLE')).toBe(true);
    expect(health.isCoolingDown('qq')).toBe(true);
    expect(health.cooldownRemainingMs('qq')).toBeGreaterThan(0);
    health.reset('qq');
    expect(health.isCoolingDown('qq')).toBe(false);
  });

  it('非风控类错误不计入冷却', () => {
    const health = new PlatformHealth();
    for (let i = 0; i < 10; i += 1) {
      expect(health.recordFailure('netease', 'NOT_FOUND')).toBe(false);
    }
    expect(health.isCoolingDown('netease')).toBe(false);
  });
});
