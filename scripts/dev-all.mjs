#!/usr/bin/env node
/**
 * 一键启动四个进程（仅绑定 127.0.0.1）：
 *   netease 3010  第三方后端（NeteaseCloudMusicApi）
 *   qq      3200  第三方后端（Rain120/qq-music-api，需先跑 scripts/patch-qq-backend.mjs）
 *   gateway 8787  本项目网关
 *   web     5173  前端 dev server（/api 代理到网关）
 *
 * 用项目内 Node 20 启动，不依赖系统 Node 版本。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = path.join(root, '.logs');

function resolveNode() {
  const bundled = path.join(root, '.tools', 'node20', 'bin', 'node');
  if (fs.existsSync(bundled)) return bundled;
  console.warn('[dev] 未找到 .tools/node20，回退到当前 Node：', process.execPath);
  return process.execPath;
}

const NODE = resolveNode();

function firstExisting(candidates, label) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`找不到 ${label}，候选路径：\n  ${candidates.join('\n  ')}`);
}

const services = [
  {
    name: 'netease',
    port: 3010,
    cwd: path.join(root, 'services', 'netease'),
    entry: () => firstExisting([path.join(root, 'services', 'netease', 'node_modules', 'NeteaseCloudMusicApi', 'app.js')], '网易云后端 app.js'),
    env: { PORT: '3010', HOST: '127.0.0.1' },
    hint: '在 services/netease 里执行 pnpm install 安装 NeteaseCloudMusicApi',
  },
  {
    name: 'qq',
    port: 3200,
    cwd: path.join(root, 'services', 'qq'),
    entry: () => firstExisting([path.join(root, 'services', 'qq', 'src', 'app.ts')], 'QQ 后端 src/app.ts'),
    args: (entry) => ['-r', 'ts-node/register/transpile-only', entry],
    env: {
      PORT: '3200',
      QQ_COOKIE_FILE: path.join(root, 'apps', 'gateway', '.qq-cookie.txt'),
    },
    hint: '先执行 node scripts/patch-qq-backend.mjs（README 的 License 与正文冲突，本项目仅本机使用）',
  },
  {
    name: 'gateway',
    port: 8787,
    cwd: path.join(root, 'apps', 'gateway'),
    entry: () => firstExisting(
      [
        path.join(root, 'apps', 'gateway', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      ],
      'tsx CLI',
    ),
    args: (entry) => [entry, 'watch', path.join(root, 'apps', 'gateway', 'src', 'server.ts')],
    env: { GATEWAY_HOST: '127.0.0.1', GATEWAY_PORT: '8787' },
    hint: '在仓库根目录执行 pnpm install',
  },
  {
    name: 'web',
    port: 5173,
    cwd: path.join(root, 'apps', 'web'),
    entry: () => firstExisting(
      [
        path.join(root, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js'),
        path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      ],
      'vite',
    ),
    args: (entry) => [entry],
    env: { WEB_PORT: '5173' },
    hint: '在仓库根目录执行 pnpm install',
  },
];

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForPort(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let timer;
    const onExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`子进程在端口 ${port} 就绪前提前退出（code=${code}, signal=${signal}）`));
    };
    if (child) child.once('exit', onExit);

    const attempt = () => {
      isPortInUse(port).then((used) => {
        if (used) {
          if (child) child.removeListener('exit', onExit);
          resolve();
        } else if (Date.now() > deadline) {
          if (child) child.removeListener('exit', onExit);
          reject(new Error(`端口 ${port} 在 ${timeoutMs}ms 内没有就绪`));
        } else {
          timer = setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

const children = [];
const logStreams = new Map();

function startService(service) {
  const entry = service.entry();
  const args = service.args ? service.args(entry) : [entry];
  const logFile = path.join(logsDir, `${service.name}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'w' });
  logStreams.set(service.name, stream);

  const child = spawn(NODE, args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.push({ service, child });

  const write = (chunk) => {
    stream.write(chunk);
    if (process.env.WEBMUIC_VERBOSE === '1') process.stdout.write(`[${service.name}] ${chunk}`);
  };
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`\n[dev] ${service.name} 意外退出（code=${code} signal=${signal}）`);
      console.error(`[dev] 日志：${logFile}`);
      void shutdown(1);
    }
  });
  return child;
}

let shuttingDown = false;

async function shutdown(reasonCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[dev] 正在停止所有进程…');
  for (const { child } of children) {
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else if (!child.killed) {
        child.kill('SIGTERM');
      }
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const { child } of children) {
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGKILL');
      } else if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL');
      }
    } catch {}
  }
  for (const stream of logStreams.values()) stream.end();
  process.exit(reasonCode);
}

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });

  // 先检查端口占用，避免出现"以为起来了其实连着旧进程"的假象
  const busy = [];
  for (const service of services) {
    if (await isPortInUse(service.port)) busy.push(`${service.name} (${service.port})`);
  }
  if (busy.length > 0) {
    console.error(`[dev] 以下端口已被占用：${busy.join('、')}`);
    console.error('[dev] 请先停掉旧进程（ss -ltnp | grep <端口> 查 PID）后重试。');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(root, 'services', 'qq', '.webmuic-patched'))) {
    console.warn('[dev] 提示：services/qq 似乎还没有打补丁，cookie 转发与搜索路由可能不可用。');
    console.warn('[dev] 建议先执行：node scripts/patch-qq-backend.mjs');
  }
  if (!fs.existsSync(path.join(root, 'apps', 'gateway', '.env.local'))) {
    console.warn('[dev] 提示：apps/gateway/.env.local 不存在，将以匿名身份运行（会员曲不可播）。');
    console.warn('[dev] 可以在前端「设置」页扫码/粘贴 cookie，网关会自动创建这个文件。');
  }

  for (const service of services) {
    try {
      const child = startService(service);
      await waitForPort(service.port, 60_000, child);
      console.log(`[dev] ${service.name.padEnd(8)} 就绪  http://127.0.0.1:${service.port}`);
    } catch (error) {
      console.error(`\n[dev] 启动 ${service.name} 失败：${error.message}`);
      if (service.hint) console.error(`[dev] 提示：${service.hint}`);
      const logFile = path.join(logsDir, `${service.name}.log`);
      if (fs.existsSync(logFile)) {
        const tail = fs.readFileSync(logFile, 'utf8').split('\n').slice(-25).join('\n');
        console.error(`[dev] ${service.name} 日志尾部：\n${tail}`);
      }
      await shutdown(1);
      return;
    }
  }

  console.log('\n[dev] 全部就绪 —— 打开 http://127.0.0.1:5173');
  console.log(`[dev] 各进程日志：${logsDir}`);
  console.log('[dev] 按 Ctrl+C 停止全部进程\n');
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

main().catch(async (error) => {
  console.error('[dev] 未捕获的错误：', error);
  await shutdown(1);
});
