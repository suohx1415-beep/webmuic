/**
 * 持久化只落在浏览器 localStorage（计划明确不引入数据库）。
 * 注意：凭证类信息绝不写入这里——平台 cookie 只存在于网关的 .env.local 里。
 */

const PREFIX = 'webmuic:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 配额满或隐私模式下忽略，不影响本次使用 */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 忽略 */
  }
}

export const STORAGE_KEYS = {
  settings: 'settings',
  queue: 'queue',
  favorites: 'favorites',
} as const;
