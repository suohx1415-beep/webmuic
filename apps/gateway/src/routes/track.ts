import { Router } from 'express';
import { adapterOf } from '../adapters/index.js';
import { err } from '../errors.js';
import { asyncHandler, queryString } from '../http.js';
import { invalidateResolved, resolveUpstream } from '../resolver.js';
import { isQualityLevel, parseTrackId, QUALITY_LABELS, type QualityLevel, type Track } from '../types.js';

export const trackRouter = Router();

const DEFAULT_QUALITY: QualityLevel = 'high';

function requireTrackId(raw: string): { platform: 'netease' | 'qq'; platformTrackId: string } {
  const parsed = parseTrackId(raw);
  if (!parsed) {
    throw err.badRequest(`曲目 id 格式应为 平台:平台曲目id，收到：${raw}`);
  }
  return parsed;
}

function parseQuality(raw: string): QualityLevel {
  if (!raw) return DEFAULT_QUALITY;
  if (!isQualityLevel(raw)) {
    throw err.badRequest(`不支持的音质：${raw}（可选 standard/high/lossless/hires）`);
  }
  return raw;
}

/** GET /api/track/:id —— 单曲详情（用于队列恢复、直接打开某首歌） */
trackRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { platform, platformTrackId } = requireTrackId(req.params.id ?? '');
    const track: Track | null = await adapterOf(platform).trackDetail(platformTrackId);
    if (!track) throw err.notFound(`曲目不存在：${req.params.id}`);
    res.json({ track });
  }),
);

/**
 * GET /api/track/:id/url?quality=high
 * 返回的 url 永远指向网关自己（/api/stream/...），平台 CDN 地址不下发到浏览器。
 */
trackRouter.get(
  '/:id/url',
  asyncHandler(async (req, res) => {
    const { platform, platformTrackId } = requireTrackId(req.params.id ?? '');
    const requested = parseQuality(queryString(req, 'quality'));
    const resolved = await resolveUpstream(platform, platformTrackId, requested);

    const rank = (q: QualityLevel) => ['standard', 'high', 'lossless', 'hires'].indexOf(q);
    const degraded = rank(resolved.quality) < rank(requested);

    res.json({
      trackId: `${platform}:${platformTrackId}`,
      // 网关相对路径：前端只需拼上自己的 origin
      url: `/api/stream/${platform}:${platformTrackId}?quality=${requested}`,
      requestedQuality: requested,
      quality: resolved.quality,
      qualityLabel: QUALITY_LABELS[resolved.quality],
      ...(degraded
        ? {
            degraded: {
              from: requested,
              to: resolved.quality,
              reason: `${QUALITY_LABELS[requested]} 当前不可得，已降为 ${QUALITY_LABELS[resolved.quality]}`,
            },
          }
        : {}),
      size: resolved.size ?? null,
      br: resolved.br ?? null,
      expiresAt: resolved.expiresAt,
    });
  }),
);

/** GET /api/track/:id/lyric */
trackRouter.get(
  '/:id/lyric',
  asyncHandler(async (req, res) => {
    const { platform, platformTrackId } = requireTrackId(req.params.id ?? '');
    const lyric = await adapterOf(platform).lyric(platformTrackId);
    res.json({ trackId: `${platform}:${platformTrackId}`, lrc: lyric.lrc, translated: lyric.translated ?? '' });
  }),
);

/** 供 Phase 3 的音频代理复用：拿真实 CDN 地址（不下发给浏览器） */
export async function streamTarget(
  trackId: string,
  quality: QualityLevel,
): Promise<{ platform: 'netease' | 'qq'; platformTrackId: string; url: string; quality: QualityLevel }> {
  const { platform, platformTrackId } = requireTrackId(trackId);
  const resolved = await resolveUpstream(platform, platformTrackId, quality);
  return { platform, platformTrackId, url: resolved.url, quality: resolved.quality };
}

/** 上游 403 说明缓存里的地址已失效：丢弃后重解析一次 */
export async function streamTargetFresh(
  trackId: string,
  quality: QualityLevel,
): Promise<{ platform: 'netease' | 'qq'; platformTrackId: string; url: string; quality: QualityLevel }> {
  const { platform, platformTrackId } = requireTrackId(trackId);
  invalidateResolved(platform, platformTrackId);
  const resolved = await resolveUpstream(platform, platformTrackId, quality);
  return { platform, platformTrackId, url: resolved.url, quality: resolved.quality };
}
