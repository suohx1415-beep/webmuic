import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 测试绝不能碰真实凭证文件：用环境变量把路径指到临时目录后再导入模块。
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmuic-cred-'));
const envFile = path.join(tmpDir, '.env.local');
const qqCookieFile = path.join(tmpDir, '.qq-cookie.txt');
process.env.WEBMUIC_ENV_FILE = envFile;
process.env.WEBMUIC_QQ_COOKIE_FILE = qqCookieFile;

const cred = await import('../src/credentials.js');

const NETEASE_COOKIE = 'MUSIC_U=abc123def456; __csrf=deadbeef; os=pc';
const QQ_COOKIE = 'uin=o0012345678; qm_keyst=secretvalue123; qqmusic_key=secretvalue123';

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('credentials', () => {
  beforeAll(() => {
    cred.initCredentials();
  });

  it('初始状态为匿名，且不回显任何明文', () => {
    const status = cred.credentialStatus();
    expect(status).toHaveLength(2);
    for (const entry of status) {
      expect(entry.state).toBe('anonymous');
      expect(entry.fingerprint).toBe('');
      expect(entry.hasMemberKey).toBe(false);
    }
  });

  it('写入后只暴露指纹与会员语义，不暴露 cookie 本身', () => {
    cred.setCredential('netease', NETEASE_COOKIE);
    cred.setCredential('qq', QQ_COOKIE);

    const serialized = JSON.stringify(cred.credentialStatus());
    expect(serialized).not.toContain('abc123def456');
    expect(serialized).not.toContain('secretvalue123');
    expect(serialized).not.toContain('deadbeef');

    const netease = cred.credentialStatus().find((c) => c.platform === 'netease');
    expect(netease?.state).toBe('configured');
    expect(netease?.hasMemberKey).toBe(true);
    expect(netease?.fingerprint).toMatch(/^[0-9a-f]{8}$/);

    const qq = cred.credentialStatus().find((c) => c.platform === 'qq');
    expect(qq?.hasMemberKey).toBe(true);
  });

  it('指纹稳定且与 cookie 一一对应', () => {
    const first = cred.credentialStatus().find((c) => c.platform === 'netease')?.fingerprint;
    expect(cred.credentialStatus().find((c) => c.platform === 'netease')?.fingerprint).toBe(first);

    cred.setCredential('netease', 'MUSIC_U=othervalue');
    const second = cred.credentialStatus().find((c) => c.platform === 'netease')?.fingerprint;
    expect(second).not.toBe(first);
  });

  it('缺 MUSIC_U 时不算会员凭证', () => {
    cred.setCredential('netease', '__csrf=onlycsrf; os=pc');
    expect(cred.credentialStatus().find((c) => c.platform === 'netease')?.hasMemberKey).toBe(false);
  });

  it('.env.local 以 600 权限落盘并含凭证', () => {
    cred.setCredential('qq', QQ_COOKIE);
    const mode = fs.statSync(envFile).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(envFile, 'utf8')).toContain(QQ_COOKIE);
  });

  it('QQ cookie 会同步到热读取文件供 QQ 后端使用', () => {
    cred.setCredential('qq', QQ_COOKIE);
    expect(fs.readFileSync(qqCookieFile, 'utf8')).toBe(QQ_COOKIE);
  });

  it('清除后回到匿名状态并清空热读取文件', () => {
    cred.clearCredential('qq');
    expect(cred.credentialStatus().find((c) => c.platform === 'qq')?.state).toBe('anonymous');
    expect(fs.readFileSync(qqCookieFile, 'utf8')).toBe('');
  });

  it('能从 cookie 里解析出 QQ uin 并归一化去掉 o 前缀', () => {
    expect(cred.qqUin(QQ_COOKIE)).toBe('0012345678');
    expect(cred.qqUin('uin=123456')).toBe('123456');
    expect(cred.qqUin('qm_keyst=x')).toBe('');
  });
});
