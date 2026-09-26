import { getCookie } from '../credentials.js';
import { err } from '../errors.js';
import { upstreamJson } from '../upstream.js';
import type {
  AlbumCard,
  ChorusInfo,
  LyricResult,
  Platform,
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

  async searchPlaylists(keywords, { limit, offset }): Promise<PlaylistSearchResult> {
    const body = await api('/cloudsearch', { keywords, type: 1000, limit, offset });
    const result = (body.result ?? {}) as Json;
    const list = asArray(result.playlists);
    const playlists: PlaylistCard[] = list.map((item) => {
      const obj = item as Json;
      const pid = String(pickNumber(obj, 'id') || pickString(obj, 'id'));
      const creator = (obj.creator ?? {}) as Json;
      return {
        id: `netease:${pid}`,
        platform: 'netease',
        platformId: pid,
        type: 'playlist',
        name: pickString(obj, 'name') || `歌单 ${pid}`,
        coverUrl: normalizeCover(pickString(obj, 'coverImgUrl')),
        trackCount: pickNumber(obj, 'trackCount'),
        creator: pickString(creator, 'nickname') || undefined,
        playCount: pickNumber(obj, 'playCount') || undefined,
      };
    });
    return {
      playlists,
      total: pickNumber(result, 'playlistCount') || playlists.length,
    };
  },

  async searchAlbums(keywords, { limit, offset }): Promise<AlbumSearchResult> {
    const body = await api('/cloudsearch', { keywords, type: 10, limit, offset });
    const result = (body.result ?? {}) as Json;
    const list = asArray(result.albums);
    const albums: AlbumCard[] = list.map((item) => {
      const obj = item as Json;
      const aid = String(pickNumber(obj, 'id') || pickString(obj, 'id'));
      const artist = (obj.artist ?? {}) as Json;
      const artists = asArray(obj.artists);
      const artistName = pickString(artist, 'name') || artists.map((a) => pickString(a as Json, 'name')).filter(Boolean).join(' / ');
      return {
        id: `netease:album:${aid}`,
        platform: 'netease',
        platformId: aid,
        type: 'album',
        name: pickString(obj, 'name') || `专辑 ${aid}`,
        coverUrl: normalizeCover(pickString(obj, 'picUrl')),
        trackCount: pickNumber(obj, 'size') || undefined,
        artist: artistName || undefined,
        publishTime: pickNumber(obj, 'publishTime') ? new Date(pickNumber(obj, 'publishTime')).toLocaleDateString() : undefined,
      };
    });
    return {
      albums,
      total: pickNumber(result, 'albumCount') || albums.length,
    };
  },

  async chorus(platformTrackId): Promise<ChorusInfo | null> {
    try {
      const body = await api('/song/chorus', { id: platformTrackId });
      const list = asArray(body.chorus);
      const first = list[0] as Json | undefined;
      if (!first) return null;
      const start = pickNumber(first, 'startTime');
      const end = pickNumber(first, 'endTime');
      return start > 0 ? { startTimeMs: start, endTimeMs: end > 0 ? end : undefined } : null;
    } catch {
      return null;
    }
  },

  async trackDetail(platformTrackId): Promise<Track | null> {
    const [detailBody, chorusInfo] = await Promise.all([
      api('/song/detail', { ids: platformTrackId }),
      this.chorus(platformTrackId).catch(() => null),
    ]);
    const first = asArray(detailBody.songs)[0];
    if (!first) return null;
    const track = normalizeSong(first as Json);
    if (track && chorusInfo) {
      track.chorus = chorusInfo;
    }
    return track;
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
    const creator = (playlist.creator ?? {}) as Json;
    return {
      id: `netease:${playlistId}`,
      platform: 'netease',
      name: pickString(playlist, 'name') || `歌单 ${playlistId}`,
      coverUrl: normalizeCover(pickString(playlist, 'coverImgUrl')),
      description: pickString(playlist, 'description') || undefined,
      creator: pickString(creator, 'nickname') || undefined,
      tracks: normalizeSongs(playlist.tracks),
    };
  },

  async album(albumId): Promise<PlaylistResult> {
    const body = await api('/album', { id: albumId });
    const album = (body.album ?? {}) as Json;
    const artist = (album.artist ?? (asArray(album.artists)[0] ?? {})) as Json;
    const artistName = pickString(artist, 'name');
    const albumName = pickString(album, 'name') || `专辑 ${albumId}`;
    return {
      id: `netease:album:${albumId}`,
      platform: 'netease',
      name: artistName ? `${albumName} - ${artistName}` : albumName,
      coverUrl: normalizeCover(pickString(album, 'picUrl', 'blurPicUrl')),
      description: pickString(album, 'description') || undefined,
      creator: artistName || undefined,
      tracks: normalizeSongs(body.songs),
      isAlbum: true,
    };
  },

  async userLibrary(): Promise<UserPlatformLibrary> {
    const cookie = getCookie('netease');
    if (!cookie) {
      return { configured: false, playlists: [] };
    }
    try {
      const accountBody = await api('/user/account', {});
      const account = (accountBody.account ?? {}) as Json;
      const profile = (accountBody.profile ?? {}) as Json;
      const uid = pickString(account, 'id') || pickString(profile, 'userId');
      if (!uid) {
        return { configured: true, playlists: [] };
      }
      const listBody = await api('/user/playlist', { uid, limit: 100, offset: 0 });
      const rawPlaylists = asArray(listBody.playlist);
      const playlists: PlaylistCard[] = [];
      let favoritePlaylist: PlaylistCard | undefined;

      for (let i = 0; i < rawPlaylists.length; i++) {
        const item = rawPlaylists[i] as Json;
        const pid = String(pickNumber(item, 'id') || pickString(item, 'id'));
        const name = pickString(item, 'name');
        const isFav = i === 0 || name.includes('喜欢的音乐');
        const card: PlaylistCard = {
          id: `netease:${pid}`,
          platform: 'netease',
          platformId: pid,
          type: 'playlist',
          name: name || `歌单 ${pid}`,
          coverUrl: normalizeCover(pickString(item, 'coverImgUrl')),
          trackCount: pickNumber(item, 'trackCount'),
          playCount: pickNumber(item, 'playCount') || undefined,
          isFavorite: isFav,
        };
        if (isFav && !favoritePlaylist) {
          favoritePlaylist = card;
        }
        playlists.push(card);
      }

      return {
        configured: true,
        user: {
          id: uid,
          nickname: pickString(profile, 'nickname') || undefined,
          avatarUrl: normalizeCover(pickString(profile, 'avatarUrl')),
        },
        favoritePlaylist,
        playlists,
      };
    } catch {
      return { configured: true, playlists: [] };
    }
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

