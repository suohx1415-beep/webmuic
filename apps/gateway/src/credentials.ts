import crypto from 'node:crypto';
import fs from 'node:fs';
import { paths } from './config.js';
import type { Platform } from './types.js';

/**
 * 凭证一律由服务端持有，前端永远拿不到明文。
 * 依赖项：
 *  - 网易云：每次请求通过 `cookie` 参数注入（NeteaseCloudMusicApi 支持 data.cookie 字符串）
 *  - QQ：写入 QQ_COOKIE_FILE，由打了 P3/P4 补丁的 QQ 后端在每次上游请求时热读取
 */

let cache: Record<string, string> | null = null;

function readEnvFile(): Record<string, string> {
  if (cache) return cache;
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(paths.envFile, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  } catch {
    /* 文件不存在时全部视为未配置 */
  }
  cache = out;
  return out;
}

function writeEnvFile(data: Record<string, string>): void {
  const body = [
    '# webmuic 网关凭证。此文件含平台登录凭证，权限应为 600，且已被 .gitignore 忽略。',
    '# 不要提交、不要粘贴到任何聊天或截图里。',
    ...Object.entries(data).map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');
  fs.writeFileSync(paths.envFile, body, { mode: 0o600 });
  try {
    fs.chmodSync(paths.envFile, 0o600);
  } catch {
    /* 某些文件系统不支持 chmod，忽略 */
  }
  cache = data;
}

export function getCookie(platform: Platform): string {
  const data = readEnvFile();
  if (platform === 'netease') return data.NETEASE_COOKIE ?? '';
  return data.QQ_COOKIE ?? '';
}

/** 把 env 里的 QQ cookie 同步到热读取文件，供 QQ 后端使用（清除凭证时同样要清空） */
export function syncQqCookieFile(): void {
  const cookie = getCookie('qq');
  try {
    const current = fs.existsSync(paths.qqCookieFile)
      ? fs.readFileSync(paths.qqCookieFile, 'utf8')
      : null;
    if (current === cookie) return;
    fs.writeFileSync(paths.qqCookieFile, cookie, { mode: 0o600 });
    try {
      fs.chmodSync(paths.qqCookieFile, 0o600);
    } catch {
      /* 忽略 */
    }
  } catch {
    /* 写不进去时 QQ 侧退化为匿名请求，不影响其它功能 */
  }
}

export function setCredential(platform: Platform, cookie: string): void {
  const data = { ...readEnvFile() };
  const key = platform === 'netease' ? 'NETEASE_COOKIE' : 'QQ_COOKIE';
  const value = cookie.trim();
  if (value) data[key] = value;
  else delete data[key];
  writeEnvFile(data);
  if (platform === 'qq') syncQqCookieFile();
}

export function clearCredential(platform: Platform): void {
  setCredential(platform, '');
}

/** 非可逆指纹：只用于界面上区分"是不是换了另一份 cookie" */
function fingerprint(cookie: string): string {
  if (!cookie) return '';
  return crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 8);
}

export interface CredentialStatus {
  platform: Platform;
  state: 'configured' | 'anonymous';
  /** 非可逆指纹，绝不包含 cookie 明文 */
  fingerprint: string;
  /** 是否具备会员语义（网易云看 MUSIC_U，QQ 看 qqmusic_key） */
  hasMemberKey: boolean;
}

export function credentialStatus(): CredentialStatus[] {
  const platforms: Platform[] = ['netease', 'qq'];
  return platforms.map((platform) => {
    const cookie = getCookie(platform);
    const hasMemberKey =
      platform === 'netease' ? /MUSIC_U=/.test(cookie) : /qqmusic_key=|qm_keyst=/.test(cookie);
    return {
      platform,
      state: cookie ? 'configured' : 'anonymous',
      fingerprint: fingerprint(cookie),
      hasMemberKey,
    };
  });
}

/** 从 cookie 串里取 uin（归一化为纯数字），用于 QQ 侧校验（不落日志、不回显） */
export function qqUin(cookie: string): string {
  const m = /(?:^|;\s*)(?:uin|wxuin)=([^;]+)/.exec(cookie);
  const raw = m?.[1]?.trim() ?? '';
  // QQ 的 uin 常带 o 前缀（如 o0012345678），与 QQ 后端 parseQqUin 的归一化保持一致
  return raw.replace(/^o(?=\d)/, '');
}

export function initCredentials(): void {
  readEnvFile();
  syncQqCookieFile();
  // 已有凭证时顺手把 .env.local 和 .qq-cookie.txt 的权限收紧，避免历史文件权限过宽
  try {
    if (fs.existsSync(paths.envFile)) fs.chmodSync(paths.envFile, 0o600);
    if (fs.existsSync(paths.qqCookieFile)) fs.chmodSync(paths.qqCookieFile, 0o600);
  } catch {
    /* 忽略 */
  }
}

/** 生成示例文件，说明需要哪些键；真实值永远只写在 .env.local */
export function ensureEnvExample(): void {
  try {
    if (fs.existsSync(paths.envExample)) return;
    fs.writeFileSync(
      paths.envExample,
      [
        '# 复制本文件为 .env.local 并填入真实值。',
        '# .env.local 含登录凭证：权限保持 600，且不要提交到任何仓库。',
        '',
        '# 网易云音乐：登录网页版后，从浏览器开发者工具复制 music.163.com 的 cookie（须含 MUSIC_U=...）',
        'NETEASE_COOKIE=',
        '',
        '# QQ 音乐：从 y.qq.com 复制 cookie（须含 qm_keyst=... 或 qqmusic_key=...）',
        'QQ_COOKIE=',
        '',
      ].join('\n'),
      'utf8',
    );
  } catch {
    /* 无写权限时忽略 */
  }
}
