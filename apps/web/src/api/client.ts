import type {
  CredentialStatus,
  HealthResponse,
  LyricResponse,
  PlaylistResponse,
  QrCheckResponse,
  QrSession,
  QualityLevel,
  RecommendResponse,
  SearchResponse,
  Track,
  UrlResponse,
} from './types';

/**
 * 网关客户端。
 * 约定：凭证一律不出现在这里——前端没有任何地方读取或保存平台 cookie 明文。
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly platform?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(0, 'NETWORK', `无法连接网关（${error instanceof Error ? error.message : '未知错误'}）`);
  }

  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', `网关返回了非 JSON 内容（HTTP ${response.status}）`);
    }
  }

  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; message?: string; platform?: string } } | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? 'UNKNOWN',
      errorBody?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      errorBody?.error?.platform,
    );
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  search: (params: { q: string; platform?: string; limit?: number; offset?: number }) =>
    request<SearchResponse>(`/api/search${query({ ...params, type: 'song' })}`),

  searchPlaylists: (params: { q: string; platform?: string; limit?: number; offset?: number }) =>
    request<import('./types').SearchPlaylistsResponse>(`/api/search${query({ ...params, type: 'playlist' })}`),

  searchAlbums: (params: { q: string; platform?: string; limit?: number; offset?: number }) =>
    request<import('./types').SearchAlbumsResponse>(`/api/search${query({ ...params, type: 'album' })}`),

  suggest: (q: string) => request<{ suggestions: string[] }>(`/api/search/suggest${query({ q })}`),

  track: (id: string) => request<{ track: Track }>(`/api/track/${encodeURIComponent(id)}`),

  trackUrl: (id: string, quality: QualityLevel) =>
    request<UrlResponse>(`/api/track/${encodeURIComponent(id)}/url${query({ quality })}`),

  chorus: (id: string) =>
    request<import('./types').ChorusResponse>(`/api/track/${encodeURIComponent(id)}/chorus`),

  lyric: (id: string) => request<LyricResponse>(`/api/track/${encodeURIComponent(id)}/lyric`),

  playlist: (id: string) => request<PlaylistResponse>(`/api/playlist/${encodeURIComponent(id)}`),

  album: (id: string) => request<PlaylistResponse>(`/api/album/${encodeURIComponent(id)}`),

  userPlaylists: () => request<import('./types').UserLibraryResponse>('/api/user/playlists'),

  recommendDaily: (limit = 30) => request<RecommendResponse>(`/api/recommend/daily${query({ limit })}`),

  recommendSimilar: (seed: string) =>
    request<{ seed: string; tracks: Track[] }>(`/api/recommend/similar${query({ seed })}`),

  saveQqCookie: (cookie: string) =>
    request<{ ok: boolean; status: CredentialStatus; hasUin: boolean; upstreamReachable: boolean | null }>(
      '/api/credentials/qq',
      { method: 'POST', body: JSON.stringify({ cookie }) },
    ),

  clearQqCookie: () =>
    request<{ ok: boolean; status: CredentialStatus }>('/api/credentials/qq', {
      method: 'POST',
      body: JSON.stringify({ cookie: '' }),
    }),

  credentialStatus: () => request<{ platforms: CredentialStatus[] }>('/api/credentials/status'),

  createNeteaseQr: () => request<QrSession>('/api/login/netease/qr', { method: 'POST' }),

  checkNeteaseQr: (key: string) =>
    request<QrCheckResponse>(`/api/login/netease/qr/check${query({ key, _t: Date.now() })}`),

  logoutNetease: () =>
    request<{ ok: boolean }>('/api/login/netease', { method: 'DELETE' }),

  createQqQr: (type: 'qq' | 'wx' = 'qq') =>
    request<QrSession>(`/api/login/qq/qr${query({ type, _t: Date.now() })}`, { method: 'POST' }),

  checkQqQr: (key: string, type: 'qq' | 'wx' = 'qq') =>
    request<QrCheckResponse>(`/api/login/qq/qr/check${query({ key, type, _t: Date.now() })}`),

  logoutQq: () =>
    request<{ ok: boolean }>('/api/login/qq', { method: 'DELETE' }),
};
