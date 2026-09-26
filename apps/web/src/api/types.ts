/** 与网关契约一一对应的类型（见 docs/api-contract.md） */

export type Platform = 'netease' | 'qq';
export type QualityLevel = 'standard' | 'high' | 'lossless' | 'hires';

export interface Quality {
  level: QualityLevel;
  label: string;
  br?: number;
  ext?: string;
  size?: number;
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
}

export interface DegradedInfo {
  platforms: Platform[];
  reasons: Partial<Record<Platform, string>>;
}

export interface SearchResponse {
  query: string;
  offset: number;
  limit: number;
  counts: Partial<Record<Platform, number>>;
  totals: Partial<Record<Platform, number>>;
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
}

export interface LyricResponse {
  trackId: string;
  lrc: string;
  translated: string;
}

export interface PlaylistResponse {
  id: string;
  platform: Platform;
  name: string;
  coverUrl?: string;
  tracks: Track[];
}

export interface RecommendSection {
  platform: Platform;
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
  platform: Platform;
  state: 'configured' | 'anonymous';
  fingerprint: string;
  hasMemberKey: boolean;
}

export interface HealthPlatform {
  platform: Platform;
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
}

export interface QrCheckResponse {
  code: number;
  state: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'unknown';
  message: string;
  status?: CredentialStatus;
}

export interface ApiErrorBody {
  error: { code: string; message: string; platform?: Platform };
}
