import { err } from '../errors.js';
import { upstreamJson } from '../upstream.js';
import type { LyricResult, PlaylistResult, QualityLevel, Track } from '../types.js';
import { trackId } from '../types.js';
import {
  asArray,
  compact,
  ladderFrom,
  normalizeCover,
  pickNumber,
  pickString,
  type Adapter,
  type DailyRecommendResult,
  type ResolvedUpstream,
  type SearchResult,
} from './types.js';

/**
 * QQ 音乐适配器。
 *
 * 两个必须记住的上游约定（实测得出，踩过坑）：
 *  1. QQ 后端所有控制器都读 `ctx.query`，即便路由声明了 `/:xxx?` 路径参数 —— 一律用 query。
 *  2. 播放地址（purl）为空表示该曲目对当前身份不可播（会员曲），需要逐级降级尝试。
 */

type Json = Record<string, unknown>;

/**
 * QQ 后端的响应信封并不统一，实测存在两种：
 *   { response: {...} }  —— 搜索/详情/歌词/歌单
 *   { data: { playUrl } } —— getMusicPlay
 */
interface ApiEnvelope {
  response?: Json & { data?: Json; songinfo?: Json; cdlist?: unknown[]; playUrl?: Json };
  data?: Json;
  code?: number;
}

const QUALITY_TO_KEY: Record<QualityLevel, string> = {
  standard: '128',
  high: '320',
  lossless: 'flac',
  hires: 'flac',
};

const KEY_TO_LEVEL: Record<string, QualityLevel> = {
  '128': 'standard',
  m4a: 'standard',
  '320': 'high',
  flac: 'lossless',
  ape: 'lossless',
};

function coverOf(albumMid: string): string | undefined {
  if (!albumMid) return undefined;
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
}

async function api<T = ApiEnvelope>(path: string, params: Record<string, string | number>): Promise<T> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  return upstreamJson<T>('qq', `${path}?${search.toString()}`);
}

function emptyEnvelope(body: unknown, where: string): ApiEnvelope {
  if (typeof body !== 'object' || body === null) {
    throw err.upstreamShape('qq', `${where} 返回的不是对象`);
  }
  const envelope = body as ApiEnvelope;
  if (!envelope.response && !envelope.data && typeof envelope.code !== 'number') {
    throw err.upstreamShape('qq', `${where} 缺少 response/data 字段`);
  }
  return envelope;
}

/**
 * 搜索态的曲目结构：平铺字段 + size128/size320/sizeflac。
 */
function normalizeSearchSong(song: Json): Track | null {
  const mid = pickString(song, 'songmid');
  if (!mid) return null;
  const quality: Track['qualities'] = [];
  if (pickNumber(song, 'size128') > 0) quality.push({ level: 'standard', label: '标准 128k', br: 128000, size: pickNumber(song, 'size128'), ext: 'mp3' });
  if (pickNumber(song, 'size320') > 0) quality.push({ level: 'high', label: '高品质 320k', br: 320000, size: pickNumber(song, 'size320'), ext: 'mp3' });
  if (pickNumber(song, 'sizeflac') > 0) quality.push({ level: 'lossless', label: '无损 FLAC', br: 999000, size: pickNumber(song, 'sizeflac'), ext: 'flac' });
  if (pickNumber(song, 'sizeape') > 0) quality.push({ level: 'lossless', label: '无损 APE', br: 999000, size: pickNumber(song, 'sizeape'), ext: 'ape' });
  const albumMid = pickString(song, 'albummid');
  return {
    id: trackId('qq', mid),
    platform: 'qq',
    platformTrackId: mid,
    title: pickString(song, 'songname', 'name') || '未知曲目',
    artists: asArray(song.singer).map((s) => {
      const item = s as Json;
      return { id: pickString(item, 'mid') || undefined, name: pickString(item, 'name') || '未知歌手' };
    }),
    album: {
      id: albumMid || undefined,
      name: pickString(song, 'albumname', 'albumname_hilight') || '未知专辑',
      coverUrl: coverOf(albumMid),
    },
    // interval 以秒为单位
    durationMs: pickNumber(song, 'interval') * 1000,
    qualities: dedupeQualities(quality),
  };
}

/**
 * 详情/歌单态的曲目结构（track_info）：mid/name/singer[].mid/album.mid/file.size_128mp3。
 */
function normalizeTrackInfo(info: Json): Track | null {
  const mid = pickString(info, 'mid');
  if (!mid) return null;
  const file = (info.file ?? {}) as Json;
  const quality: Track['qualities'] = [];
  const size128 = pickNumber(file, 'size_128mp3', 'size_128');
  const size320 = pickNumber(file, 'size_320mp3', 'size_320');
  const sizeFlac = pickNumber(file, 'size_flac');
  const sizeApe = pickNumber(file, 'size_ape');
  if (size128 > 0) quality.push({ level: 'standard', label: '标准 128k', br: 128000, size: size128, ext: 'mp3' });
  if (size320 > 0) quality.push({ level: 'high', label: '高品质 320k', br: 320000, size: size320, ext: 'mp3' });
  if (sizeFlac > 0) quality.push({ level: 'lossless', label: '无损 FLAC', br: 999000, size: sizeFlac, ext: 'flac' });
  if (sizeApe > 0) quality.push({ level: 'lossless', label: '无损 APE', br: 999000, size: sizeApe, ext: 'ape' });
  // QQ 有 size_hires 字段，但播放链路（vkey 文件名只有 M500/M800/C400/F000/A000）没有对应档位，故不对外声明
  const album = (info.album ?? {}) as Json;
  const albumMid = pickString(album, 'mid');
  return {
    id: trackId('qq', mid),
    platform: 'qq',
    platformTrackId: mid,
    title: pickString(info, 'name', 'title') || '未知曲目',
    artists: asArray(info.singer).map((s) => {
      const item = s as Json;
      return { id: pickString(item, 'mid') || undefined, name: pickString(item, 'name') || '未知歌手' };
    }),
    album: {
      id: albumMid || undefined,
      name: pickString(album, 'name', 'title') || '未知专辑',
      coverUrl: coverOf(albumMid),
    },
    durationMs: pickNumber(info, 'interval') * 1000,
    qualities: dedupeQualities(quality),
  };
}

function dedupeQualities(qualities: Track['qualities']): Track['qualities'] {
  const seen = new Set<QualityLevel>();
  return qualities.filter((q) => {
    if (seen.has(q.level)) return false;
    seen.add(q.level);
    return true;
  });
}

function songListOf(envelope: ApiEnvelope): unknown[] {
  const data = envelope.response?.data as Json | undefined;
  const song = data?.song as Json | undefined;
  return asArray(song?.list);
}

/** 歌单候选：部分歌单对匿名身份会返回 check privacy error，需要往后找 */
async function pickPublicPlaylist(): Promise<{ dissid: string; name: string }> {
  const body = emptyEnvelope(
    await api('/getSongLists', { page: 1, limit: 5, categoryId: 10000000, sortId: 5 }),
    'getSongLists',
  );
  const list = asArray((body.response?.data as Json | undefined)?.list);
  const candidates = compact(
    list.map((item) => {
      const entry = item as Json;
      const dissid = pickString(entry, 'dissid');
      return dissid ? { dissid, name: pickString(entry, 'dissname') || dissid } : null;
    }),
  );
  for (const candidate of candidates.slice(0, 3)) {
    const detail = emptyEnvelope(
      await api('/getSongListDetail', { disstid: candidate.dissid }),
      'getSongListDetail',
    );
    if (asArray(detail.response?.cdlist).length > 0) return candidate;
  }
  throw err.upstreamShape('qq', '没有可匿名访问的公开歌单');
}

export const qqAdapter: Adapter = {
  platform: 'qq',

  async search(keywords, { limit, offset }): Promise<SearchResult> {
    // QQ 是页码分页，把 offset 换算成 page
    const page = Math.floor(offset / Math.max(1, limit)) + 1;
    const body = emptyEnvelope(
      await api('/getSearchByKey', { key: keywords, limit, page, catZhida: 0, remoteplace: 'song' }),
      'getSearchByKey',
    );
    if (!body.response) throw err.upstreamShape('qq', 'getSearchByKey 没有 response');
    const data = (body.response.data ?? {}) as Json;
    const song = (data.song ?? {}) as Json;
    return {
      tracks: compact(songListOf(body).map((item) => normalizeSearchSong(item as Json))),
      total: pickNumber(song, 'totalnum'),
    };
  },

  async trackDetail(platformTrackId): Promise<Track | null> {
    const body = emptyEnvelope(await api('/getSongInfo', { songmid: platformTrackId }), 'getSongInfo');
    const info = (body.response?.songinfo as Json | undefined)?.data as Json | undefined;
    const trackInfo = (info?.track_info ?? {}) as Json;
    const track = normalizeTrackInfo(trackInfo);
    return track?.title === '未知曲目' ? null : track;
  },

  async lyric(platformTrackId): Promise<LyricResult> {
    const body = emptyEnvelope(await api('/getLyric', { songmid: platformTrackId }), 'getLyric');
    const response = (body.response ?? {}) as Json;
    return {
      lrc: pickString(response, 'lyric'),
      translated: pickString(response, 'trans') || undefined,
    };
  },

  async playlist(playlistId): Promise<PlaylistResult> {
    const body = emptyEnvelope(await api('/getSongListDetail', { disstid: playlistId }), 'getSongListDetail');
    const response = (body.response ?? {}) as Json;
    const cd = asArray(response.cdlist)[0] as Json | undefined;
    if (!cd) {
      const msg = pickString(response, 'msg') || '歌单不可访问';
      throw err.notFound(`QQ 歌单不可用（${msg}）`);
    }
    return {
      id: `qq:${playlistId}`,
      platform: 'qq',
      name: pickString(cd, 'dissname') || `歌单 ${playlistId}`,
      coverUrl: normalizeCover(pickString(cd, 'logo', 'imgurl')),
      tracks: compact(asArray(cd.songlist).map((item) => normalizeTrackInfo(item as Json))),
    };
  },

  /**
   * QQ 没有"请求高档自动降级"的能力：purl 为空就是不可播，必须逐级重试。
   * 档位映射后去重，避免 hires 与 lossless 重复请求同一档。
   */
  async resolveUrl(platformTrackId, desired): Promise<ResolvedUpstream> {
    const tried = new Set<string>();
    let lastError: unknown;
    for (const level of ladderFrom(desired)) {
      const key = QUALITY_TO_KEY[level];
      if (tried.has(key)) continue;
      tried.add(key);
      try {
        const body = emptyEnvelope(
          await api('/getMusicPlay', { songmid: platformTrackId, quality: key }),
          'getMusicPlay',
        );
        // 实测这里返回的是 { data: { playUrl: { <mid>: { url, error } } } }
        const playUrl = (body.data?.playUrl ?? (body.response?.data as Json | undefined)?.playUrl ?? {}) as Json;
        const entry = playUrl[platformTrackId] as Json | undefined;
        const url = pickString(entry ?? {}, 'url');
        if (url) {
          return {
            url,
            quality: KEY_TO_LEVEL[key] ?? 'standard',
          };
        }
      } catch (error) {
        lastError = error;
      }
    }
    // 全部档位都拿不到链接：区分"上游坏了"与"这首歌就是不可播"
    if (lastError) throw lastError;
    throw err.urlUnavailable('qq');
  },

  async dailyRecommend(limit): Promise<DailyRecommendResult> {
    // QQ 没有匿名的"每日推荐"接口，退化为公开热歌歌单，来源在界面上如实标注
    const playlist = await pickPublicPlaylist();
    const body = emptyEnvelope(await api('/getSongListDetail', { disstid: playlist.dissid }), 'getSongListDetail');
    const cd = asArray(body.response?.cdlist)[0] as Json | undefined;
    const tracks = compact(asArray(cd?.songlist).map((item) => normalizeTrackInfo(item as Json)));
    return {
      tracks: tracks.slice(0, limit),
      playlistId: `qq:${playlist.dissid}`,
      source: `QQ 无匿名每日推荐，退化为热歌歌单「${playlist.name}」`,
    };
  },
};
