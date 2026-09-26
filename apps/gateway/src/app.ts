import express, { type Express } from 'express';
import { corsForLocalhost, errorMiddleware, notFoundHandler } from './http.js';
import { credentialsRouter } from './routes/credentials.js';
import { healthRouter } from './routes/health.js';
import { loginRouter } from './routes/login.js';
import { playlistRouter, recommendRouter } from './routes/playlist.js';
import { searchRouter } from './routes/search.js';
import { streamRouter } from './routes/stream.js';
import { trackRouter } from './routes/track.js';

/**
 * 网关对外契约（全部挂在 /api 下）：
 *   GET    /api/health
 *   GET    /api/search?q=&platform=&limit=&offset=
 *   GET    /api/search/suggest?q=
 *   GET    /api/track/:id
 *   GET    /api/track/:id/url?quality=
 *   GET    /api/track/:id/lyric
 *   GET    /api/stream/:id?quality=
 *   GET    /api/playlist/:id
 *   GET    /api/recommend/daily?platform=&limit=
 *   GET    /api/recommend/similar?seed=
 *   POST   /api/credentials/qq
 *   POST   /api/credentials/netease
 *   GET    /api/credentials/status
 *   POST   /api/login/netease/qr
 *   GET    /api/login/netease/qr/check?key=
 *   DELETE /api/login/netease
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(corsForLocalhost);
  app.use(express.json({ limit: '256kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/credentials', credentialsRouter);
  app.use('/api/login', loginRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/track', trackRouter);
  app.use('/api/stream', streamRouter);
  app.use('/api/playlist', playlistRouter);
  app.use('/api/recommend', recommendRouter);

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}
