import { Router } from 'express';
import { TtlCache } from '../cache.js';
import { credentialStatus } from '../credentials.js';
import { asyncHandler } from '../http.js';
import { platformHealth, probeUpstream } from '../upstream.js';
import type { Platform } from '../types.js';

interface ProbeResult {
  reachable: boolean;
  status?: number;
  latencyMs: number;
  detail?: string;
}

/** 探测结果缓存几秒，避免前端轮询健康检查时反复击打上游 */
const probeCache = new TtlCache<ProbeResult>(16);
const PROBE_TTL_MS = 5000;

async function probe(platform: Platform): Promise<ProbeResult> {
  const cached = probeCache.get(platform);
  if (cached) return cached;
  const result = await probeUpstream(platform);
  probeCache.set(platform, result, PROBE_TTL_MS);
  return result;
}

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const platforms: Platform[] = ['netease', 'qq'];
    const credentials = credentialStatus();
    const entries = await Promise.all(
      platforms.map(async (platform) => {
        const probeResult = await probe(platform);
        const credential = credentials.find((c) => c.platform === platform) ?? {
          platform,
          state: 'anonymous' as const,
          fingerprint: '',
          hasMemberKey: false,
        };
        return {
          platform,
          reachable: probeResult.reachable,
          upstreamStatus: probeResult.status ?? null,
          latencyMs: probeResult.latencyMs,
          ...(probeResult.detail ? { detail: probeResult.detail } : {}),
          cooldownMs: platformHealth.cooldownRemainingMs(platform),
          credential,
        };
      }),
    );
    // 网关自身只要在响应就是健康的；上游不可达属于可降级状态，由前端提示
    res.json({
      ok: true,
      gateway: {
        name: 'webmuic-gateway',
        uptimeMs: Math.round(process.uptime() * 1000),
      },
      platforms: entries,
    });
  }),
);
