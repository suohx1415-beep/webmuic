import { Router } from 'express';
import { credentialStatus, setCredential } from '../credentials.js';
import { err } from '../errors.js';
import { asyncHandler, queryString } from '../http.js';
import { upstreamJson } from '../upstream.js';

export const loginRouter = Router();

/**
 * 网易云扫码登录。
 * 实测：cookie 经 /login/qr/check 的响应体 `cookie` 字段下发（不是 Set-Cookie），
 * 因此这里在服务端接住并落盘，浏览器全程看不到 cookie 明文。
 */

type Json = Record<string, unknown>;

/** 扫码状态：上游 code 800/801/802/803 */
const QR_STATE: Record<number, string> = {
  800: 'expired',
  801: 'waiting',
  802: 'scanned',
  803: 'confirmed',
};

const COOKIE_ATTRIBUTE =
  /^(?:max-age|expires|path|domain|httponly|secure|samesite|version|comment|commenturl|discard|port)$/i;

/**
 * 上游给的是一串 Set-Cookie 片段拼起来的内容，混着 Max-Age 之类的属性。
 * 作为请求 cookie 转发前要把属性段剔除，只留键值对。
 */
export function sanitizeCookie(raw: string): string {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const name = part.split('=')[0]?.trim() ?? '';
      return Boolean(name) && !COOKIE_ATTRIBUTE.test(name);
    })
    .join('; ');
}

async function callNetease<T = Json>(path: string, params: Record<string, string> = {}): Promise<T> {
  const search = new URLSearchParams(params);
  const query = search.toString();
  return upstreamJson<T>('netease', query ? `${path}?${query}` : path);
}

/** POST /api/login/netease/qr —— 申请一个二维码（返回 key 与 dataURL 图片） */
loginRouter.post(
  '/netease/qr',
  asyncHandler(async (_req, res) => {
    const keyBody = await callNetease('/login/qr/key');
    const key = String((keyBody.data as Json | undefined)?.unikey ?? '');
    if (!key) throw err.upstreamShape('netease', 'login/qr/key 未返回 unikey');

    const createBody = await callNetease('/login/qr/create', { key, qrimg: 'true' });
    const data = (createBody.data ?? {}) as Json;
    const qrimg = String(data.qrimg ?? '');
    const qrurl = String(data.qrurl ?? '');
    if (!qrimg) throw err.upstreamShape('netease', 'login/qr/create 未返回二维码图片');

    res.json({ key, qrimg, qrurl });
  }),
);

/** GET /api/login/netease/qr/check?key= —— 轮询扫码状态；确认后 cookie 落盘，绝不回显 */
loginRouter.get(
  '/netease/qr/check',
  asyncHandler(async (req, res) => {
    const key = queryString(req, 'key', { required: true });
    const body = await callNetease('/login/qr/check', { key });
    const code = Number(body.code ?? 0);
    const state = QR_STATE[code] ?? 'unknown';

    if (code !== 803) {
      // 未确认时上游也会给一段临时 cookie（NMTID 等），这里一律丢弃，避免存下无效凭证
      res.json({ code, state, message: String(body.message ?? '') });
      return;
    }

    const raw = typeof body.cookie === 'string' ? body.cookie : '';
    const cookie = sanitizeCookie(raw);
    if (!cookie) {
      throw err.upstreamShape('netease', '扫码确认但上游未返回 cookie');
    }
    setCredential('netease', cookie);

    res.json({
      code,
      state,
      message: String(body.message ?? ''),
      // 只回报状态与指纹，不回显 cookie
      status: credentialStatus().find((c) => c.platform === 'netease'),
    });
  }),
);

/** DELETE /api/login/netease —— 退出登录（清除网易云凭证） */
loginRouter.delete(
  '/netease',
  asyncHandler(async (_req, res) => {
    setCredential('netease', '');
    res.json({ ok: true, status: credentialStatus().find((c) => c.platform === 'netease') });
  }),
);
