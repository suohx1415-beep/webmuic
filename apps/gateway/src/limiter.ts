import type { Platform } from './types.js';
import { limits } from './config.js';

export class RateQueueFullError extends Error {
  constructor() {
    super('rate limit queue is full');
    this.name = 'RateQueueFullError';
  }
}

/**
 * 令牌桶 + 排队。
 * 溢出请求排队而不是直接失败；队列超过 queueMax 才抛 RateQueueFullError，
 * 这样既避免击打上游触发风控，又不会让正常浏览被硬性拒绝。
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private waiting: Array<() => void> = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly queueMax: number,
  ) {
    this.tokens = burst;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
      this.lastRefill = now;
    }
  }

  private drain(): void {
    this.refill();
    while (this.waiting.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.waiting.shift()?.();
    }
    if (this.waiting.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async take(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    if (this.waiting.length >= this.queueMax) throw new RateQueueFullError();
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      if (!this.timer) {
        this.timer = setInterval(() => this.drain(), Math.max(20, Math.round(1000 / this.ratePerSec)));
        this.timer.unref?.();
      }
    });
  }

  /** 便于测试观察内部状态 */
  snapshot(): { tokens: number; waiting: number } {
    this.refill();
    return { tokens: this.tokens, waiting: this.waiting.length };
  }
}

/** 同一时刻相同的上游请求只发一次，其余调用方共享同一个 Promise */
export class SingleFlight {
  private inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly onCollapse?: (key: string) => void) {}

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.onCollapse?.(key);
      return existing as Promise<T>;
    }
    const p = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }

  get size(): number {
    return this.inflight.size;
  }
}

/** 规范化参数后生成稳定的缓存/单飞键 */
export function stableKey(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p === undefined || p === null) return '';
      if (typeof p === 'object') {
        const obj = p as Record<string, unknown>;
        return Object.keys(obj)
          .sort()
          .map((k) => `${k}=${String(obj[k])}`)
          .join('&');
      }
      return String(p);
    })
    .join('|');
}

/**
 * 平台健康状态：连续异常达到阈值后进入冷却，冷却期内不再击打上游。
 * 这是计划里"疑似风控"语义的落点。
 */
export class PlatformHealth {
  private failures = new Map<Platform, number>();
  private cooldownUntil = new Map<Platform, number>();

  private static readonly SUSPECT_CODES = new Set(['UPSTREAM_UNAVAILABLE', 'UPSTREAM_BAD_SHAPE', 'RATE_LIMITED']);

  recordSuccess(platform: Platform): void {
    this.failures.set(platform, 0);
  }

  /** 返回 true 表示该次失败已使平台进入冷却 */
  recordFailure(platform: Platform, code: string): boolean {
    if (!PlatformHealth.SUSPECT_CODES.has(code)) return false;
    const next = (this.failures.get(platform) ?? 0) + 1;
    this.failures.set(platform, next);
    if (next >= limits.cooldownThreshold) {
      this.cooldownUntil.set(platform, Date.now() + limits.cooldownMs);
      this.failures.set(platform, 0);
      return true;
    }
    return false;
  }

  cooldownRemainingMs(platform: Platform): number {
    const until = this.cooldownUntil.get(platform) ?? 0;
    return Math.max(0, until - Date.now());
  }

  isCoolingDown(platform: Platform): boolean {
    return this.cooldownRemainingMs(platform) > 0;
  }

  reset(platform?: Platform): void {
    if (platform) {
      this.failures.delete(platform);
      this.cooldownUntil.delete(platform);
      return;
    }
    this.failures.clear();
    this.cooldownUntil.clear();
  }
}
