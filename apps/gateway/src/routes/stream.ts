import { Readable } from 'node:stream';
import { Router, type Request } from 'express';
import { err } from '../errors.js';
import { asyncHandler, queryString } from '../http.js';
import { isQualityLevel, type QualityLevel } from '../types.js';
import { streamTarget, streamTargetFresh } from './track.js';

export const streamRouter = Router();

/** 只透传与音频播放/拖动相关的头，绝不把平台 CDN 的地址或 cookie 泄露出去 */
const PASS_THROUGH_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
  'expires',
];

function parseQuality(raw: string): QualityLevel {
  if (!raw) return 'high';
  if (!isQualityLevel(raw)) {
    throw err.badRequest(`不支持的音质：${raw}（可选 standard/high/lossless/hires）`);
  }
  return raw;
}

const ALLOWED_CDN_HOSTS = [
  /(^|\.)music\.126\.net$/,
  /(^|\.)qq\.com$/,
  /(^|\.)gtimg\.cn$/,
  /(^|\.)tc\.qq\.com$/,
  /(^|\.)smtcdns\.net$/,
  /(^|\.)qpic\.cn$/,
];

function validateStreamUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw err.badRequest('非法的音频流地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw err.badRequest('非法的音频流协议');
  }
  const isAllowed = ALLOWED_CDN_HOSTS.some((pattern) => pattern.test(parsed.hostname));
  if (!isAllowed) {
    throw err.badRequest(`不允许代理该域名的音频流：${parsed.hostname}`);
  }
}

interface StreamTarget {
  platform: 'netease' | 'qq';
  platformTrackId: string;
  url: string;
  quality: QualityLevel;
}

async function fetchUpstream(target: StreamTarget, req: Request): Promise<Response> {
  validateStreamUrl(target.url);

  const headers: Record<string, string> = {
    // 与本机网关保持一致的身份，避免被 CDN 当成爬虫
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  };
  const range = req.headers.range;
  if (typeof range === 'string' && range) headers.range = range;
  const ifRange = req.headers['if-range'];
  if (typeof ifRange === 'string' && ifRange) headers['if-range'] = ifRange;

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());
  const reqSignal = (req as unknown as { signal?: AbortSignal }).signal;
  const signals: AbortSignal[] = [abortController.signal, AbortSignal.timeout(30_000)];
  if (reqSignal instanceof AbortSignal) {
    signals.push(reqSignal);
  }
  const signal = typeof AbortSignal.any === 'function'
    ? AbortSignal.any(signals)
    : abortController.signal;

  // 转发到平台 CDN 时不再受本地上游限速影响（音频请求量大且是顺序读取）
  return fetch(target.url, { headers, signal });
}

/**
 * GET /api/stream/:id?quality=high
 * 音频代理：平台 CDN 地址永不下发到浏览器；透传 Range 以支持拖动进度。
 */
streamRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const trackId = req.params.id ?? '';
    const quality = parseQuality(queryString(req, 'quality'));

    let target = await streamTarget(trackId, quality);
    let upstream = await fetchUpstream(target, req);

    if (upstream.status === 403 || upstream.status === 404) {
      // 缓存里的地址在 TTL 内就被 CDN 拒绝，说明平台提前收回了链接：丢弃缓存重解析一次
      upstream.body?.cancel().catch(() => undefined);
      target = await streamTargetFresh(trackId, quality);
      upstream = await fetchUpstream(target, req);
    }

    if (!upstream.ok && upstream.status !== 206) {
      upstream.body?.cancel().catch(() => undefined);
      throw err.urlUnavailable(target.platform);
    }

    if (res.writableEnded || res.destroyed) {
      upstream.body?.cancel().catch(() => undefined);
      return;
    }

    for (const name of PASS_THROUGH_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('accept-ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
    // 便于前端/排查时确认实际拿到的档位
    res.setHeader('x-quality', target.quality);
    res.setHeader('cache-control', 'no-store');

    res.status(upstream.status);

    if (!upstream.body) {
      res.end();
      return;
    }

    const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    // 前端拖动进度会频繁中断请求，务必把上游流一并销毁，避免连接堆积
    res.on('close', () => body.destroy());
    res.on('error', () => body.destroy());
    body.on('error', () => {
      if (!res.destroyed) res.destroy();
    });
    body.pipe(res);
  }),
);
