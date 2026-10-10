import { getCookie, qqUin } from '../credentials.js';
import { err } from '../errors.js';
import { upstreamJson } from '../upstream.js';
import type {
  AlbumCard,
  ChorusInfo,
  LyricResult,
  PlaylistCard,
  PlaylistResult,
  QualityLevel,
  Track,
  UserPlatformLibrary,
} from '../types.js';
import { trackId } from '../types.js';
import {
  asArray,
  compact,
  ladderFrom,
  normalizeCover,
  pickNumber,
  pickString,
  type Adapter,
  type AlbumSearchResult,
  type DailyRecommendResult,
  type PlaylistSearchResult,
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
  // QQ 后端自己访问 QQ 音乐失败（网络/TLS/代理）时返回 { error: { message } }，这不是结构问题
  const upstreamError = (body as { error?: { message?: unknown } }).error;
  if (upstreamError && typeof upstreamError.message === 'string') {
    throw err.upstreamUnavailable('qq', `QQ 后端访问 QQ 音乐失败（${where}）：${upstreamError.message}`);
  }
  if (!envelope.response && !envelope.data && typeof envelope.code !== 'number') {
    throw err.upstreamShape('qq', `${where} 缺少 response/data 字段`);
  }
  return envelope;
}

function extractChorus(obj: Json): ChorusInfo | undefined {
  const vi = asArray(obj.vi);
  const rawStart = vi[4];
  const rawEnd = vi[5];
  const start = typeof rawStart === 'number' ? rawStart : Number(rawStart) || 0;
  const end = typeof rawEnd === 'number' ? rawEnd : Number(rawEnd) || 0;
  if (start > 0) {
    return {
      startTimeMs: start,
      endTimeMs: end > 0 ? end : undefined,
    };
  }
  return undefined;
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
    chorus: extractChorus(song),
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
    chorus: extractChorus(info),
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
async function pickPublicPlaylist(): Promise<{ dissid: string; name: string; detail: ApiEnvelope }> {
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
    if (asArray(detail.response?.cdlist).length > 0) return { ...candidate, detail };
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

  async searchPlaylists(keywords, { limit, offset }): Promise<PlaylistSearchResult> {
    const page = Math.floor(offset / Math.max(1, limit)) + 1;
    const postData = {
      comm: {
        g_tk: 5381,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
      },
      req_1: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          remoteplace: 'txt.mqq.all',
          search_type: 3,
          query: keywords,
          page_num: page,
          num_per_page: limit,
        },
      },
    };
    try {
      const res = await upstreamJson<Json>('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
        body: JSON.stringify(postData),
      });
      const req1 = (res.req_1 ?? {}) as Json;
      const data = (req1.data ?? {}) as Json;
      const body = (data.body ?? {}) as Json;
      const songlist = (body.songlist ?? {}) as Json;
      const list = asArray(songlist.list);
      const playlists: PlaylistCard[] = list.map((item) => {
        const obj = item as Json;
        const id = pickString(obj, 'dissid') || pickString(obj, 'disstid');
        const creator = (obj.creator ?? {}) as Json;
        return {
          id: `qq:${id}`,
          platform: 'qq',
          platformId: id,
          type: 'playlist',
          name: pickString(obj, 'dissname') || `歌单 ${id}`,
          coverUrl: normalizeCover(pickString(obj, 'imgurl')),
          trackCount: pickNumber(obj, 'song_count'),
          creator: pickString(creator, 'name') || undefined,
          playCount: pickNumber(obj, 'listennum') || undefined,
        };
      });
      return {
        playlists,
        total: pickNumber(songlist, 'totalnum') || playlists.length,
      };
    } catch {
      return { playlists: [], total: 0 };
    }
  },

  async searchAlbums(keywords, { limit, offset }): Promise<AlbumSearchResult> {
    const page = Math.floor(offset / Math.max(1, limit)) + 1;
    const postData = {
      comm: {
        g_tk: 5381,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
      },
      req_1: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          remoteplace: 'txt.mqq.all',
          search_type: 2,
          query: keywords,
          page_num: page,
          num_per_page: limit,
        },
      },
    };
    try {
      const res = await upstreamJson<Json>('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
        body: JSON.stringify(postData),
      });
      const req1 = (res.req_1 ?? {}) as Json;
      const data = (req1.data ?? {}) as Json;
      const body = (data.body ?? {}) as Json;
      const albumData = (body.album ?? {}) as Json;
      const list = asArray(albumData.list);
      const albums: AlbumCard[] = list.map((item) => {
        const obj = item as Json;
        const mid = pickString(obj, 'albumMID');
        return {
          id: `qq:album:${mid}`,
          platform: 'qq',
          platformId: mid,
          type: 'album',
          name: pickString(obj, 'albumName') || `专辑 ${mid}`,
          coverUrl: pickString(obj, 'albumPic') || coverOf(mid),
          trackCount: pickNumber(obj, 'song_count') || undefined,
          artist: pickString(obj, 'singerName') || undefined,
          publishTime: pickString(obj, 'publicTime') || undefined,
        };
      });
      return {
        albums,
        total: pickNumber(albumData, 'totalnum') || albums.length,
      };
    } catch {
      return { albums: [], total: 0 };
    }
  },

  async trackDetail(platformTrackId): Promise<Track | null> {
    const body = emptyEnvelope(await api('/getSongInfo', { songmid: platformTrackId }), 'getSongInfo');
    const info = (body.response?.songinfo as Json | undefined)?.data as Json | undefined;
    const trackInfo = (info?.track_info ?? {}) as Json;
    const track = normalizeTrackInfo(trackInfo);
    return track?.title === '未知曲目' ? null : track;
  },

  async chorus(platformTrackId): Promise<ChorusInfo | null> {
    try {
      const body = emptyEnvelope(await api('/getSongInfo', { songmid: platformTrackId }), 'getSongInfo');
      const info = (body.response?.songinfo as Json | undefined)?.data as Json | undefined;
      const trackInfo = (info?.track_info ?? {}) as Json;
      return extractChorus(trackInfo) ?? null;
    } catch {
      return null;
    }
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
      description: pickString(cd, 'desc') || undefined,
      creator: pickString(cd, 'nickname') || undefined,
      tracks: compact(asArray(cd.songlist).map((item) => normalizeTrackInfo(item as Json))),
    };
  },

  async album(albumId): Promise<PlaylistResult> {
    const body = emptyEnvelope(await api('/getAlbumInfo', { albummid: albumId }), 'getAlbumInfo');
    const response = ((body.data ?? (body.response?.data as Json | undefined)) ?? {}) as Json;
    const name = pickString(response, 'name') || `专辑 ${albumId}`;
    const singer = pickString(response, 'singername') || '';
    const list = asArray(response.list);
    const tracks = compact(list.map((item) => normalizeSearchSong(item as Json)));
    return {
      id: `qq:album:${albumId}`,
      platform: 'qq',
      name: singer ? `${name} - ${singer}` : name,
      coverUrl: coverOf(albumId),
      description: pickString(response, 'desc') || undefined,
      creator: singer || undefined,
      tracks,
      isAlbum: true,
    };
  },

  async userLibrary(): Promise<UserPlatformLibrary> {
    const cookie = getCookie('qq');
    if (!cookie) return { configured: false, playlists: [] };
    const uin = qqUin(cookie);
    if (!uin) return { configured: true, playlists: [] };
    try {
      const url = `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=${uin}&sin=0&size=100&format=json`;
      const res = await upstreamJson<Json>('qq', url, {
        headers: {
          Cookie: cookie,
          Referer: 'https://y.qq.com/',
        },
      });
      const data = (res.data ?? {}) as Json;
      const list = asArray(data.disslist);
      const playlists: PlaylistCard[] = [];
      let favoritePlaylist: PlaylistCard | undefined;
      for (const item of list) {
        const obj = item as Json;
        const isFav = pickNumber(obj, 'dirid') === 201;
        const pid = String(pickNumber(obj, 'tid') || pickString(obj, 'tid') || pickNumber(obj, 'dissid') || pickString(obj, 'dissid'));
        const card: PlaylistCard = {
          id: `qq:${pid}`,
          platform: 'qq',
          platformId: pid,
          type: 'playlist',
          name: pickString(obj, 'diss_name', 'dir_name') || (isFav ? '我喜欢' : `歌单 ${pid}`),
          coverUrl: pickString(obj, 'diss_cover') && !pickString(obj, 'diss_cover').startsWith('?') ? normalizeCover(pickString(obj, 'diss_cover')) : undefined,
          trackCount: pickNumber(obj, 'song_cnt'),
          isFavorite: isFav,
        };
        if (isFav && !favoritePlaylist) {
          favoritePlaylist = card;
        }
        playlists.push(card);
      }
      return {
        configured: true,
        user: { uin },
        favoritePlaylist,
        playlists,
      };
    } catch {
      return { configured: true, user: { uin }, playlists: [] };
    }
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
    const cd = asArray(playlist.detail.response?.cdlist)[0] as Json | undefined;
    const tracks = compact(asArray(cd?.songlist).map((item) => normalizeTrackInfo(item as Json)));
    return {
      tracks: tracks.slice(0, limit),
      playlistId: `qq:${playlist.dissid}`,
      source: `QQ 无匿名每日推荐，退化为热歌歌单「${playlist.name}」`,
    };
  },
};
