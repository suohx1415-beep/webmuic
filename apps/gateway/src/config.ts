import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/gateway */
export const baseDir = path.resolve(here, '..');

export const config = {
  /** 仅监听本机：与"仅本机自用"的部署前提一致 */
  host: process.env.GATEWAY_HOST ?? '127.0.0.1',
  port: Number(process.env.GATEWAY_PORT ?? 8787),
  neteaseBase: process.env.NETEASE_BASE ?? 'http://127.0.0.1:3010',
  qqBase: process.env.QQ_BASE ?? 'http://127.0.0.1:3200',
} as const;

export const paths = {
  /** 真实凭证，权限 600，已被 .gitignore 忽略。可用环境变量覆盖（测试用） */
  envFile: process.env.WEBMUIC_ENV_FILE ?? path.join(baseDir, '.env.local'),
  /** 供 QQ 后端热读取的 cookie 文件（配合 patch P3/P4） */
  qqCookieFile: process.env.WEBMUIC_QQ_COOKIE_FILE ?? path.join(baseDir, '.qq-cookie.txt'),
  envExample: path.join(baseDir, '.env.local.example'),
} as const;

export const limits = {
  netease: { ratePerSec: 3, burst: 6, queueMax: 50 },
  qq: { ratePerSec: 2, burst: 4, queueMax: 50 },
  /** 播放地址缓存：与平台凭证有效期取较小值，这里统一按 30 分钟封顶 */
  urlTtlMs: 30 * 60 * 1000,
  metaTtlMs: 10 * 60 * 1000,
  /** 疑似风控后的冷却时长 */
  cooldownMs: 3 * 60 * 1000,
  upstreamTimeoutMs: 20_000,
  /** 上游连续异常多少次后进入冷却 */
  cooldownThreshold: 5,
} as const;
