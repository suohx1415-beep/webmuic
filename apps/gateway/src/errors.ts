import { getCookie } from './credentials.js';
import type { Platform } from './types.js';

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly platform?: Platform,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * 拿不到播放地址时要区分两种情况，否则用户不知道该配 cookie 还是该换 cookie：
 *  - 未配置凭证：提示去设置里配置
 *  - 已配置但仍拿不到：提示凭证可能已失效 / 需要更高级别会员
 */
function urlUnavailableMessage(platform: Platform): string {
  const label = platform === 'netease' ? '网易云' : 'QQ 音乐';
  let configured = false;
  try {
    configured = Boolean(getCookie(platform));
  } catch {
    configured = false;
  }
  if (!configured) {
    return `${label} 没有可用的播放地址：当前是匿名身份，会员曲目需要在「设置」里配置平台凭证`;
  }
  return `${label} 没有可用的播放地址：已配置凭证但该曲目仍不可播，凭证可能已失效（请在「设置」里重新粘贴/重新扫码），或该曲目需要更高级别的会员`;
}

export const err = {
  badRequest: (message: string) => new GatewayError(400, 'BAD_REQUEST', message),
  notFound: (message: string) => new GatewayError(404, 'NOT_FOUND', message),
  credentialExpired: (platform: Platform) =>
    new GatewayError(401, 'CREDENTIAL_EXPIRED', `${platform} 的登录凭证缺失或已失效，请重新登录/重新粘贴 cookie`, platform),
  rateLimited: (platform: Platform) =>
    new GatewayError(429, 'RATE_LIMITED', `${platform} 本地限速队列已满，请稍后重试`, platform),
  upstreamUnavailable: (platform: Platform, detail?: string) =>
    new GatewayError(
      502,
      'UPSTREAM_UNAVAILABLE',
      `${platform} 后端不可达${detail ? `：${detail}` : ''}`,
      platform,
    ),
  platformCooldown: (platform: Platform, seconds: number) =>
    new GatewayError(
      503,
      'PLATFORM_COOLDOWN',
      `${platform} 疑似触发风控，冷却中，约 ${seconds}s 后恢复`,
      platform,
    ),
  urlUnavailable: (platform: Platform) =>
    new GatewayError(410, 'URL_UNAVAILABLE', urlUnavailableMessage(platform), platform),
  /** 所有平台都失败时转抛首个平台的错误；底层消息已是完整句子，不再叠加「后端不可达」前缀 */
  allPlatformsFailed: (platform: Platform, message: string | undefined, fallback: string) =>
    message
      ? new GatewayError(502, 'UPSTREAM_UNAVAILABLE', message, platform)
      : new GatewayError(502, 'UPSTREAM_UNAVAILABLE', `${platform} 后端不可达：${fallback}`, platform),
  upstreamShape: (platform: Platform, detail: string) =>
    new GatewayError(502, 'UPSTREAM_BAD_SHAPE', `${platform} 返回结构不符合预期：${detail}`, platform),
} as const;
