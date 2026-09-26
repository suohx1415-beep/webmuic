import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { GatewayError } from './errors.js';

/**
 * express 4 不会自动捕获 async 处理器抛出的异常，统一包一层。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** 只放行本机来源；本工具不面向局域网或公网暴露 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function corsForLocalhost(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && LOCAL_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range,If-Range');
    // 音频代理需要浏览器能读到这些头，否则 <audio> 的 seek/时长会退化为不可用
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length,X-Quality');
    res.status(204).end();
    return;
  }
  if (!res.hasHeader('Access-Control-Expose-Headers')) {
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length,X-Quality');
  }
  next();
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof GatewayError) {
    const body = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.platform ? { platform: error.platform } : {}),
      },
    };
    res.status(error.status).json(body);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: { code: 'INTERNAL', message } });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '未知的网关路由' } });
}

/** express 默认错误处理器：把适配器抛出的 GatewayError 转成约定的错误体 */
export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  // body-parser 的失败（非法 JSON、非对象顶层值、体积超限）属于调用方问题，不该报 500
  const type = (error as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    sendError(res, new GatewayError(400, 'BAD_REQUEST', '请求体不是合法 JSON 对象或体积超限'));
    return;
  }
  sendError(res, error);
}

/** 读取并校验查询参数 */
export function queryString(req: Request, name: string, opts: { required?: boolean } = {}): string {
  const raw = req.query[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value && opts.required) {
    throw new GatewayError(400, 'BAD_REQUEST', `缺少查询参数 ${name}`);
  }
  return value;
}

export function queryInt(
  req: Request,
  name: string,
  opts: { min: number; max: number; fallback: number },
): number {
  const raw = queryString(req, name);
  if (!raw) return opts.fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new GatewayError(400, 'BAD_REQUEST', `查询参数 ${name} 不是有效数字`);
  }
  return Math.min(opts.max, Math.max(opts.min, Math.trunc(n)));
}
