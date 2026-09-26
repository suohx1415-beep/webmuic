import { createApp } from './app.js';
import { config } from './config.js';
import { ensureEnvExample, initCredentials } from './credentials.js';

initCredentials();
ensureEnvExample();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`[gateway] listening on http://${config.host}:${config.port}`);
  console.log(`[gateway] netease upstream: ${config.neteaseBase}`);
  console.log(`[gateway] qq upstream:      ${config.qqBase}`);
});

server.on('error', (error) => {
  console.error('[gateway] 启动失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

function shutdown(signal: string): void {
  console.log(`[gateway] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  // 兜底：连接迟迟不释放时强制退出
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
