import { getCookie } from '../credentials.js';
import { err } from '../errors.js';
import { upstreamJson } from '../upstream.js';
import type { LyricResult, Platform, PlaylistResult, QualityLevel, Track } from '../types.js';
import { trackId } from '../types.js';
import {
  asArray,
  compact,
  normalizeCover,
  pickNumber,
  pickString,
  type Adapter,
  type DailyRecommendResult,
  type ResolvedUpstream,
  type SearchResult,
} from './types.js';

/**
 * 网易云适配器。
 * 约定：所有请求都通过 `cookie` 查询参数逐请求注入（NeteaseCloudMusicApi 的 main.js
 * 会把字符串形式的 cookie 转成对象），因此网关不需要修改后端代码。
 */

type Json = Record<string, unknown>;

const LEVEL_TO_NETEASE: Record<QualityLevel, string> = {
  standard: 'standard',
  high: 'exhigh',
  lossless: 'lossless',
  hires: 'hires',
};

const NETEASE_TO_LEVEL: Record<string, QualityLevel> = {
  standard: 'standard',
  higher: 'high',
  exhigh: 'high',
  lossless: 'lossless',
  hires: 'hires',
};

function withCookie(params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const cookie = getCookie('netease');
  if (cookie) search.set('cookie', cookie);
  return search.toString();
}

async function api<T = Json>(path: string, params: Record<string, string | number>): Promise<T> {
  return upstreamJson<T>('netease', `${path}?${withCookie(params)}`);
}

/** 网易云的音质元数据：l=128k m=192k h=320k sq=无损 hr=Hi-Res */
function qualitiesOf(song: Json): Track['qualities'] {
  const out: Track['qualities'] = [];
  const standardSize = pickNumber(song.l, 'size');
  const highSize = pickNumber(song.h, 'size');
  const losslessSize = pickNumber(song.sq, 'size');
  const hiresSize = pickNumber(song.hr, 'size');
  if (standardSize > 0) out.push({ level: 'standard', label: '标准 128k', br: 128000, size: standardSize, ext: 'mp3' });
  if (highSize > 0) out.push({ level: 'high', label: '高品质 320k', br: 320000, size: highSize, ext: 'mp3' });
  if (losslessSize > 0) out.push({ level: 'lossless', label: '无损 FLAC', br: pickNumber(song.sq, 'br') || 999000, size: losslessSize, ext: 'flac' });
  if (hiresSize > 0) out.push({ level: 'hires', label: 'Hi-Res', br: pickNumber(song.hr, 'br') || 1900000, size: hiresSize, ext: 'flac' });
  return out;
}

function normalizeSong(song: Json): Track | null {
  const id = pickNumber(song, 'id');
  if (!id) return null;
  const album = (song.al ?? song.album ?? {}) as Json;
  const artists = asArray(song.ar ?? song.artists).map((a) => {
    const item = a as Json;
    return { id: pickString(item, 'id') || undefined, name: pickString(item, 'name') || '未知歌手' };
  });
  return {
    id: trackId('netease', String(id)),
    platform: 'netease',
    platformTrackId: String(id),
    title: pickString(song, 'name') || '未知曲目',
    artists,
    album: {
      id: pickString(album, 'id') || undefined,
      name: pickString(album, 'name') || '未知专辑',
      coverUrl: normalizeCover(pickString(album, 'picUrl', 'blurPicUrl')),
    },
    durationMs: pickNumber(song, 'dt', 'duration'),
    qualities: qualitiesOf(song),
  };
}

function normalizeSongs(raw: unknown): Track[] {
  return compact(asArray(raw).map((item) => normalizeSong(item as Json)));
}

interface UrlV1Item extends Json {
  url?: string | null;
  level?: string;
  br?: number;
  size?: number;
}

export const neteaseAdapter: Adapter = {
  platform: 'netease' as Platform,

  async search(keywords, { limit, offset }): Promise<SearchResult> {
    const body = await api('/cloudsearch', { keywords, type: 1, limit, offset });
    const result = (body.result ?? {}) as Json;
    return {
      tracks: normalizeSongs(result.songs),
      total: pickNumber(result, 'songCount'),
    };
  },

  async trackDetail(platformTrackId): Promise<Track | null> {
    const body = await api('/song/detail', { ids: platformTrackId });
    const first = asArray(body.songs)[0];
    return first ? normalizeSong(first as Json) : null;
  },

  async lyric(platformTrackId): Promise<LyricResult> {
    const body = await api('/lyric', { id: platformTrackId });
    return {
      lrc: pickString(body.lrc, 'lyric'),
      translated: pickString(body.tlyric, 'lyric') || undefined,
    };
  },

  async playlist(playlistId): Promise<PlaylistResult> {
    const body = await api('/playlist/detail', { id: playlistId, n: 1000 });
    const playlist = body.playlist as Json | undefined;
    if (!playlist) throw err.upstreamShape('netease', 'playlist/detail 缺少 playlist 字段');
    return {
      id: `netease:${playlistId}`,
      platform: 'netease',
      name: pickString(playlist, 'name') || `歌单 ${playlistId}`,
      coverUrl: normalizeCover(pickString(playlist, 'coverImgUrl')),
      tracks: normalizeSongs(playlist.tracks),
    };
  },

  /**
   * 网易云的 level 参数本身就带降级：匿名身份请求 lossless 会返回 exhigh。
   * 因此只需一次请求，再用响应里的 level 字段反推实际拿到的档位，无需逐级重试。
   */
  async resolveUrl(platformTrackId, desired): Promise<ResolvedUpstream> {
    const requested = LEVEL_TO_NETEASE[desired];
    const body = await api('/song/url/v1', { id: platformTrackId, level: requested });
    const item = asArray(body.data)[0] as UrlV1Item | undefined;
    if (!item) throw err.upstreamShape('netease', 'song/url/v1 返回空 data');
    const url = typeof item.url === 'string' ? item.url : '';
    if (!url) {
      // 上游明确表示该曲目对此身份不可播
      throw err.urlUnavailable('netease');
    }
    const actual = NETEASE_TO_LEVEL[pickString(item, 'level')] ?? 'standard';
    return {
      url,
      quality: actual,
      size: pickNumber(item, 'size') || undefined,
      br: pickNumber(item, 'br') || undefined,
    };
  },

  async dailyRecommend(limit): Promise<DailyRecommendResult> {
    // /recommend/songs 匿名也可用（实测返回 dailySongs）
    const body = await api('/recommend/songs', {});
    const data = (body.data ?? {}) as Json;
    return {
      tracks: normalizeSongs(data.dailySongs).slice(0, limit),
      source: '网易云每日推荐',
    };
  },
};

