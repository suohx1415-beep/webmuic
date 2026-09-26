import { Router } from 'express';
import { searchAll, ALL_PLATFORMS } from '../adapters/index.js';
import { err } from '../errors.js';
import { asyncHandler, queryInt, queryString } from '../http.js';
import type { DegradedInfo, Platform } from '../types.js';

export const searchRouter = Router();

function parsePlatform(value: string): Platform[] {
  if (!value || value === 'all') return ALL_PLATFORMS;
  if (value === 'netease' || value === 'qq') return [value];
  throw err.badRequest(`不支持的 platform：${value}（可选 all/netease/qq）`);
}

/**
 * GET /api/search?q=&platform=all&limit=20&offset=0
 * 任一平台失败都会返回另一平台的结果，并在 degraded 里说明原因。
 */
searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = queryString(req, 'q', { required: true });
    const platforms = parsePlatform(queryString(req, 'platform'));
    const limit = queryInt(req, 'limit', { min: 1, max: 50, fallback: 20 });
    const offset = queryInt(req, 'offset', { min: 0, max: 1000, fallback: 0 });

    const result = await searchAll(q, { limit, offset }, platforms);

    if (result.ok.length === 0) {
      // 两个平台都挂了：直接把第一个错误抛出去，让前端看到真实原因
      const first = platforms[0] as Platform;
      const failure = result.failed[first];
      throw err.upstreamUnavailable(first, failure?.message ?? '搜索失败');
    }

    const degradedPlatforms = platforms.filter((p) => !result.ok.includes(p));
    const degraded: DegradedInfo | undefined = degradedPlatforms.length
      ? {
          platforms: degradedPlatforms,
          reasons: Object.fromEntries(
            degradedPlatforms.map((p) => [p, result.failed[p]?.message ?? '不可用']),
          ),
        }
      : undefined;

    res.json({
      query: q,
      offset,
      limit,
      counts: result.counts,
      totals: result.totals,
      tracks: result.tracks,
      ...(degraded ? { degraded } : {}),
    });
  }),
);

/** GET /api/search/suggest?q= —— 轻量联想词，QQ 侧有 getSmartbox，网易云侧用搜索结果标题 */
searchRouter.get(
  '/suggest',
  asyncHandler(async (req, res) => {
    const q = queryString(req, 'q', { required: true });
    if (q.length < 1) {
      res.json({ suggestions: [] });
      return;
    }
    const result = await searchAll(q, { limit: 5, offset: 0 }, ALL_PLATFORMS);
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const track of result.tracks) {
      const label = track.artists[0] ? `${track.title} - ${track.artists[0].name}` : track.title;
      if (seen.has(label)) continue;
      seen.add(label);
      suggestions.push(label);
      if (suggestions.length >= 8) break;
    }
    res.json({ suggestions });
  }),
);
