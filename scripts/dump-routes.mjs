#!/usr/bin/env node
/**
 * 列出两个第三方后端真实暴露的路由，方便对照排查（本项目踩过好几次"路由名猜错"的坑）。
 *
 * 用法：node scripts/dump-routes.mjs [netease|qq]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = process.argv[2] ?? 'all';

/** 网易云：一个模块文件对应一个路由，路由名由文件名推导（module/*.js） */
function neteaseRoutes() {
  const dir = path.join(root, 'services', 'netease', 'node_modules', 'NeteaseCloudMusicApi', 'module');
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .map((f) => `/${f.replace(/\.js$/, '').replace(/_/g, '/').replace(/\/+/g, '/')}`)
    .sort();
}

/** QQ：从 src/routes/router.ts 里抓取注册语句（跨多行的写法也要能识别） */
function qqRoutes() {
  const file = path.join(root, 'services', 'qq', 'src', 'routes', 'router.ts');
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf8');
  const routes = [];
  const pattern = /router\.(get|post|put|delete)\(\s*'([^']+)'[\s\S]{0,160}?context\.(\w+)/g;
  for (const match of source.matchAll(pattern)) {
    const method = (match[1] ?? 'get').toUpperCase();
    const route = match[2] ?? '?';
    const handler = match[3] ?? '';
    routes.push(`${method.padEnd(5)} ${route.padEnd(58)} -> ${handler}`);
  }
  return routes;
}

function print(title, routes, hint) {
  console.log(`\n=== ${title} ===`);
  if (!routes) {
    console.log(`  （未找到源码：${hint}）`);
    return;
  }
  console.log(`  共 ${routes.length} 条`);
  for (const route of routes) console.log(`  ${route}`);
}

if (which === 'all' || which === 'netease') {
  print('网易云后端路由（NeteaseCloudMusicApi module/）', neteaseRoutes(), 'services/netease/node_modules/NeteaseCloudMusicApi 不存在');
}
if (which === 'all' || which === 'qq') {
  print(
    'QQ 后端路由（Rain120/qq-music-api src/routes/router.ts）',
    qqRoutes(),
    'services/qq 不存在（需先 clone 并执行 scripts/patch-qq-backend.mjs）',
  );
}

console.log('\n注意：QQ 后端的控制器全部读取 ctx.query，即使路由声明了 /:xxx? 路径参数也一样。');
console.log('      调用时请一律使用 query 形式（例如 /getLyric?songmid=...）。');
