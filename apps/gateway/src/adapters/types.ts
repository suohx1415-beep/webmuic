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
import { QUALITY_LADDER } from '../types.js';

export interface SearchResult {
  tracks: Track[];
  /** 平台报告的总数，做分页提示用 */
  total: number;
}

export interface PlaylistSearchResult {
  playlists: PlaylistCard[];
  total: number;
}

export interface AlbumSearchResult {
  albums: AlbumCard[];
  total: number;
}

export interface ResolvedUpstream {
  /** 平台 CDN 的真实地址，只允许在网关内部流转 */
  url: string;
  /** 实际拿到的音质（可能低于请求档位） */
  quality: QualityLevel;
  size?: number;
  br?: number;
}

export interface DailyRecommendResult {
  tracks: Track[];
  /** 有对应歌单时给出 platform:playlistId，界面可以跳转完整歌单 */
  playlistId?: string;
  /** 来源说明，界面直接展示（例如 QQ 没有匿名每日推荐，退化为热歌） */
  source?: string;
}

export interface Adapter {
  readonly platform: Platform;
  search(keywords: string, opts: { limit: number; offset: number }): Promise<SearchResult>;
  searchPlaylists(keywords: string, opts: { limit: number; offset: number }): Promise<PlaylistSearchResult>;
  searchAlbums(keywords: string, opts: { limit: number; offset: number }): Promise<AlbumSearchResult>;
  trackDetail(platformTrackId: string): Promise<Track | null>;
  chorus(platformTrackId: string): Promise<ChorusInfo | null>;
  lyric(platformTrackId: string): Promise<LyricResult>;
  playlist(playlistId: string): Promise<PlaylistResult>;
  album(albumId: string): Promise<PlaylistResult>;
  userLibrary(): Promise<UserPlatformLibrary>;
  resolveUrl(platformTrackId: string, desired: QualityLevel): Promise<ResolvedUpstream>;
  /** 推荐曲目；附带来源信息，便于界面标注真实来源并给出完整歌单入口 */
  dailyRecommend(limit: number): Promise<DailyRecommendResult>;
}

/**
 * 由请求档位出发、向下逐级的尝试顺序（含请求档位本身）。
 * 平台没有更高档位时靠它自然降级。
 */
export function ladderFrom(desired: QualityLevel): QualityLevel[] {
  const start = QUALITY_LADDER.indexOf(desired);
  return QUALITY_LADDER.slice(start === -1 ? QUALITY_LADDER.length - 1 : start);
}

/** 去掉数组里的 undefined/null，供 noUncheckedIndexedAccess 下安全取值 */
export function compact<T>(values: Array<T | undefined | null>): T[] {
  return values.filter((v): v is T => v !== undefined && v !== null);
}

export function pickString(source: unknown, ...keys: string[]): string {
  if (typeof source !== 'object' || source === null) return '';
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function pickNumber(source: unknown, ...keys: string[]): number {
  if (typeof source !== 'object' || source === null) return 0;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

export function asArray(source: unknown): unknown[] {
  return Array.isArray(source) ? source : [];
}

/** 封面图统一走 https，避免页面升级到 https 后被浏览器拦截 */
export function normalizeCover(url: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/^http:\/\//, 'https://');
}
