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
  const search = new URLSearchParams({
    ...params,
    timestamp: Date.now().toString(),
  });
  const query = search.toString();
  return upstreamJson<T>('netease', query ? `${path}?${query}` : path);
}

/** POST /api/login/netease/qr —— 申请一个二维码（返回 key 与 dataURL 图片） */
loginRouter.post(
  '/netease/qr',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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

/**
 * ============================================================================
 * QQ 音乐扫码登录（支持手机 QQ 扫码 与 微信扫码 两种官方渠道）
 * 凭证在服务端提取落盘，绝不下发至浏览器前端。
 * ============================================================================
 */

export function hash33(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash += (hash << 5) + str.charCodeAt(i);
  }
  return 2147483647 & hash;
}

const WX_APPID = 'wx48db31d50e334801';
const WX_REDIRECT_URI = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/';

function parseCookiesFromHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  const rawList: string[] =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : [headers.get('set-cookie') || ''];
  const rawCookies = rawList.flatMap((s) => s.split(/,(?=[^;]+?=)/));

  for (const item of rawCookies) {
    const parts = item.split(';')[0]?.trim();
    if (!parts) continue;
    const eqIdx = parts.indexOf('=');
    if (eqIdx > 0) {
      const k = parts.slice(0, eqIdx).trim();
      const v = parts.slice(eqIdx + 1).trim();
      if (k && !COOKIE_ATTRIBUTE.test(k)) {
        result[k] = v;
      }
    }
  }
  return result;
}

function isSafeTencentUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      /(^|\.)(qq|tencent)\.com$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
}

/** POST /api/login/qq/qr?type=qq|wx —— 申请 QQ 音乐登录二维码 */
loginRouter.post(
  '/qq/qr',
  asyncHandler(async (req, res) => {
    const type = (req.query.type as string)?.toLowerCase() === 'wx' ? 'wx' : 'qq';

    if (type === 'wx') {
      const connectUrl =
        `https://open.weixin.qq.com/connect/qrconnect?appid=${WX_APPID}` +
        `&redirect_uri=${encodeURIComponent(WX_REDIRECT_URI)}` +
        `&response_type=code&scope=snsapi_login&state=STATE` +
        `&href=${encodeURIComponent('https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect')}`;

      const pageRes = await fetch(connectUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          referer: 'https://y.qq.com/',
        },
      });
      const pageText = await pageRes.text();
      const uuidMatch =
        pageText.match(/(?:uuid\s*[=:]\s*["']?|qrcode\/)([A-Za-z0-9_-]+)/i);
      const uuid = uuidMatch ? uuidMatch[1] : '';
      if (!uuid) {
        throw err.upstreamShape('qq', '获取微信登录二维码失败：未解析到 uuid');
      }

      const qrRes = await fetch(`https://open.weixin.qq.com/connect/qrcode/${uuid}`, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          referer: 'https://open.weixin.qq.com/connect/qrconnect',
        },
      });
      const buf = Buffer.from(await qrRes.arrayBuffer());
      const qrimg = `data:image/jpeg;base64,${buf.toString('base64')}`;

      res.json({ key: uuid, qrimg, qrurl: connectUrl, type: 'wx' });
      return;
    }

    // 默认手机 QQ 扫码
    const qrUrl =
      'https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=' +
      Math.random() +
      '&daid=383&pt_3rd_aid=100497308';

    const qrRes = await fetch(qrUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referer: 'https://xui.ptlogin2.qq.com/',
      },
    });

    const cookies = parseCookiesFromHeaders(qrRes.headers);
    const qrsig = cookies.qrsig;
    if (!qrsig) {
      throw err.upstreamShape('qq', '获取 QQ 登录二维码失败：未返回 qrsig');
    }

    const buf = Buffer.from(await qrRes.arrayBuffer());
    const qrimg = `data:image/png;base64,${buf.toString('base64')}`;

    res.json({ key: qrsig, qrimg, qrurl: '', type: 'qq' });
  }),
);

/** GET /api/login/qq/qr/check?key=&type=qq|wx —— 轮询 QQ 扫码登录状态 */
loginRouter.get(
  '/qq/qr/check',
  asyncHandler(async (req, res) => {
    const key = queryString(req, 'key', { required: true });
    const type = (req.query.type as string)?.toLowerCase() === 'wx' ? 'wx' : 'qq';

    if (type === 'wx') {
      const checkUrl = `https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${encodeURIComponent(key)}&_=${Date.now()}`;
      const checkRes = await fetch(checkUrl, {
        signal: AbortSignal.timeout(25_000),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          referer: 'https://open.weixin.qq.com/',
        },
      });
      const raw = await checkRes.text();
      const errMatch = raw.match(/wx_errcode\s*=\s*'?([0-9]+)'?/);
      if (!checkRes.ok || !errMatch) {
        throw err.upstreamShape('qq', `微信扫码轮询响应格式异常（HTTP ${checkRes.status}）`);
      }
      const code = Number(errMatch[1]);

      // 微信状态码映射
      if (code === 408) {
        res.json({ code, state: 'waiting', message: '等待微信扫码' });
        return;
      }
      if (code === 404) {
        res.json({ code, state: 'scanned', message: '已扫码，请在微信中点击确认' });
        return;
      }
      if (code === 402) {
        res.json({ code, state: 'expired', message: '二维码已过期，请重新生成' });
        return;
      }
      if (code !== 405) {
        res.json({ code, state: 'failed', message: '微信登录失败或已取消' });
        return;
      }

      // code === 405 表示确认成功，提取 wx_code
      const codeMatch = raw.match(/wx_code\s*=\s*["']([^"']*)["']/);
      const wxCode = codeMatch ? codeMatch[1] : '';
      if (!wxCode) {
        throw err.upstreamShape('qq', '微信授权确认但未返回 code');
      }

      // 用 wx_code 换取 QQ 音乐凭据
      const loginPayload = {
        comm: {
          tmeAppID: 'qqmusic',
          tmeLoginType: '1',
          g_tk: 5381,
          platform: 'yqq',
          ct: 24,
          cv: 0,
        },
        req: {
          module: 'music.login.LoginServer',
          method: 'Login',
          param: {
            strAppid: WX_APPID,
            code: wxCode,
          },
        },
      };

      const musicuRes = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          referer: WX_REDIRECT_URI,
          origin: 'https://y.qq.com',
          'content-type': 'application/x-www-form-urlencoded',
          cookie: 'login_type=2',
        },
        body: JSON.stringify(loginPayload),
      });

      const musicuRaw = await musicuRes.text();
      let musicuData: {
        code?: number;
        req?: { code?: number; msg?: string; data?: Record<string, unknown> };
      };
      try {
        musicuData = JSON.parse(musicuRaw);
      } catch {
        throw err.upstreamShape('qq', '微信凭据解析失败：上游未返回有效 JSON');
      }

      const reqBody = musicuData.req;
      if (musicuData.code !== 0 || reqBody?.code !== 0) {
        throw err.upstreamShape('qq', `换取凭据失败：${reqBody?.msg || '未知错误'}`);
      }

      const d = reqBody?.data || {};
      const musicid = String(d.str_musicid || d.musicid || d.uin || '');
      const musickey = String(d.musickey || d.music_key || d.qm_keyst || '');

      if (!musicid || !musickey) {
        throw err.upstreamShape('qq', 'QQ 音乐凭据解析为空');
      }

      // 组装标准化 QQ Cookie
      const finalCookie = `uin=${musicid}; wxuin=${musicid}; qm_keyst=${musickey}; qqmusic_key=${musickey}; tmeLoginType=1;`;
      setCredential('qq', finalCookie);

      res.json({
        code: 0,
        state: 'confirmed',
        message: '微信扫码登录成功',
        status: credentialStatus().find((c) => c.platform === 'qq'),
      });
      return;
    }

    // 默认 QQ 扫码流程
    const ptqrtoken = hash33(key);
    const checkUrl =
      'https://ssl.ptlogin2.qq.com/ptqrlogin?' +
      new URLSearchParams({
        u1: 'https://graph.qq.com/oauth2.0/login_jump',
        ptqrtoken: String(ptqrtoken),
        ptredirect: '100',
        h: '1',
        t: '1',
        g: '1',
        from_ui: '1',
        ptlang: '2052',
        action: `0-0-${Date.now()}`,
        js_ver: '21072115',
        js_type: '1',
        login_sig: '',
        pt_uistyle: '40',
        aid: '716027609',
        daid: '383',
        pt_3rd_aid: '100497308',
        has_onekey: '1',
        pttype: '1',
        service: 'ptqrlogin',
        nodirect: '0',
      }).toString();

    const checkRes = await fetch(checkUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referer: 'https://xui.ptlogin2.qq.com/',
        cookie: `qrsig=${key}`,
      },
    });

    const raw = await checkRes.text();
    const partsMatch = raw.match(/'([^']*)'/g);
    const tokens = partsMatch ? partsMatch.map((s) => s.slice(1, -1)) : [];
    const ptCode = tokens[0] ?? '';
    const redirectUrl = tokens[2] ?? '';
    const ptMsg = tokens[4] ?? '';

    // ptqrlogin 状态码
    if (ptCode === '66') {
      res.json({ code: 66, state: 'waiting', message: ptMsg || '等待扫码' });
      return;
    }
    if (ptCode === '67') {
      res.json({ code: 67, state: 'scanned', message: ptMsg || '已扫码，请在手机 QQ 上确认' });
      return;
    }
    if (ptCode === '65') {
      res.json({ code: 65, state: 'expired', message: ptMsg || '二维码已过期，请重新获取' });
      return;
    }
    if (ptCode !== '0') {
      res.json({ code: Number(ptCode) || -1, state: 'failed', message: ptMsg || '登录失败' });
      return;
    }

    // ptCode === '0'：确认登录成功！
    // 收集响应本身的 Set-Cookie 以及跳转 URL 的 Cookie
    const collectedCookies = parseCookiesFromHeaders(checkRes.headers);

    if (redirectUrl) {
      try {
        let currentUrl = redirectUrl;
        for (let i = 0; i < 5 && currentUrl; i++) {
          if (!isSafeTencentUrl(currentUrl)) break;
          const cookieHeader = Object.entries(collectedCookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
          const redRes = await fetch(currentUrl, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
            headers: {
              'user-agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              referer: 'https://y.qq.com/',
              cookie: cookieHeader,
            },
          });
          const newCookies = parseCookiesFromHeaders(redRes.headers);
          Object.assign(collectedCookies, newCookies);
          const location = redRes.headers.get('location');
          await redRes.body?.cancel().catch(() => {});
          if (location && redRes.status >= 300 && redRes.status < 400) {
            const nextUrl = new URL(location, currentUrl).toString();
            currentUrl = isSafeTencentUrl(nextUrl) ? nextUrl : '';
          } else {
            break;
          }
        }
      } catch {
        /* 跳转获取附加 cookie 即使网络异常也不阻断主流程 */
      }
    }

    // 规范化 Cookie 字段
    const rawUin =
      collectedCookies.uin ||
      collectedCookies.ptui_loginuin ||
      collectedCookies.luin ||
      collectedCookies.p_uin ||
      collectedCookies.superuin ||
      '';
    const uin = rawUin.replace(/^o(?=\d)/, '');
    const musickey =
      collectedCookies.qqmusic_key ||
      collectedCookies.qm_keyst ||
      collectedCookies.p_skey ||
      collectedCookies.skey ||
      '';

    if (!uin) {
      throw err.upstreamShape('qq', 'QQ 扫码成功但未获取到账号信息（缺少 uin）');
    }

    collectedCookies.uin = uin;
    if (musickey && !collectedCookies.qm_keyst) {
      collectedCookies.qm_keyst = musickey;
    }
    if (musickey && !collectedCookies.qqmusic_key) {
      collectedCookies.qqmusic_key = musickey;
    }

    const cookieStr = Object.entries(collectedCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    setCredential('qq', cookieStr);

    res.json({
      code: 0,
      state: 'confirmed',
      message: 'QQ 扫码登录成功',
      status: credentialStatus().find((c) => c.platform === 'qq'),
    });
  }),
);

/** DELETE /api/login/qq —— 退出 QQ 登录（清除凭证） */
loginRouter.delete(
  '/qq',
  asyncHandler(async (_req, res) => {
    setCredential('qq', '');
    res.json({ ok: true, status: credentialStatus().find((c) => c.platform === 'qq') });
  }),
);
