import { adapterOf } from './adapters/index.js';
import { TtlCache } from './cache.js';
import { limits } from './config.js';
import { SingleFlight, stableKey } from './limiter.js';
import { QUALITY_LADDER, type Platform, type QualityLevel } from './types.js';

export interface ResolvedEntry {
  url: string;
  quality: QualityLevel;
  expiresAt: number;
  size?: number;
  br?: number;
}

/**
 * 播放地址缓存：TTL 封顶 30 分钟（与平台 URL 有效期取较小值）。
 * 同一时刻的相同请求经由 SingleFlight 合并，避免一次搜索点播就打出一串上游请求。
 */
const cache = new TtlCache<ResolvedEntry>(500);
const flight = new SingleFlight();

function keyOf(platform: Platform, platformTrackId: string, quality: QualityLevel): string {
  return stableKey(['url', platform, platformTrackId, quality]);
}

export async function resolveUpstream(
  platform: Platform,
  platformTrackId: string,
  desired: QualityLevel,
): Promise<ResolvedEntry> {
  const key = keyOf(platform, platformTrackId, desired);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;

  return flight.run(key, async () => {
    const fresh = await adapterOf(platform).resolveUrl(platformTrackId, desired);
    const entry: ResolvedEntry = { ...fresh, expiresAt: Date.now() + limits.urlTtlMs };
    cache.set(key, entry, limits.urlTtlMs);
    return entry;
  });
}

/**
 * 丢弃某首歌全部档位的缓存。
 * 用途：上游返回 403（地址过期但 TTL 未到）时强制重解析一次。
 */
export function invalidateResolved(platform: Platform, platformTrackId: string): void {
  for (const quality of QUALITY_LADDER) {
    cache.delete(keyOf(platform, platformTrackId, quality));
  }
}
