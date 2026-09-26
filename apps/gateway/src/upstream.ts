import { config, limits } from './config.js';
import { err } from './errors.js';
import { PlatformHealth, RateQueueFullError, TokenBucket } from './limiter.js';
import type { Platform } from './types.js';

/**
 * 对两个第三方后端的统一出口：
 *  - 令牌桶限速 + 溢出排队，避免击打上游触发风控
 *  - 连续异常达阈值后进入平台冷却
 *  - 统一超时与错误语义
 */

const buckets: Record<Platform, TokenBucket> = {
  netease: new TokenBucket(limits.netease.ratePerSec, limits.netease.burst, limits.netease.queueMax),
  qq: new TokenBucket(limits.qq.ratePerSec, limits.qq.burst, limits.qq.queueMax),
};

export const platformHealth = new PlatformHealth();

export function baseOf(platform: Platform): string {
  return platform === 'netease' ? config.neteaseBase : config.qqBase;
}

function resolveUrl(platform: Platform, pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${baseOf(platform)}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export interface UpstreamOptions {
  timeoutMs?: number;
  /** 上游返回 >=500 或 429 时是否计入平台健康度（默认计入） */
  trackHealth?: boolean;
}

/**
 * 发起一次上游请求。调用方负责判定响应体是否符合预期。
 * 抛出的一定是 GatewayError。
 */
export async function upstreamFetch(
  platform: Platform,
  pathOrUrl: string,
  init: RequestInit = {},
  options: UpstreamOptions = {},
): Promise<Response> {
  const cooling = platformHealth.cooldownRemainingMs(platform);
  if (cooling > 0) {
    throw err.platformCooldown(platform, Math.ceil(cooling / 1000));
  }

  try {
    await buckets[platform].take();
  } catch (error) {
    if (error instanceof RateQueueFullError) throw err.rateLimited(platform);
    throw error;
  }

  const timeoutMs = options.timeoutMs ?? limits.upstreamTimeoutMs;
  const url = resolveUrl(platform, pathOrUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = /abort/i.test(detail) ? `请求超时（${timeoutMs}ms）` : detail;
    platformHealth.recordFailure(platform, 'UPSTREAM_UNAVAILABLE');
    throw err.upstreamUnavailable(platform, message);
  }

  const trackHealth = options.trackHealth ?? true;
  if (trackHealth && (response.status >= 500 || response.status === 429)) {
    platformHealth.recordFailure(platform, 'UPSTREAM_UNAVAILABLE');
  } else if (trackHealth) {
    platformHealth.recordSuccess(platform);
  }
  return response;
}

/** 上游返回 JSON 的场景；结构不合预期时抛出 UPSTREAM_BAD_SHAPE */
export async function upstreamJson<T>(
  platform: Platform,
  pathOrUrl: string,
  init: RequestInit = {},
  options: UpstreamOptions = {},
): Promise<T> {
  const response = await upstreamFetch(platform, pathOrUrl, init, options);
  const text = await response.text();
  if (!text) {
    throw err.upstreamShape(platform, `响应体为空（HTTP ${response.status}）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw err.upstreamShape(
      platform,
      `响应不是 JSON（HTTP ${response.status}，前 120 字符：${text.slice(0, 120)}）`,
    );
  }
  return parsed as T;
}

/** 上游可达性探测：任何 HTTP 响应都算可达，只有网络层失败才算不可达 */
export async function probeUpstream(
  platform: Platform,
  timeoutMs = 3000,
): Promise<{ reachable: boolean; status?: number; latencyMs: number; detail?: string }> {
  const started = Date.now();
  try {
    const response = await fetch(`${baseOf(platform)}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { reachable: true, status: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
