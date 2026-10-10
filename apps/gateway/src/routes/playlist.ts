import { Router } from 'express';
import { ALL_PLATFORMS, adapterOf, searchAll } from '../adapters/index.js';
import { err } from '../errors.js';
import { asyncHandler, queryInt, queryString } from '../http.js';
import { parseTrackId, type DegradedInfo, type Platform, type PlaylistResult } from '../types.js';

export const playlistRouter = Router();
export const albumRouter = Router();
export const recommendRouter = Router();

function requirePlaylistId(raw: string): { platform: Platform; id: string; isAlbum: boolean } {
  const i = raw.indexOf(':');
  if (i <= 0) throw err.badRequest(`歌单/专辑 id 格式应为 平台:id，收到：${raw}`);
  const platform = raw.slice(0, i) as Platform;
  if (platform !== 'netease' && platform !== 'qq') {
    throw err.badRequest(`不支持的平台：${platform}`);
  }
  let rest = raw.slice(i + 1);
  let isAlbum = false;
  if (rest.startsWith('album:')) {
    isAlbum = true;
    rest = rest.slice('album:'.length);
  }
  if (!rest) throw err.badRequest(`缺少有效 id：${raw}`);
  return { platform, id: rest, isAlbum };
}

/**
 * GET /api/playlist/:id   形如 /api/playlist/netease:3778678 或 /api/playlist/qq:album:000I5jJB3blWeN
 * 网易云与 QQ：支持公开歌单与专辑解析
 */
playlistRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { platform, id, isAlbum } = requirePlaylistId(req.params.id ?? '');
    const adapter = adapterOf(platform);
    const result: PlaylistResult = isAlbum ? await adapter.album(id) : await adapter.playlist(id);
    res.json(result);
  }),
);

/**
 * GET /api/album/:id   形如 /api/album/netease:12345 或 /api/album/qq:000I5jJB3blWeN
 */
albumRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const raw = req.params.id ?? '';
    const { platform, id } = requirePlaylistId(raw.includes(':album:') ? raw : raw.replace(':', ':album:'));
    const result = await adapterOf(platform).album(id);
    res.json(result);
  }),
);

/**
 * GET /api/recommend/daily?platform=all&limit=30
 * 网易云走 /recommend/songs（匿名可用）；QQ 无匿名的每日推荐，退化为公开热歌歌单，来源记在 sections 里。
 */
recommendRouter.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const requested = queryString(req, 'platform');
    const platforms: Platform[] = !requested || requested === 'all' ? ALL_PLATFORMS : [requested as Platform];
    for (const p of platforms) {
      if (p !== 'netease' && p !== 'qq') {
        throw err.badRequest(`不支持的 platform：${requested}`);
      }
    }
    const limit = queryInt(req, 'limit', { min: 1, max: 100, fallback: 30 });

    const settled = await Promise.all(
      platforms.map(async (platform) => {
        try {
          const result = await adapterOf(platform).dailyRecommend(limit);
          return { platform, result, error: undefined as unknown };
        } catch (error) {
          return { platform, result: undefined, error };
        }
      }),
    );

    const sections: Array<{
      platform: Platform;
      title: string;
      tracks: unknown[];
      playlistId?: string;
      source?: string;
    }> = [];
    const reasons: Partial<Record<Platform, string>> = {};
    const failed: Platform[] = [];
    const allTracks: unknown[] = [];

    for (const entry of settled) {
      if (entry.error !== undefined) {
        failed.push(entry.platform);
        reasons[entry.platform] = entry.error instanceof Error ? entry.error.message : '推荐不可用';
        continue;
      }
      const result = entry.result;
      if (!result) continue;
      sections.push({
        platform: entry.platform,
        title: entry.platform === 'netease' ? '网易云每日推荐' : 'QQ 音乐热歌',
        tracks: result.tracks,
        ...(result.playlistId ? { playlistId: result.playlistId } : {}),
        ...(result.source ? { source: result.source } : {}),
      });
      allTracks.push(...result.tracks);
    }

    if (sections.length === 0) {
      const first = platforms[0] as Platform;
      throw err.allPlatformsFailed(first, reasons[first], '推荐不可用');
    }

    const degraded: DegradedInfo | undefined = failed.length ? { platforms: failed, reasons } : undefined;

    res.json({
      // tracks 是两平台合并后的平铺列表，sections 保留来源分组便于界面分栏展示
      tracks: allTracks,
      sections,
      ...(degraded ? { degraded } : {}),
    });
  }),
);

/** 复用搜索做"猜你喜欢"式推荐：按歌手名再搜一次 */
recommendRouter.get(
  '/similar',
  asyncHandler(async (req, res) => {
    const seed = queryString(req, 'seed', { required: true });
    const parsed = parseTrackId(seed);
    if (!parsed) throw err.badRequest('seed 应为 平台:曲目id');
    const track = await adapterOf(parsed.platform).trackDetail(parsed.platformTrackId);
    const artist = track?.artists[0]?.name ?? '';
    if (!artist) {
      res.json({ seed, tracks: [] });
      return;
    }
    const result = await searchAll(artist, { limit: 10, offset: 0 }, [parsed.platform]);
    res.json({
      seed,
      tracks: result.tracks.filter((t) => t.id !== seed),
      ...(Object.keys(result.failed).length ? { degraded: { platforms: [parsed.platform], reasons: result.failed } } : {}),
    });
  }),
);
