import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmuic-adapters-'));
process.env.WEBMUIC_ENV_FILE = path.join(tmpDir, '.env.local');
process.env.WEBMUIC_QQ_COOKIE_FILE = path.join(tmpDir, '.qq-cookie.txt');

const { neteaseAdapter } = await import('../src/adapters/netease.js');
const { qqAdapter } = await import('../src/adapters/qq.js');
const { searchAll } = await import('../src/adapters/index.js');
const { sanitizeCookie } = await import('../src/routes/login.js');
const { GatewayError } = await import('../src/errors.js');

/** 夹具取自真实上游响应（已裁剪），保留容易踩坑的字段与层级 */
const QQ_SEARCH = {
  response: {
    code: 0,
    data: {
      song: {
        totalnum: 600,
        list: [
          {
            songmid: '0039MnYb0qxYhV',
            songid: 97773,
            songname: '晴天',
            singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
            albummid: '000MkMni19ClKG',
            albumname: '叶惠美',
            interval: 269,
            size128: 4317292,
            size320: 10792943,
            sizeflac: 55397039,
            sizeape: 0,
          },
        ],
      },
    },
  },
};

const QQ_TRACK_INFO = {
  response: {
    code: 0,
    songinfo: {
      code: 0,
      data: {
        track_info: {
          id: 627317850,
          mid: '0005QhzT3McVui',
          name: '琵琶曲',
          interval: 235,
          singer: [{ id: 2154829, mid: '0047E3Vr2WNsYe', name: '郑浩' }],
          album: { id: 88258800, mid: '002PmUzc12N5S7', name: '琵琶曲' },
          file: { size_128mp3: 3776877, size_320mp3: 9441896, size_flac: 51150165, size_hires: 0 },
        },
      },
    },
  },
};

const NETEASE_SEARCH = {
  result: {
    songCount: 305,
    songs: [
      {
        id: 2652820720,
        name: '晴天(深情版)',
        dt: 278961,
        fee: 8,
        ar: [{ id: 96154669, name: 'Lucky小爱' }],
        al: { id: 255723258, name: '晴天(深情版)', picUrl: 'http://p3.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/x.jpg' },
        l: { br: 128000, size: 4464684 },
        h: { br: 320000, size: 11161644 },
        sq: { br: 1607018, size: 56037067 },
        hr: null,
      },
    ],
  },
};

interface StubCall {
  url: string;
  init?: RequestInit;
}

let calls: StubCall[] = [];
let handler: (url: string, init?: RequestInit) => unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  handler = () => jsonResponse({});
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init) as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QQ 适配器', () => {
  it('用 query 参数调用上游，不用路径参数（上游控制器只读 ctx.query）', async () => {
    handler = () => jsonResponse(QQ_SEARCH);
    await qqAdapter.search('晴天', { limit: 3, offset: 0 });
    expect(calls[0]?.url).toContain('/getSearchByKey?');
    expect(calls[0]?.url).toContain('key=%E6%99%B4%E5%A4%A9');
  });

  it('搜索态曲目：秒转毫秒、封面由 albummid 拼接、只声明平台确实提供的档位', async () => {
    handler = () => jsonResponse(QQ_SEARCH);
    const { tracks, total } = await qqAdapter.search('晴天', { limit: 3, offset: 0 });
    expect(total).toBe(600);
    const track = tracks[0];
    expect(track?.id).toBe('qq:0039MnYb0qxYhV');
    expect(track?.durationMs).toBe(269000);
    expect(track?.artists[0]?.name).toBe('周杰伦');
    expect(track?.album.coverUrl).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg');
    expect(track?.qualities.map((q) => q.level)).toEqual(['standard', 'high', 'lossless']);
  });

  it('offset 会换算成页码', async () => {
    handler = () => jsonResponse(QQ_SEARCH);
    await qqAdapter.search('x', { limit: 10, offset: 20 });
    expect(calls[0]?.url).toContain('page=3');
  });

  it('详情态曲目（track_info）也能归一化', async () => {
    handler = () => jsonResponse(QQ_TRACK_INFO);
    const track = await qqAdapter.trackDetail('0005QhzT3McVui');
    expect(track?.title).toBe('琵琶曲');
    expect(track?.album.name).toBe('琵琶曲');
    expect(track?.durationMs).toBe(235000);
    expect(track?.qualities.map((q) => q.level)).toEqual(['standard', 'high', 'lossless']);
  });

  it('歌曲不存在（track_info 为空）返回 null 而不是伪造曲目', async () => {
    handler = () => jsonResponse({ response: { songinfo: { code: 404, data: { track_info: {} } } } });
    expect(await qqAdapter.trackDetail('bad')).toBeNull();
  });

  it('purl 为空时逐级降档，返回实际拿到的档位', async () => {
    handler = (url) => {
      // 320 与 flac 都没有链接，只有 128 有
      if (url.includes('quality=320') || url.includes('quality=flac')) {
        return jsonResponse({ data: { playUrl: { mid1: { url: '', error: '暂无播放链接' } } } });
      }
      return jsonResponse({ data: { playUrl: { mid1: { url: 'http://cdn/mid1.mp3', error: false } } } });
    };
    const resolved = await qqAdapter.resolveUrl('mid1', 'lossless');
    expect(resolved.quality).toBe('standard');
    expect(resolved.url).toBe('http://cdn/mid1.mp3');
    expect(calls.map((c) => c.url.replace(/.*quality=/, 'quality='))).toEqual([
      'quality=flac',
      'quality=320',
      'quality=128',
    ]);
  });

  it('所有档位都拿不到链接时抛 URL_UNAVAILABLE', async () => {
    handler = () => jsonResponse({ data: { playUrl: { mid1: { url: '', error: '暂无播放链接' } } } });
    await expect(qqAdapter.resolveUrl('mid1', 'high')).rejects.toMatchObject({
      code: 'URL_UNAVAILABLE',
      status: 410,
    });
    // hires 与 lossless 映射到同一档，应去重后只请求 2 次
    expect(calls).toHaveLength(2);
  });

  it('响应结构不对时报 UPSTREAM_BAD_SHAPE 而不是静默返回空', async () => {
    handler = () => jsonResponse({ unexpected: true });
    await expect(qqAdapter.search('x', { limit: 1, offset: 0 })).rejects.toMatchObject({
      code: 'UPSTREAM_BAD_SHAPE',
    });
  });

  it('上游返回 HTML（非 JSON）时报 UPSTREAM_BAD_SHAPE', async () => {
    handler = () => new Response('<html>502 Bad Gateway</html>', { status: 200 });
    await expect(qqAdapter.search('x', { limit: 1, offset: 0 })).rejects.toMatchObject({
      code: 'UPSTREAM_BAD_SHAPE',
    });
  });

  it('歌词走 query 参数并取出 lrc', async () => {
    handler = () => jsonResponse({ response: { retcode: 0, lyric: '[ti:晴天]\n[00:00.00]晴天' } });
    const result = await qqAdapter.lyric('0039MnYb0qxYhV');
    expect(calls[0]?.url).toContain('songmid=0039MnYb0qxYhV');
    expect(result.lrc).toContain('[ti:晴天]');
  });
});

describe('网易云适配器', () => {
  it('搜索归一化 + 封面 http 升级为 https', async () => {
    handler = () => jsonResponse(NETEASE_SEARCH);
    const { tracks, total } = await neteaseAdapter.search('晴天', { limit: 3, offset: 0 });
    expect(total).toBe(305);
    const track = tracks[0];
    expect(track?.id).toBe('netease:2652820720');
    expect(track?.album.coverUrl).toBe('https://p3.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/x.jpg');
    expect(track?.qualities.map((q) => q.level)).toEqual(['standard', 'high', 'lossless']);
  });

  it('请求 hires 但上游降级为 exhigh 时，回报实际档位 high', async () => {
    handler = () =>
      jsonResponse({
        data: [{ id: 1, url: 'http://cdn/a.mp3', br: 320000, size: 11161644, level: 'exhigh', encodeType: 'mp3' }],
      });
    const resolved = await neteaseAdapter.resolveUrl('1', 'hires');
    expect(resolved.quality).toBe('high');
    expect(resolved.br).toBe(320000);
    expect(calls[0]?.url).toContain('level=hires');
  });

  it('url 为空表示该身份不可播，抛 URL_UNAVAILABLE', async () => {
    handler = () => jsonResponse({ data: [{ id: 1, url: null, level: 'standard', fee: 1 }] });
    await expect(neteaseAdapter.resolveUrl('1', 'standard')).rejects.toMatchObject({ code: 'URL_UNAVAILABLE' });
  });

  it('data 为空时报 UPSTREAM_BAD_SHAPE', async () => {
    handler = () => jsonResponse({ data: [] });
    await expect(neteaseAdapter.resolveUrl('1', 'standard')).rejects.toBeInstanceOf(GatewayError);
  });

  it('有 cookie 时会作为查询参数逐请求注入', async () => {
    const { setCredential } = await import('../src/credentials.js');
    setCredential('netease', 'MUSIC_U=testvalue; os=pc');
    handler = () => jsonResponse(NETEASE_SEARCH);
    await neteaseAdapter.search('x', { limit: 1, offset: 0 });
    // 用 URL 解析器读回，避免被 +/%20 的编码差异干扰
    const cookie = new URL(calls[0]?.url ?? '').searchParams.get('cookie');
    expect(cookie).toBe('MUSIC_U=testvalue; os=pc');
    setCredential('netease', '');
  });
});

describe('searchAll 聚合', () => {
  it('两平台交替穿插，便于同时看到两个来源', async () => {
    handler = (url) => {
      if (url.includes(':3010')) {
        return jsonResponse({
          result: {
            songCount: 2,
            songs: [
              { id: 1, name: 'N1', dt: 1000, ar: [], al: {} },
              { id: 2, name: 'N2', dt: 1000, ar: [], al: {} },
            ],
          },
        });
      }
      return jsonResponse({
        response: {
          data: {
            song: {
              totalnum: 2,
              list: [
                { songmid: 'q1', songname: 'Q1', singer: [], interval: 1 },
                { songmid: 'q2', songname: 'Q2', singer: [], interval: 1 },
              ],
            },
          },
        },
      });
    };
    const result = await searchAll('x', { limit: 2, offset: 0 }, ['netease', 'qq']);
    expect(result.tracks.map((t) => t.title)).toEqual(['N1', 'Q1', 'N2', 'Q2']);
    expect(result.counts).toEqual({ netease: 2, qq: 2 });
    expect(result.ok).toEqual(['netease', 'qq']);
  });

  it('一个平台失败不影响另一个，并给出降级原因', async () => {
    handler = (url) => {
      if (url.includes(':3200')) throw new Error('connect ECONNREFUSED 127.0.0.1:3200');
      return jsonResponse({ result: { songCount: 1, songs: [{ id: 1, name: 'N1', dt: 1, ar: [], al: {} }] } });
    };
    const result = await searchAll('x', { limit: 5, offset: 0 }, ['netease', 'qq']);
    expect(result.ok).toEqual(['netease']);
    expect(result.tracks.map((t) => t.title)).toEqual(['N1']);
    expect(result.failed.qq?.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(result.failed.qq?.message).toContain('qq 后端不可达');
  });
});

describe('sanitizeCookie', () => {
  it('剔除 Max-Age/Path 等属性段，只留键值对', () => {
    const raw = 'MUSIC_U=abc123; Max-Age=31536000; Path=/; HttpOnly; Secure; __csrf=deadbeef; SameSite=Lax';
    expect(sanitizeCookie(raw)).toBe('MUSIC_U=abc123; __csrf=deadbeef');
  });

  it('保留值里含等号的 cookie', () => {
    expect(sanitizeCookie('MUSIC_U=a=b=c; Expires=Wed, 21 Oct 2026 07:28:00 GMT')).toBe('MUSIC_U=a=b=c');
  });

  it('空串与纯属性串都归一化为空', () => {
    expect(sanitizeCookie('')).toBe('');
    expect(sanitizeCookie('Max-Age=315; Path=/')).toBe('');
  });
});
