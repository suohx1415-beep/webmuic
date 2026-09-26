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
    // 只打桩上游（3010），本机网关自身的请求放行走真实实现
    if (!url.includes(':3010')) {
      const original = globalThis.fetch;
      void original;
      throw new Error(`unexpected non-upstream fetch: ${url}`);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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
});
