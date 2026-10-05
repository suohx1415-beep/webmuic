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

/** 清洗歌名（去除括号/副标题/标点符号），用于跨平台相似度比对 */
function cleanTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[\(（【\[][^\)）】\]]*[\)）】\]]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

/** 计算跨平台歌曲匹配得分 (0 - 100) */
export function calculateMatchScore(source: Track, candidate: Track): number {
  let score = 0;
  const sTitle = cleanTitle(source.title);
  const cTitle = cleanTitle(candidate.title);

  // 1. 歌名对比 (最高 50 分)
  if (sTitle && cTitle) {
    if (sTitle === cTitle) {
      score += 50;
    } else if (sTitle.includes(cTitle) || cTitle.includes(sTitle)) {
      score += 35;
    } else {
      return 0; // 歌名完全不合直接淘汰
    }
  }

  // 2. 歌手重合度 (最高 35 分)
  const sArtists = source.artists.map((a) => a.name.toLowerCase().trim());
  const cArtists = candidate.artists.map((a) => a.name.toLowerCase().trim());
  const hasCommonArtist = sArtists.some((sa) =>
    cArtists.some((ca) => sa === ca || sa.includes(ca) || ca.includes(sa)),
  );
  if (hasCommonArtist) {
    score += 35;
  }

  // 3. 时长差异 (最高 15 分)
  if (source.durationMs && candidate.durationMs) {
    const diffSec = Math.abs(source.durationMs - candidate.durationMs) / 1000;
    if (diffSec <= 3) {
      score += 15;
    } else if (diffSec <= 10) {
      score += 10;
    } else if (diffSec <= 30) {
      score += 5;
    }
  } else {
    score += 8;
  }

  return score;
}

/** GET /api/track/:id/match —— 在另一个平台搜索相似度最高的音轨以供跨平台替补换源 */
trackRouter.get(
  '/:id/match',
  asyncHandler(async (req, res) => {
    const { platform, platformTrackId } = requireTrackId(req.params.id ?? '');
    const source = await adapterOf(platform).trackDetail(platformTrackId);
    if (!source) throw err.notFound(`源曲目不存在：${req.params.id}`);

    const otherPlatform = platform === 'netease' ? 'qq' : 'netease';
    const otherAdapter = adapterOf(otherPlatform);

    // 采用 歌名 + 歌手关键词搜索
    const query = `${source.title} ${source.artists[0]?.name ?? ''}`.trim();
    let candidates: Track[] = [];
    try {
      const searchRes = await otherAdapter.search(query, { limit: 8, offset: 0 });
      candidates = searchRes.tracks;
    } catch {
      try {
        const fallbackRes = await otherAdapter.search(source.title, { limit: 8, offset: 0 });
        candidates = fallbackRes.tracks;
      } catch {
        candidates = [];
      }
    }

    const scored = candidates
      .map((candidate) => ({
        track: candidate,
        score: calculateMatchScore(source, candidate),
      }))
      .filter((item) => item.score >= 50)
      .sort((a, b) => b.score - a.score);

    res.json({
      source,
      targetPlatform: otherPlatform,
      matches: scored,
      bestMatch: scored[0]?.track ?? null,
    });
  }),
);

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
    const [resolved, chorus] = await Promise.all([
      resolveUpstream(platform, platformTrackId, requested),
      adapterOf(platform).chorus(platformTrackId).catch(() => null),
    ]);

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
      chorus: chorus ?? null,
    });
  }),
);

/** GET /api/track/:id/chorus —— 获取副歌/高潮起始点 */
trackRouter.get(
  '/:id/chorus',
  asyncHandler(async (req, res) => {
    const { platform, platformTrackId } = requireTrackId(req.params.id ?? '');
    const chorus = await adapterOf(platform).chorus(platformTrackId);
    res.json({ trackId: `${platform}:${platformTrackId}`, chorus });
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
