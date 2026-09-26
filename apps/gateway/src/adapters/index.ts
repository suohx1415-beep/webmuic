import type { AlbumCard, Platform, PlaylistCard, Track } from '../types.js';
import { neteaseAdapter } from './netease.js';
import { qqAdapter } from './qq.js';
import type { Adapter, SearchResult } from './types.js';

export const adapters: Record<Platform, Adapter> = {
  netease: neteaseAdapter,
  qq: qqAdapter,
};

export function adapterOf(platform: Platform): Adapter {
  return adapters[platform];
}

export const ALL_PLATFORMS: Platform[] = ['netease', 'qq'];

export interface AggregatedSearch {
  tracks: Track[];
  counts: Partial<Record<Platform, number>>;
  totals: Partial<Record<Platform, number>>;
  /** 成功返回的平台 */
  ok: Platform[];
  failed: Partial<Record<Platform, { code: string; message: string }>>;
}

/**
 * 多平台搜索：并行发起，任一平台失败不影响另一平台，失败信息交给路由层做降级提示。
 * 结果按平台交替穿插，避免"前 50 条全是同一个平台"的观感。
 */
export async function searchAll(
  keywords: string,
  opts: { limit: number; offset: number },
  platforms: Platform[],
): Promise<AggregatedSearch> {
  const settled = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const result: SearchResult = await adapters[platform].search(keywords, opts);
        return { platform, result, error: undefined as unknown };
      } catch (error) {
        return { platform, result: undefined, error };
      }
    }),
  );

  const perPlatform = new Map<Platform, Track[]>();
  const counts: Partial<Record<Platform, number>> = {};
  const totals: Partial<Record<Platform, number>> = {};
  const ok: Platform[] = [];
  const failed: AggregatedSearch['failed'] = {};

  for (const entry of settled) {
    if (entry.error !== undefined || !entry.result) {
      const error = entry.error as { code?: string; message?: string } | undefined;
      failed[entry.platform] = {
        code: typeof error?.code === 'string' ? error.code : 'UPSTREAM_UNAVAILABLE',
        message: typeof error?.message === 'string' ? error.message : '搜索失败',
      };
      continue;
    }
    perPlatform.set(entry.platform, entry.result.tracks);
    counts[entry.platform] = entry.result.tracks.length;
    totals[entry.platform] = entry.result.total;
    ok.push(entry.platform);
  }

  // 交替穿插：netease[0], qq[0], netease[1], qq[1] ...
  const tracks: Track[] = [];
  const maxLen = Math.max(0, ...[...perPlatform.values()].map((list) => list.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const platform of platforms) {
      const item = perPlatform.get(platform)?.[i];
      if (item) tracks.push(item);
    }
  }

  return { tracks, counts, totals, ok, failed };
}

export interface AggregatedPlaylistSearch {
  playlists: PlaylistCard[];
  counts: Partial<Record<Platform, number>>;
  totals: Partial<Record<Platform, number>>;
  ok: Platform[];
  failed: Partial<Record<Platform, { code: string; message: string }>>;
}

export async function searchPlaylistsAll(
  keywords: string,
  opts: { limit: number; offset: number },
  platforms: Platform[],
): Promise<AggregatedPlaylistSearch> {
  const settled = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const result = await adapters[platform].searchPlaylists(keywords, opts);
        return { platform, result, error: undefined as unknown };
      } catch (error) {
        return { platform, result: undefined, error };
      }
    }),
  );

  const perPlatform = new Map<Platform, PlaylistCard[]>();
  const counts: Partial<Record<Platform, number>> = {};
  const totals: Partial<Record<Platform, number>> = {};
  const ok: Platform[] = [];
  const failed: AggregatedPlaylistSearch['failed'] = {};

  for (const entry of settled) {
    if (entry.error !== undefined || !entry.result) {
      const error = entry.error as { code?: string; message?: string } | undefined;
      failed[entry.platform] = {
        code: typeof error?.code === 'string' ? error.code : 'UPSTREAM_UNAVAILABLE',
        message: typeof error?.message === 'string' ? error.message : '歌单搜索失败',
      };
      continue;
    }
    perPlatform.set(entry.platform, entry.result.playlists);
    counts[entry.platform] = entry.result.playlists.length;
    totals[entry.platform] = entry.result.total;
    ok.push(entry.platform);
  }

  const playlists: PlaylistCard[] = [];
  const maxLen = Math.max(0, ...[...perPlatform.values()].map((list) => list.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const platform of platforms) {
      const item = perPlatform.get(platform)?.[i];
      if (item) playlists.push(item);
    }
  }

  return { playlists, counts, totals, ok, failed };
}

export interface AggregatedAlbumSearch {
  albums: AlbumCard[];
  counts: Partial<Record<Platform, number>>;
  totals: Partial<Record<Platform, number>>;
  ok: Platform[];
  failed: Partial<Record<Platform, { code: string; message: string }>>;
}

export async function searchAlbumsAll(
  keywords: string,
  opts: { limit: number; offset: number },
  platforms: Platform[],
): Promise<AggregatedAlbumSearch> {
  const settled = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const result = await adapters[platform].searchAlbums(keywords, opts);
        return { platform, result, error: undefined as unknown };
      } catch (error) {
        return { platform, result: undefined, error };
      }
    }),
  );

  const perPlatform = new Map<Platform, AlbumCard[]>();
  const counts: Partial<Record<Platform, number>> = {};
  const totals: Partial<Record<Platform, number>> = {};
  const ok: Platform[] = [];
  const failed: AggregatedAlbumSearch['failed'] = {};

  for (const entry of settled) {
    if (entry.error !== undefined || !entry.result) {
      const error = entry.error as { code?: string; message?: string } | undefined;
      failed[entry.platform] = {
        code: typeof error?.code === 'string' ? error.code : 'UPSTREAM_UNAVAILABLE',
        message: typeof error?.message === 'string' ? error.message : '专辑搜索失败',
      };
      continue;
    }
    perPlatform.set(entry.platform, entry.result.albums);
    counts[entry.platform] = entry.result.albums.length;
    totals[entry.platform] = entry.result.total;
    ok.push(entry.platform);
  }

  const albums: AlbumCard[] = [];
  const maxLen = Math.max(0, ...[...perPlatform.values()].map((list) => list.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const platform of platforms) {
      const item = perPlatform.get(platform)?.[i];
      if (item) albums.push(item);
    }
  }

  return { albums, counts, totals, ok, failed };
}

