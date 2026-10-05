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
import { spawn, spawnSync } from 'node:child_process';
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
  const bundledWin = path.join(root, '.tools', 'node20', 'node.exe');
  if (fs.existsSync(bundledWin)) return bundledWin;
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
  let interval = 40;
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
          interval = Math.min(200, interval + 20);
          timer = setTimeout(attempt, interval);
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
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      } else if (!child.killed) {
        child.kill('SIGTERM');
      }
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  for (const { child } of children) {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else if (process.platform !== 'win32' && child.pid) {
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

  // 并发检查端口占用，缩短启动前探测延迟
  const busyChecks = await Promise.all(
    services.map(async (service) => ((await isPortInUse(service.port)) ? `${service.name} (${service.port})` : null)),
  );
  const busy = busyChecks.filter(Boolean);
  if (busy.length > 0) {
    console.error(`[dev] 以下端口已被占用：${busy.join('、')}`);
    if (process.platform === 'win32') {
      console.error('[dev] 请先停掉旧进程（任务管理器关闭 node.exe 或执行 taskkill /IM node.exe /F）后重试。');
    } else {
      console.error('[dev] 请先停掉旧进程（ss -ltnp | grep <端口> 查 PID）后重试。');
    }
    process.exit(1);
  }

  const qqDir = path.join(root, 'services', 'qq');
  const qqPatchedFile = path.join(qqDir, '.webmuic-patched');
  const patchScript = path.join(root, 'scripts', 'patch-qq-backend.mjs');
  let needPatch = false;

  if (fs.existsSync(qqDir)) {
    if (!fs.existsSync(qqPatchedFile)) {
      needPatch = true;
    } else {
      try {
        const { createHash } = await import('node:crypto');
        const scriptHash = createHash('sha256').update(fs.readFileSync(patchScript)).digest('hex').slice(0, 16);
        const markerContent = fs.readFileSync(qqPatchedFile, 'utf8');
        if (!markerContent.includes(`scriptHash=${scriptHash}`)) {
          console.log('[dev] 检测到 QQ 补丁脚本已更新，准备重新应用补丁…');
          needPatch = true;
        }
      } catch {}
    }
  }

  if (needPatch) {
    console.log('[dev] 正在自动应用 QQ 后端补丁…');
    try {
      const patchRes = spawnSync(NODE, [patchScript], { stdio: 'inherit' });
      if (patchRes.status !== 0) {
        console.error('[dev] 自动补丁执行失败，请检查 scripts/patch-qq-backend.mjs');
        process.exit(1);
      }
    } catch (e) {
      console.error('[dev] 执行补丁出错：', e.message);
      process.exit(1);
    }
  }

  if (!fs.existsSync(path.join(root, 'apps', 'gateway', '.env.local'))) {
    console.warn('[dev] 提示：apps/gateway/.env.local 不存在，将以匿名身份运行（会员曲不可播）。');
    console.warn('[dev] 可以在前端「设置」页扫码/粘贴 cookie，网关会自动创建这个文件。');
  }

  console.log('[dev] 正在并发启动微服务集群…');
  await Promise.all(
    services.map(async (service) => {
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
      }
    }),
  );

  console.log('\n[dev] 全部就绪 —— 打开 http://127.0.0.1:5173');
  console.log(`[dev] 各进程日志：${logsDir}`);
  console.log('[dev] 按 Ctrl+C 停止全部进程\n');

  if (process.argv.includes('--open') || process.env.WEBMUIC_OPEN === '1') {
    const url = 'http://127.0.0.1:5173';
    try {
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        spawn('open', [url], { stdio: 'ignore' });
      } else {
        spawn('xdg-open', [url], { stdio: 'ignore' });
      }
    } catch {}
  }
}

['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((signal) => {
  process.on(signal, () => void shutdown(0));
});

main().catch(async (error) => {
  console.error('[dev] 未捕获的错误：', error);
  await shutdown(1);
});
