export type Platform = 'netease' | 'qq';

/** 归一化后的音质档位。各平台的原始档位在适配器里做映射。 */
export type QualityLevel = 'standard' | 'high' | 'lossless' | 'hires';

export interface Quality {
  level: QualityLevel;
  label: string;
  br?: number;
  ext?: string;
  size?: number;
}

export interface ChorusInfo {
  startTimeMs: number;
  endTimeMs?: number;
}

export interface Track {
  /** `${platform}:${platformTrackId}` */
  id: string;
  platform: Platform;
  platformTrackId: string;
  title: string;
  artists: { id?: string; name: string }[];
  album: { id?: string; name: string; coverUrl?: string };
  durationMs: number;
  qualities: Quality[];
  chorus?: ChorusInfo;
}

export interface LyricResult {
  lrc: string;
  translated?: string;
}

export interface PlaylistResult {
  id: string;
  platform: Platform;
  name: string;
  coverUrl?: string;
  description?: string;
  creator?: string;
  tracks: Track[];
  isAlbum?: boolean;
}

export type SearchType = 'song' | 'playlist' | 'album';

export interface PlaylistCard {
  id: string;
  platform: Platform;
  platformId: string;
  type: 'playlist';
  name: string;
  coverUrl?: string;
  trackCount?: number;
  creator?: string;
  playCount?: number;
  isFavorite?: boolean;
}

export interface AlbumCard {
  id: string;
  platform: Platform;
  platformId: string;
  type: 'album';
  name: string;
  coverUrl?: string;
  trackCount?: number;
  artist?: string;
  publishTime?: string;
}

export interface UserPlatformLibrary {
  configured: boolean;
  user?: { id?: string; uin?: string; nickname?: string; avatarUrl?: string };
  favoritePlaylist?: PlaylistCard;
  playlists: PlaylistCard[];
}

export interface UserLibraryResult {
  netease: UserPlatformLibrary;
  qq: UserPlatformLibrary;
}


export interface DegradedInfo {
  /** 本轮降级/失败的平台 */
  platforms: Platform[];
  /** 逐平台原因，便于界面直接展示 */
  reasons: Partial<Record<Platform, string>>;
}

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  standard: '标准 128k',
  high: '高品质 320k',
  lossless: '无损 FLAC',
  hires: 'Hi-Res',
};

/** 由高到低的降级阶梯：请求高档拿不到时逐级下探 */
export const QUALITY_LADDER: QualityLevel[] = ['hires', 'lossless', 'high', 'standard'];

export function isQualityLevel(v: unknown): v is QualityLevel {
  return v === 'standard' || v === 'high' || v === 'lossless' || v === 'hires';
}

export function trackId(platform: Platform, platformTrackId: string): string {
  return `${platform}:${platformTrackId}`;
}

/** 解析 `netease:12345` 形式的 id；不合法返回 null */
export function parseTrackId(id: string): { platform: Platform; platformTrackId: string } | null {
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const platform = id.slice(0, i);
  const platformTrackId = id.slice(i + 1);
  if ((platform !== 'netease' && platform !== 'qq') || !platformTrackId) return null;
  return { platform, platformTrackId };
}
