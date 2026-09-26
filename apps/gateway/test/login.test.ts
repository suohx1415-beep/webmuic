import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** 把凭证路径指到临时目录，避免测试写到真实 .env.local */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmuic-login-'));
const envFile = path.join(tmpDir, '.env.local');
process.env.WEBMUIC_ENV_FILE = envFile;
process.env.WEBMUIC_QQ_COOKIE_FILE = path.join(tmpDir, '.qq-cookie.txt');

const { createApp } = await import('../src/app.js');
const { sanitizeCookie } = await import('../src/routes/login.js');
const { getCookie, credentialStatus, setCredential } = await import('../src/credentials.js');

let payload: unknown = {};
let upstreamCalls: string[] = [];
let server: Server;
let origin = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (typeof address === 'object' && address) origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  payload = { code: 200, data: {} };
  upstreamCalls = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    upstreamCalls.push(url);
    // 只打桩上游（3010）或 QQ/微信接口，本机网关自身的请求放行走真实实现
    if (url.includes(':3010')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('ptlogin2.qq.com/ptqrshow')) {
      return new Response(Buffer.from('fake-png-data'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'set-cookie': 'qrsig=mock-qrsig-12345; Path=/; Domain=ptlogin2.qq.com;',
        },
      });
    }

    if (url.includes('ptlogin2.qq.com/ptqrlogin')) {
      const text = typeof payload === 'string' ? payload : "ptuiCB('66','0','','0','二维码未失效。', '')";
      return new Response(text, {
        status: 200,
        headers: {
          'content-type': 'application/javascript',
          'set-cookie': 'uin=o123456789; Path=/;, skey=@mock_skey; Path=/;',
        },
      });
    }

    if (url.includes('open.weixin.qq.com/connect/qrconnect')) {
      return new Response('<html><script>window.QRLogin = { uuid: "mock-wx-uuid-999" };</script></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url.includes('open.weixin.qq.com/connect/qrcode')) {
      return new Response(Buffer.from('fake-jpg-data'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }

    if (url.includes('lp.open.weixin.qq.com/connect/l/qrconnect')) {
      const text = typeof payload === 'string' ? payload : 'window.wx_errcode=408;';
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'application/javascript' },
      });
    }

    if (url.includes('u.y.qq.com/cgi-bin/musicu.fcg')) {
      return new Response(
        JSON.stringify({
          code: 0,
          req: {
            code: 0,
            data: {
              musicid: '987654321',
              musickey: 'W_X_mock_key_value',
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    throw new Error(`unexpected non-upstream fetch: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function call(pathname: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  // 通过真实 HTTP 端口访问网关：这里用 node 原始 http 模块，避免被上面的 fetch 打桩拦截
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(`${origin}${pathname}`, { method: init?.method ?? 'GET' }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let body: Record<string, any> = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    if (init?.body) req.write(init.body);
    req.end();
  });
}

describe('扫码登录的 cookie 处理', () => {
  it('等待扫码（801）时上游给的临时 cookie 会被丢弃，且不回显', async () => {
    setCredential('netease', '');
    payload = { code: 801, message: '等待扫码', cookie: 'NMTID=temporary; Max-Age=315' };

    const res = await call('/api/login/netease/qr/check?key=k');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('waiting');
    expect(getCookie('netease')).toBe('');
    expect(JSON.stringify(res.body)).not.toContain('NMTID');
    expect(JSON.stringify(res.body)).not.toContain('temporary');
  });

  it('确认（803）后 cookie 落盘、剔除属性段，响应体不含明文', async () => {
    setCredential('netease', '');
    payload = {
      code: 803,
      message: '授权登陆成功',
      cookie: 'MUSIC_U=SECRETVALUE123; Max-Age=31536000; Path=/; HttpOnly; __csrf=csrfvalue; SameSite=Lax',
    };

    const res = await call('/api/login/netease/qr/check?key=k');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('confirmed');
    expect(JSON.stringify(res.body)).not.toContain('SECRETVALUE123');
    expect(JSON.stringify(res.body)).not.toContain('csrfvalue');

    expect(getCookie('netease')).toBe('MUSIC_U=SECRETVALUE123; __csrf=csrfvalue');
    expect(fs.readFileSync(envFile, 'utf8')).toContain('NETEASE_COOKIE=MUSIC_U=SECRETVALUE123; __csrf=csrfvalue');
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);

    const status = credentialStatus().find((c) => c.platform === 'netease');
    expect(status?.state).toBe('configured');
    expect(status?.hasMemberKey).toBe(true);
    expect(JSON.stringify(status)).not.toContain('SECRETVALUE123');
  });

  it('确认但上游没给 cookie 时报 UPSTREAM_BAD_SHAPE，不写入空凭证', async () => {
    setCredential('netease', '');
    payload = { code: 803, message: 'ok' };

    const res = await call('/api/login/netease/qr/check?key=k');
    expect(res.status).toBe(502);
    expect(res.body.error?.code).toBe('UPSTREAM_BAD_SHAPE');
    expect(getCookie('netease')).toBe('');
  });

  it('申请二维码时会串起 key 与 create 两次调用', async () => {
    payload = { code: 200, data: { unikey: 'unikey-1' } };
    const first = await call('/api/login/netease/qr', { method: 'POST' });
    expect(first.status).toBe(502); // create 那步被同一个桩返回了 unikey，没有 qrimg
    expect(first.body.error?.code).toBe('UPSTREAM_BAD_SHAPE');
    expect(upstreamCalls.at(-1)).toContain('/login/qr/create?key=unikey-1');
  });

  it('缺少 key 参数时报 400', async () => {
    const res = await call('/api/login/netease/qr/check');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('BAD_REQUEST');
  });

  it('sanitizeCookie 只保留键值对', () => {
    expect(sanitizeCookie('MUSIC_U=a; Max-Age=1; Path=/; HttpOnly; Secure')).toBe('MUSIC_U=a');
  });

  describe('QQ 音乐扫码登录', () => {
    it('申请手机 QQ 扫码二维码返回 key 与 dataURL 图片', async () => {
      const res = await call('/api/login/qq/qr', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('mock-qrsig-12345');
      expect(res.body.type).toBe('qq');
      expect(res.body.qrimg).toContain('data:image/png;base64,');
    });

    it('申请微信扫码登录二维码返回 uuid 与 dataURL 图片', async () => {
      const res = await call('/api/login/qq/qr?type=wx', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(res.body.key).toBe('mock-wx-uuid-999');
      expect(res.body.type).toBe('wx');
      expect(res.body.qrimg).toContain('data:image/jpeg;base64,');
    });

    it('QQ 扫码轮询：等待扫码状态（66）', async () => {
      payload = "ptuiCB('66','0','','0','二维码未失效。', '')";
      const res = await call('/api/login/qq/qr/check?key=mock-qrsig-12345&type=qq');
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('waiting');
    });

    it('QQ 扫码轮询：已扫码待确认（67）', async () => {
      payload = "ptuiCB('67','0','','0','二维码正在验证中。', '')";
      const res = await call('/api/login/qq/qr/check?key=mock-qrsig-12345&type=qq');
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('scanned');
    });

    it('QQ 扫码轮询：确认成功（0）后 cookie 落盘且响应不含明文', async () => {
      setCredential('qq', '');
      payload = "ptuiCB('0','0','','0','登录成功！', '测试用户')";
      const res = await call('/api/login/qq/qr/check?key=mock-qrsig-12345&type=qq');
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('confirmed');
      expect(res.body.message).toContain('登录成功');

      const savedCookie = getCookie('qq');
      expect(savedCookie).toContain('uin=123456789');
      // 检查 QQ cookie 文件同步
      expect(fs.existsSync(process.env.WEBMUIC_QQ_COOKIE_FILE!)).toBe(true);
      expect(fs.readFileSync(process.env.WEBMUIC_QQ_COOKIE_FILE!, 'utf8')).toContain('uin=123456789');
    });

    it('微信扫码轮询：确认（405）后调用 musicu 成功落盘凭证', async () => {
      setCredential('qq', '');
      payload = "window.wx_errcode=405;window.wx_code='wx-auth-code-123';";
      const res = await call('/api/login/qq/qr/check?key=mock-wx-uuid-999&type=wx');
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('confirmed');

      const savedCookie = getCookie('qq');
      expect(savedCookie).toContain('uin=987654321');
      expect(savedCookie).toContain('qm_keyst=W_X_mock_key_value');
      expect(savedCookie).toContain('qqmusic_key=W_X_mock_key_value');

      const status = credentialStatus().find((c) => c.platform === 'qq');
      expect(status?.state).toBe('configured');
      expect(status?.hasMemberKey).toBe(true);
    });

    it('DELETE /api/login/qq 清除凭证并同步清空 cookie 文件', async () => {
      setCredential('qq', 'uin=123; qm_keyst=abc;');
      expect(getCookie('qq')).toBeTruthy();

      const res = await call('/api/login/qq', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(getCookie('qq')).toBe('');
      expect(fs.readFileSync(process.env.WEBMUIC_QQ_COOKIE_FILE!, 'utf8')).toBe('');
    });
  });
});
