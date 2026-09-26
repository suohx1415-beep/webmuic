import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmuic-app-'));
process.env.WEBMUIC_ENV_FILE = path.join(tmpDir, '.env.local');
process.env.WEBMUIC_QQ_COOKIE_FILE = path.join(tmpDir, '.qq-cookie.txt');
// 指向一个必然连不上的端口，保证健康检查走「不可达」分支而不会打到真实上游
process.env.NETEASE_BASE = 'http://127.0.0.1:59991';
process.env.QQ_BASE = 'http://127.0.0.1:59992';

const { createApp } = await import('../src/app.js');

/** 断言用的宽松 JSON 读取：契约字段在测试里逐个显式断言 */
async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (typeof address === 'object' && address) origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('网关 HTTP 契约', () => {
  it('GET /api/health 在没有任何上游的情况下也返回 ok，并标出不可达平台', async () => {
    const res = await fetch(`${origin}/api/health`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.gateway.name).toBe('webmuic-gateway');
    expect(body.platforms.map((p: { platform: string }) => p.platform)).toEqual(['netease', 'qq']);
    for (const entry of body.platforms) {
      expect(entry.reachable).toBe(false);
      expect(entry.credential.state).toBe('anonymous');
      expect(entry.cooldownMs).toBe(0);
    }
  });

  it('GET /api/credentials/status 只返回状态与指纹，不含明文', async () => {
    const res = await fetch(`${origin}/api/credentials/status`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.platforms).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/MUSIC_U=|qm_keyst=/);
  });

  it('POST /api/credentials/qq 能写入凭证，响应体不含 cookie 明文', async () => {
    const cookie = 'uin=o0012345678; qm_keyst=VERYSECRETVALUE; qqmusic_key=VERYSECRETVALUE';
    const res = await fetch(`${origin}/api/credentials/qq`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.hasUin).toBe(true);
    expect(body.status.state).toBe('configured');
    expect(body.status.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(body)).not.toContain('VERYSECRETVALUE');
  });

  it('POST /api/credentials/qq 校验入参', async () => {
    const cases: Array<[unknown, number]> = [
      [{}, 400],
      [{ cookie: 123 }, 400],
      [{ cookie: 'not-a-cookie' }, 400],
      ['not-an-object', 400],
    ];
    for (const [payload, status] of cases) {
      const res = await fetch(`${origin}/api/credentials/qq`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(status);
      const body = await json(res);
      expect(body.error.code).toBe('BAD_REQUEST');
    }
  });

  it('空 cookie 等同于清除凭证', async () => {
    const res = await fetch(`${origin}/api/credentials/qq`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: '' }),
    });
    const body = await json(res);
    expect(body.status.state).toBe('anonymous');
    expect(body.hasUin).toBe(false);
  });

  it('未知路由返回统一错误体而不是 HTML 栈', async () => {
    const res = await fetch(`${origin}/api/nope`);
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('仅对本机来源回 CORS 头，且预检放行 Range', async () => {
    const local = await fetch(`${origin}/api/health`, {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const foreign = await fetch(`${origin}/api/health`, {
      headers: { origin: 'http://evil.example.com' },
    });
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await fetch(`${origin}/api/stream/netease:1`, {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Range');
  });

  it('GET /api/user/playlists 在匿名状态下返回两平台空歌单与未配置标记', async () => {
    const res = await fetch(`${origin}/api/user/playlists`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.netease).toBeDefined();
    expect(body.qq).toBeDefined();
    expect(body.netease.configured).toBe(false);
    expect(body.qq.configured).toBe(false);
    expect(Array.isArray(body.netease.playlists)).toBe(true);
    expect(Array.isArray(body.qq.playlists)).toBe(true);
  });

  it('GET /api/album/:id 校验非法专辑 id 格式返回 400', async () => {
    const res = await fetch(`${origin}/api/album/invalid-album-id`);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

