/** 与网关契约一一对应的类型（见 docs/api-contract.md） */

/** 'local' 只存在于前端：用户导入的本地文件，不会发给网关 */
export type Platform = 'netease' | 'qq' | 'local';
export type RemotePlatform = Exclude<Platform, 'local'>;
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

export interface DegradedInfo {
  platforms: RemotePlatform[];
  reasons: Partial<Record<RemotePlatform, string>>;
}

export interface SearchResponse {
  query: string;
  offset: number;
  limit: number;
  counts: Partial<Record<RemotePlatform, number>>;
  totals: Partial<Record<RemotePlatform, number>>;
  tracks: Track[];
  degraded?: DegradedInfo;
}

export interface UrlResponse {
  trackId: string;
  url: string;
  requestedQuality: QualityLevel;
  quality: QualityLevel;
  qualityLabel: string;
  degraded?: { from: QualityLevel; to: QualityLevel; reason: string };
  size: number | null;
  br: number | null;
  expiresAt: number;
  chorus?: ChorusInfo | null;
}

export interface ChorusResponse {
  trackId: string;
  chorus: ChorusInfo | null;
}

export interface LyricResponse {
  trackId: string;
  lrc: string;
  translated: string;
}

export type SearchType = 'song' | 'playlist' | 'album';

export interface PlaylistCard {
  id: string;
  platform: RemotePlatform;
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
  platform: RemotePlatform;
  platformId: string;
  type: 'album';
  name: string;
  coverUrl?: string;
  trackCount?: number;
  artist?: string;
  publishTime?: string;
}

export interface SearchPlaylistsResponse {
  query: string;
  type: 'playlist';
  offset: number;
  limit: number;
  counts: Partial<Record<RemotePlatform, number>>;
  totals: Partial<Record<RemotePlatform, number>>;
  playlists: PlaylistCard[];
  degraded?: DegradedInfo;
}

export interface SearchAlbumsResponse {
  query: string;
  type: 'album';
  offset: number;
  limit: number;
  counts: Partial<Record<RemotePlatform, number>>;
  totals: Partial<Record<RemotePlatform, number>>;
  albums: AlbumCard[];
  degraded?: DegradedInfo;
}

export interface PlaylistResponse {
  id: string;
  platform: RemotePlatform;
  name: string;
  coverUrl?: string;
  description?: string;
  creator?: string;
  tracks: Track[];
  isAlbum?: boolean;
}

export interface UserPlatformLibrary {
  configured: boolean;
  user?: { id?: string; uin?: string; nickname?: string; avatarUrl?: string };
  favoritePlaylist?: PlaylistCard;
  playlists: PlaylistCard[];
}

export interface UserLibraryResponse {
  netease: UserPlatformLibrary;
  qq: UserPlatformLibrary;
}

export interface RecommendSection {
  platform: RemotePlatform;
  title: string;
  tracks: Track[];
  /** 有对应歌单时可跳转（如 QQ 热歌歌单） */
  playlistId?: string;
  /** 来源说明，如实标注退化情况 */
  source?: string;
}

export interface RecommendResponse {
  tracks: Track[];
  sections: RecommendSection[];
  degraded?: DegradedInfo;
}

export interface CredentialStatus {
  platform: RemotePlatform;
  state: 'configured' | 'anonymous';
  fingerprint: string;
  hasMemberKey: boolean;
}

export interface HealthPlatform {
  platform: RemotePlatform;
  reachable: boolean;
  upstreamStatus: number | null;
  latencyMs: number;
  detail?: string;
  cooldownMs: number;
  credential: CredentialStatus;
}

export interface HealthResponse {
  ok: boolean;
  gateway: { name: string; uptimeMs: number };
  platforms: HealthPlatform[];
}

export interface QrSession {
  key: string;
  qrimg: string;
  qrurl: string;
  type?: 'qq' | 'wx';
}

export interface QrCheckResponse {
  code: number;
  state: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed' | 'unknown';
  message: string;
  status?: CredentialStatus;
}

export interface ApiErrorBody {
  error: { code: string; message: string; platform?: RemotePlatform };
}
