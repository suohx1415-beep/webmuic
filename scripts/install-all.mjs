#!/usr/bin/env node
/**
 * 跨平台一键依赖安装与初始化脚本（适配 Linux、macOS 与 Windows）
 * 特别支持仅安装了 npm 的机器：自动通过 npx 调用 pnpm，无需用户全局安装 pnpm。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.replace(/^v/, '').split('.')[0], 10);
  console.log(`[install] 检测到 Node.js 版本: ${version}`);
  if (major < 18) {
    console.warn(`[install] 警告：推荐 Node.js >= 18 (推荐 Node 20)，当前为 ${version}，可能存在语法或模块兼容性问题。`);
  }
}

function hasCommand(cmd) {
  try {
    const isWin = process.platform === 'win32';
    const checkCmd = isWin ? 'where' : 'which';
    const res = spawnSync(checkCmd, [cmd], { stdio: 'ignore', shell: isWin });
    return res.status === 0;
  } catch {
    return false;
  }
}

function runCmd(command, args, cwd = root) {
  console.log(`[install] 正在执行: ${command} ${args.join(' ')} (目录: ${cwd})`);
  const isWin = process.platform === 'win32';
  // 在 Windows 环境下若调用 npm/npx/pnpm，优先匹配 .cmd 后缀
  let finalCmd = command;
  if (isWin && !command.endsWith('.cmd') && !command.endsWith('.exe')) {
    finalCmd = `${command}.cmd`;
  }
  const res = spawnSync(finalCmd, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
  });
  if (res.status !== 0) {
    throw new Error(`执行失败 (退出码: ${res.status}): ${command} ${args.join(' ')}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('   Webmuic 跨平台一键环境安装向导       ');
  console.log('========================================\n');

  checkNodeVersion();

  const hasPnpm = hasCommand('pnpm');
  let pnpmExec = 'pnpm';
  let pnpmArgs = [];

  if (hasPnpm) {
    console.log('[install] 检测到系统已安装 pnpm');
    pnpmExec = 'pnpm';
    pnpmArgs = [];
  } else {
    console.log('[install] 系统未检测到全局 pnpm，将自动使用 npx 调用 pnpm（无需全局安装）…');
    pnpmExec = 'npx';
    pnpmArgs = ['--yes', 'pnpm'];
  }

  // 1. 安装根目录 monorepo 依赖（含 gateway, web, services/netease）
  console.log('\n[install] 步骤 1/3: 正在安装主工程及工作区依赖…');
  runCmd(pnpmExec, [...pnpmArgs, 'install'], root);

  // 2. 检查并安装 services/qq 依赖
  const qqDir = path.join(root, 'services', 'qq');
  if (fs.existsSync(qqDir)) {
    const qqModules = path.join(qqDir, 'node_modules');
    if (!fs.existsSync(qqModules)) {
      console.log('\n[install] 步骤 2/3: 正在安装 QQ 音乐服务依赖…');
      // QQ 服务目录下使用 pnpm / npm 均可，优先沿用上面的 pnpm
      runCmd(pnpmExec, [...pnpmArgs, 'install'], qqDir);
    } else {
      console.log('\n[install] 步骤 2/3: services/qq 依赖已存在，跳过安装。');
    }
  } else {
    console.log('\n[install] 步骤 2/3: 未检测到 services/qq 目录，跳过。');
  }

  // 3. 应用 QQ 音乐补丁
  console.log('\n[install] 步骤 3/3: 正在检查并应用 QQ 音乐服务补丁…');
  runCmd(process.execPath, [path.join(root, 'scripts', 'patch-qq-backend.mjs')], root);

  console.log('\n========================================');
  console.log('   ✔ 全部依赖安装与补丁应用已顺利完成！  ');
  console.log('========================================');
  console.log('启动方式：');
  if (process.platform === 'win32') {
    console.log('  - Windows 用户双击根目录下的 start-windows.bat 即可一键启动并自动打开浏览器');
    console.log('  - 或在命令行执行: npm start 或 node scripts/dev-all.mjs');
  } else {
    console.log('  - 命令行执行: pnpm dev 或 node scripts/dev-all.mjs');
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n[install] 安装过程中出现错误:', err.message);
  process.exit(1);
});
