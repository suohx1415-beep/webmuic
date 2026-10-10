# webmuic 运行手册

本机自用的 WebUI 音乐播放器，聚合网易云音乐与 QQ 音乐。所有进程只绑定 `127.0.0.1`，凭证只存在本机。

## 架构

```
浏览器 http://127.0.0.1:5173
   │  同源 /api（Vite 代理）
   ▼
网关 http://127.0.0.1:8787        ← 持有凭证、归一化响应、限速缓存、音频代理
   ├── 网易云后端 http://127.0.0.1:3010   NeteaseCloudMusicApi@4.32.0（MIT）
   └── QQ 后端    http://127.0.0.1:3200   Rain120/qq-music-api（next 分支，已打补丁）
```

网关存在的三个理由：

1. **平台凭证绝不下发到浏览器**——网易云的 cookie 由网关逐请求注入（`cookie` 查询参数），QQ 的 cookie 由网关写到热读取文件里。
2. **QQ 的音频 CDN 需要代理**——统一错误处理，且把平台 CDN 地址藏在网关后面。
3. **两个后端返回结构不同**——在适配器里归一化成同一套 `Track`。

## 环境要求

- **Node 20**。本机系统 Node 是 26，因此项目内置了一份 Node 20.20.2 在 `.tools/node20/`，`scripts/dev-all.mjs` 会优先使用它。
- 不需要 Docker、数据库、npm 全局包。
- `.nvmrc` 写了 `20.20.2`；如果用 nvm/fnm，直接 `nvm use` 也可以。

## 首次准备

```bash
cd <仓库根目录>

# 1. 依赖（workspace 一把装完：gateway / web / services/netease）
pnpm install

# 2. 网易云后端依赖
cd services/netease && pnpm install && cd ../..

# 3. QQ 后端：clone + 打补丁（补丁必须打，理由见下）
git clone -b next https://github.com/Rain120/qq-music-api.git services/qq
cd services/qq && npm install && cd ../..
node scripts/patch-qq-backend.mjs
```

### Windows 移植版（仅需 Node.js + npm）

若在 Windows 下使用，系统仅有 Node.js 与 npm（无需装 pnpm）：
1. **双击 `install-windows.bat`**（或命令行运行 `npm run bootstrap`）：
   - 自动通过 `npx pnpm` 一键安装所有依赖并自动打好补丁。
2. **双击 `start-windows.bat`**（或命令行运行 `npm start`）：
   - 一键拉起 4 个微服务并自动在浏览器中打开 `http://127.0.0.1:5173`。
   - 控制台内按 `Ctrl + C` 会自动调用 `taskkill /T /F` 强制终止全部子孙进程，避免 Windows 下端口死锁。

### 为什么 QQ 后端必须打补丁

Phase 0 实测（2026-09）发现上游原始实现无法满足本项目前提：

| 补丁 | 文件 | 原因 |
| --- | --- | --- |
| P1 | `src/config/default.ts` | 启动时从 `QQ_COOKIE` 读 cookie |
| P2 | `src/app.ts` | 原来 `listen(port)` 不带 host，会绑 `0.0.0.0`，与「仅本机」冲突 |
| P3 | `src/util/qq-cookie.ts`（新增） | 从 `QQ_COOKIE_FILE` 热读取 cookie（1s 缓存），换 cookie 不用重启 |
| P4 | `src/util/request.ts` | **上游从不向上游发 Cookie 头**，手填 cookie 在原始实现下完全无效 |
| P5 | `src/controllers/getMusicPlay.ts` | `uin` 改为从 cookie 热解析（原来硬编码 `userInfo.uin \|\| '0'`） |
| P6 | `src/services/search/getSearchByKey.ts` | 原 `client_search_cp` 对所有请求返回 500/0 字节，换成仍可用的 `search_for_qq_cp` |

补丁脚本幂等，可重复执行；执行后会写 `services/qq/.webmuic-patched` 标记。

> 许可证说明：该仓库 README 正文写「不可做商业用途」，License 章节写 MIT。本项目按「仅本机个人使用、不二次分发」处理。

## 日常启动

```bash
cd <仓库根目录>
node scripts/dev-all.mjs
```

按顺序拉起 netease(3010) → qq(3200) → gateway(8787) → web(5173)，每步都会等端口真正就绪。
启动前会检查端口占用与前置条件（补丁标记、`.env.local`）。
日志写在 `.logs/<name>.log`；`WEBMUIC_VERBOSE=1` 可同时打印到终端。`Ctrl+C` 会停掉全部子进程。

也可以单独启动某一块（调试时更常用）：

```bash
# 网易云后端
cd services/netease && PORT=3010 HOST=127.0.0.1 ../../.tools/node20/bin/node node_modules/NeteaseCloudMusicApi/app.js

# QQ 后端
cd services/qq && PORT=3200 QQ_COOKIE_FILE="$PWD/../../apps/gateway/.qq-cookie.txt" \
  ../../.tools/node20/bin/node -r ts-node/register/transpile-only src/app.ts

# 网关
cd apps/gateway && ../../.tools/node20/bin/node node_modules/tsx/dist/cli.mjs src/server.ts

# 前端
cd apps/web && ../../.tools/node20/bin/node node_modules/vite/bin/vite.js
```

## 凭证

凭证只存在 `apps/gateway/.env.local`（权限 600，已被 `.gitignore` 忽略），文件不存在时以匿名身份运行。

### 网易云（扫码，推荐）

前端「设置」页 →「网易云登录（扫码）」→ 生成二维码 → 用网易云 App 扫码。

实现要点：上游把 cookie 放在 `/login/qr/check` 的**响应体** `cookie` 字段里（不是 `Set-Cookie`），网关在服务端接住并落盘；未确认时的临时 cookie（`NMTID` 等）会被丢弃。

### QQ（扫码登录与手填备用）

前端「设置」页 →「QQ 音乐扫码登录」→ 支持手机 QQ 扫码与微信 App 扫码双通道登录。

- 扫码成功后由本地网关自动在服务端提取会话 Cookie 并安全落盘，前端不接触明文。
- 同时保留「手动填入 Cookie (备用)」面板，可手动贴入 `y.qq.com` 开发者工具中的 Cookie。
- 网关写到 `apps/gateway/.qq-cookie.txt`，QQ 后端热读取，**不用重启**。

### 也可以直接改文件

```bash
cat > apps/gateway/.env.local <<'EOF'
NETEASE_COOKIE=MUSIC_U=...; __csrf=...
QQ_COOKIE=uin=o...; qm_keyst=...; qqmusic_key=...
EOF
chmod 600 apps/gateway/.env.local
```

改完重启网关即可（QQ 侧因为热读取，其实不用重启 QQ 后端）。

## 验收冒烟

四个进程都跑起来后：

```bash
node scripts/smoke.mjs
```

逐条核验验收标准：端口可达、跨平台搜索、两平台播放地址与 Range、凭证不回显、410 提示、平台故障降级、歌词/歌单、前端 `/api` 代理指向网关。

想看某个平台「后端挂了会怎样」，停掉对应后端再跑一次即可——脚本会自动走降级分支。

## 排查手册

| 现象 | 排查 |
| --- | --- |
| 前端能开但列表一直空 | `node scripts/smoke.mjs` 看是哪个环节；再 `curl http://127.0.0.1:8787/api/health` |
| 某平台搜索无结果 | 该平台后端是否在监听；`node scripts/dump-routes.mjs` 看上游真实路由名 |
| 歌曲点了没声音 | 前端会给出提示。若为 410，看是「未配置凭证」还是「凭证可能失效」 |
| 会员曲一律 410 | 正常：匿名身份拿不到会员曲。配 cookie 后重试 |
| 网易云请求无损却提示已降级 | 正常：匿名身份会被平台降到 320k，网关如实回报实际档位 |
| 拖动进度条无声 | 检查网关 `/api/stream` 是否返回 206（`curl -H 'Range: bytes=0-1023' -D-`） |
| QQ 歌单打开报 404 | 该歌单对匿名身份不可见（上游 `check privacy error!`），换一个公开歌单 |
| 端口被占用 | `ss -ltnp \| grep <端口>` 找 PID，别用 `pkill -f`（会匹配到自己的命令行） |
| 网关提示平台冷却 | 连续 5 次上游异常触发 3 分钟冷却，等一会儿或重启网关 |
| 换 cookie 后没生效 | 网易云要看网关是否重启；QQ 侧是热读取，1 秒内生效 |

### 上游接口的坑（都踩过，务必记住）

1. **QQ 后端所有控制器读 `ctx.query`**，即使路由声明了 `/:xxx?` 路径参数也一样。调用一律用 query 形式（`/getLyric?songmid=...`，不是 `/getLyric/...`）。
2. **QQ 的 `getSongListDetail` 匿名可见性不稳定**，部分歌单返回 `check privacy error!`；推荐逻辑会往后找若干候选歌单。
3. **QQ 搜索字段是「平铺」的**（`songmid`/`songname`/`size128`），而详情与歌单是 `track_info` 结构（`mid`/`name`/`file.size_128mp3`），适配器里是两套归一化。
4. **QQ 的 `interval` 单位是秒**，网易云的 `dt` 是毫秒。
5. **QQ 播放地址的 `mediaId`** 是实际文件名 mid，可能不等于 `songmid`；不过实测对会员曲没有帮助（匿名就是拿不到）。
6. **网易云 `song/url/v1` 的 `level` 参数自带降级**，要用响应里的 `level` 反推实际档位，别以为请求什么就拿到什么。
7. **`services/qq/src/routes/router.ts` 的 `getLyric`/`getSongInfo`/`getSongListDetail`/`getMusicPlay` 全是 query 参数**——这是第 1 条的重复强调，因为它骗过我两次。

## 已知限制（如实记录）

- **QQ 匿名只能播非会员曲**。周杰伦等原版曲目基本是会员曲，匿名会返回 410；Demo/翻唱/现场等版本通常可播。要听原版必须配 cookie。
- **`quality=320` 匿名不可得**，网关会降到 128 并把降级原因回给前端。
- **QQ CDN 实测不强制 Referer**，与最初预期不同；代理仍然保留（隐藏 CDN 地址、统一错误处理）。
- **QQ 没有匿名的「每日推荐」**，「发现」页里它的分组是公开热歌歌单，界面上如实标注了来源。
- **网易云无损 / Hi-Res 需要会员**，匿名请求会被降到 320k（网关会回报实际档位）。
- **QQ 登录通过 ptqrlogin / wx_qrconnect 实现**，凭证经网关本地持久化，无需修改上游只读代码。
- **不做** `.mflac`/`.mgg` 解密、不接入 UnblockNeteaseMusic、不做服务端持久化、不做 Electron 打包/Docker 生产镜像。
- 限速是**本地**的（网易云 3 req/s、QQ 2 req/s，带排队），只能减少触发风控的概率，不能保证平台不风控。

## 目录结构

```
apps/gateway/           网关（Express + TS）
  src/adapters/         两个平台的适配器（归一化 + 播放地址解析）
  src/routes/           HTTP 路由
  src/{cache,limiter,credentials,upstream,resolver,errors,http}.ts
  test/                 66 项单测（vitest）
  .env.local            凭证（600，ignored）
  .qq-cookie.txt        QQ 后端热读取文件（ignored）
apps/web/               前端（Vue 3 + Vite + Pinia）
  src/api/              网关客户端与契约类型
  src/stores/           settings / player / favorites / auth
  src/composables/      useAudio（媒体元素与 store 的桥接）
  src/components/       TrackList / PlayerBar / QueueDrawer / LyricDrawer
  src/views/            Search / Discover / Playlist / Favorites / Settings
services/netease/       网易云后端依赖与启动目录
services/qq/            QQ 后端（独立 clone，已被 .gitignore 忽略）
scripts/                dev-all / smoke / dump-routes / patch-qq-backend
docs/                   runbook.md（本文） / api-contract.md
.tools/node20/          项目内 Node 20.20.2（ignored）
.logs/                  dev-all 的进程日志（ignored）
```

## 测试

```bash
pnpm test                                  # 网关单测（vitest）
cd apps/gateway && pnpm typecheck          # 网关类型检查
cd apps/web && pnpm typecheck              # 前端类型检查（vue-tsc）
cd apps/web && pnpm build                  # 前端生产构建
```
