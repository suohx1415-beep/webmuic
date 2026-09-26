#!/usr/bin/env node
/**
 * 对 services/qq（Rain120/qq-music-api，next 分支）应用 webmuic 必需补丁。
 *
 * 为什么需要补丁（Phase 0 实测结论）：
 * 1. 上游 `GET /user/setCookie` 被作者显式禁用（固定返回 403），cookie 只能在
 *    `src/config/default.ts` 里硬编码为 ''，无法在运行时注入。
 * 2. 更关键的是：上游**从不向上游 QQ 接口发送 Cookie 头**，只把由配置推导出的
 *    `uin` 放进请求参数。因此"手填 cookie"这一计划的既定路径在原始实现下无效。
 * 3. `app.listen(serverConfig.port)` 未指定 host，会绑定 0.0.0.0，与"仅本机自用"冲突。
 *
 * 补丁内容（全部幂等，重复执行不会叠加）：
 *   P1 src/config/default.ts      —— 启动时从 QQ_COOKIE 读取 cookie
 *   P2 src/app.ts                 —— 仅监听 127.0.0.1
 *   P3 src/util/qq-cookie.ts      —— 新增：从 QQ_COOKIE_FILE 热读取 cookie（带 1s 缓存）
 *   P4 src/util/request.ts        —— 每次上游请求注入 Cookie 头（支持热更新，无需重启）
 *   P5 src/controllers/getMusicPlay.ts —— uin 改为从 cookie 热解析
 *   P6 src/services/search/getSearchByKey.ts —— 搜索上游换成仍可用的 search_for_qq_cp
 *      （原 client_search_cp 已对本机所有请求返回 500/0 字节，实测 2026-09）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QQ = path.join(ROOT, 'services', 'qq');
const MARK = '[webmuic patch]';

if (!fs.existsSync(QQ)) {
  console.error(`找不到 QQ 后端目录：${QQ}\n请先执行: git clone -b next https://github.com/Rain120/qq-music-api.git services/qq`);
  process.exit(1);
}

const results = [];

function patchFile(rel, edits) {
  const file = path.join(QQ, rel);
  if (!fs.existsSync(file)) {
    results.push(`跳过 ${rel}（文件不存在）`);
    return;
  }
  let src = fs.readFileSync(file, 'utf8');
  let applied = 0;
  for (const { find, replace, label } of edits) {
    if (src.includes(replace) || src.includes(`${MARK} ${label}`)) {
      results.push(`已应用 ${rel} ← ${label}`);
      continue;
    }
    if (!src.includes(find)) {
      results.push(`⚠ 未匹配 ${rel} ← ${label}（上游代码可能已变化，请人工核对）`);
      continue;
    }
    src = src.replace(find, replace);
    applied += 1;
    results.push(`✔ 补丁 ${rel} ← ${label}`);
  }
  if (applied > 0) fs.writeFileSync(file, src);
}

// P3：新增 cookie 热读取模块
const cookieUtilPath = path.join(QQ, 'src/util/qq-cookie.ts');
if (fs.existsSync(cookieUtilPath)) {
  results.push('已应用 src/util/qq-cookie.ts（已存在）');
} else {
  fs.writeFileSync(
    cookieUtilPath,
    `// ${MARK} 从文件热读取 QQ cookie，避免为了换 cookie 重启后端。
import fs from 'node:fs';

let cache: { value: string; at: number } = { value: '', at: 0 };

export function getQqCookie(): string {
  const file = process.env.QQ_COOKIE_FILE;
  if (file) {
    const now = Date.now();
    if (now - cache.at < 1000) return cache.value;
    try {
      cache = { value: fs.readFileSync(file, 'utf8').trim(), at: now };
    } catch {
      cache = { value: '', at: now };
    }
    return cache.value;
  }
  return process.env.QQ_COOKIE || '';
}

/** 从 cookie 串里解析 uin（QQ 音乐用 uin 或 wxuin 表示登录用户） */
export function parseQqUin(cookie: string): string {
  if (!cookie) return '';
  const m = /(?:^|;\\s*)(?:uin|wxuin)=([^;]+)/.exec(cookie);
  if (m) return m[1].trim().replace(/^o(?=\\d)/, '');
  return '';
}
`,
  );
  results.push('✔ 新增 src/util/qq-cookie.ts');
}

// P1：启动时读 env
patchFile('src/config/default.ts', [
  {
    label: 'P1 env cookie',
    find: "const defaultCookie: string = '';",
    replace: `// ${MARK} P1 启动时从 env 读取 cookie（热更新走 QQ_COOKIE_FILE）\nconst defaultCookie: string = process.env.QQ_COOKIE || '';`,
  },
]);

// P2：仅监听 127.0.0.1
patchFile('src/app.ts', [
  {
    label: 'P2 bind localhost',
    find: 'app.listen(serverConfig.port, () => {',
    replace: `// ${MARK} P2 仅监听本机，与"仅本机自用"的部署前提一致（可用 QQ_BIND_HOST 覆盖）\n  app.listen(serverConfig.port, process.env.QQ_BIND_HOST || '127.0.0.1', () => {`,
  },
]);

// P4：注入 Cookie 头
patchFile('src/util/request.ts', [
  {
    label: 'P4 inject cookie header',
    find: '  return axios(requestConfigOptions).then(',
    replace: `  // ${MARK} P4 注入 Cookie 头：上游原实现从不发送 cookie，导致手填 cookie 无效
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getQqCookie } = require('./qq-cookie') as { getQqCookie: () => string };
    const ck = getQqCookie();
    if (ck) {
      requestConfigOptions.headers = Object.assign({}, requestConfigOptions.headers, { Cookie: ck });
    }
  } catch {
    /* 拿不到 cookie 时保持匿名请求 */
  }

  return axios(requestConfigOptions).then(`,
  },
]);

// P5：uin 热解析
patchFile('src/controllers/getMusicPlay.ts', [
  {
    label: 'P5 dynamic uin',
    find: "  const uin = userInfo.uin || '0';",
    replace: `  // ${MARK} P5 uin 从 cookie 热解析，否则 vkey 请求始终是匿名身份
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getQqCookie: _gq, parseQqUin: _pu } = require('../util/qq-cookie') as {
    getQqCookie: () => string;
    parseQqUin: (c: string) => string;
  };
  const uin = _pu(_gq()) || userInfo.uin || '0';`,
  },
]);

// P6：搜索上游修复
patchFile('src/services/search/getSearchByKey.ts', [
  {
    label: 'P6 fix search upstream',
    find: "const upstream = '/soso/fcgi-bin/client_search_cp';",
    replace: `// ${MARK} P6 原 client_search_cp 已失效（实测返回 500/0 字节），改用仍可用的 search_for_qq_cp\nconst upstream = '/soso/fcgi-bin/search_for_qq_cp';`,
  },
]);

console.log(results.map((r) => `  ${r}`).join('\n'));

// 完成标记：scripts/dev-all.mjs 用它判断 QQ 后端是否已具备 cookie 转发与可用搜索
const unmatched = results.filter((r) => r.startsWith('⚠'));
fs.writeFileSync(
  path.join(QQ, '.webmuic-patched'),
  [
    `patchedAt=${new Date().toISOString()}`,
    'patches=P1,P2,P3,P4,P5,P6',
    `unmatched=${unmatched.length}`,
    '',
  ].join('\n'),
);

if (unmatched.length > 0) {
  console.log('\n⚠ 有补丁未匹配，上游代码可能已更新，请人工核对后再启动。');
} else {
  console.log('\n补丁处理完成。');
}