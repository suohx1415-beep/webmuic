import { Router } from 'express';
import { credentialStatus, qqUin, setCredential } from '../credentials.js';
import { GatewayError } from '../errors.js';
import { asyncHandler } from '../http.js';
import { probeUpstream } from '../upstream.js';

/**
 * 凭证只进不出：这里从不回显 cookie，只返回状态与非可逆指纹。
 */
export const credentialsRouter = Router();

credentialsRouter.get('/status', (_req, res) => {
  res.json({ platforms: credentialStatus() });
});

function readCookieFromBody(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new GatewayError(400, 'BAD_REQUEST', '请求体必须是 JSON 对象');
  }
  const raw = (body as Record<string, unknown>).cookie;
  if (raw === undefined) {
    throw new GatewayError(400, 'BAD_REQUEST', '缺少 cookie 字段（传空字符串表示清除）');
  }
  if (typeof raw !== 'string') {
    throw new GatewayError(400, 'BAD_REQUEST', 'cookie 必须是字符串');
  }
  const value = raw.trim().replace(/^cookie:\s*/i, '').replace(/\s*\n\s*/g, '');
  if (value.length > 20000) {
    throw new GatewayError(400, 'BAD_REQUEST', 'cookie 长度异常，请确认粘贴内容');
  }
  if (value && !value.includes('=')) {
    throw new GatewayError(400, 'BAD_REQUEST', 'cookie 格式不像键值对，请确认粘贴的是完整 cookie 串');
  }
  return value;
}

/**
 * POST /api/credentials/qq  { cookie }
 * 手填 cookie（唯一的 QQ 凭证入口，上游已禁用 setCookie）。
 * cookie 为空串时等同于清除。
 */
credentialsRouter.post(
  '/qq',
  asyncHandler(async (req, res) => {
    const cookie = readCookieFromBody(req.body);
    setCredential('qq', cookie);
    const status = credentialStatus().find((c) => c.platform === 'qq');

    // 有 cookie 时顺带探活，便于界面立刻给出「上游是否可达」的提示
    const probe = cookie ? await probeUpstream('qq') : undefined;
    res.json({
      ok: true,
      status,
      hasUin: Boolean(cookie && qqUin(cookie)),
      upstreamReachable: probe?.reachable ?? null,
    });
  }),
);

/**
 * POST /api/credentials/netease  { cookie }
 * 正常路径是扫码登录（/api/login/netease/qr），这里是等价的手填兜底入口。
 */
credentialsRouter.post(
  '/netease',
  asyncHandler(async (req, res) => {
    const cookie = readCookieFromBody(req.body);
    setCredential('netease', cookie);
    const status = credentialStatus().find((c) => c.platform === 'netease');
    const probe = cookie ? await probeUpstream('netease') : undefined;
    res.json({ ok: true, status, upstreamReachable: probe?.reachable ?? null });
  }),
);
