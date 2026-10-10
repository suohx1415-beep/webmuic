# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述与核心约束

webmuic 是本机自用的现代 WebUI 音乐播放器，基于 pnpm monorepo，聚合网易云音乐与 QQ 音乐。

- **安全边界**：所有进程（网易云 3010、QQ 3200、网关 8787、前端 5173）**默认且必须仅绑定 `127.0.0.1`**。
- **凭证隔离**：平台 Cookie 仅由网关在本地内存或本地文件持有，**严禁下发给前端**；对外仅暴露前 8 位 SHA256 指纹。
- **环境要求**：Node 20（见 `.nvmrc`）。若系统 Node 版本较高，`dev-all.mjs` 会优先选用 `.tools/node20/`。

---

## 常用开发命令

根 `package.json` scripts 即入口（`bootstrap` 会顺带给 QQ 后端打补丁；`dev` 按 netease → qq → gateway → web 顺序启动并等待就绪）。

```bash
# 单独启动调试各模块
cd apps/gateway && pnpm dev      # 启动网关 (tsx watch)
cd apps/web && pnpm dev          # 启动前端 (Vite)
```

### 类型检查与构建

```bash
pnpm typecheck                   # 递归检查所有包类型 (gateway: tsc, web: vue-tsc)
pnpm --filter @webmuic/web build # 打包前端静态资源
```

### 运行测试 (Vitest)

```bash
pnpm test                        # 运行全部测试 (gateway + web)
pnpm --filter @webmuic/gateway test # 仅运行网关单元测试
pnpm --filter @webmuic/web test     # 仅运行前端单元测试

# 运行单个测试文件
pnpm --filter @webmuic/gateway exec vitest run test/adapters.test.ts
pnpm --filter @webmuic/web exec vitest run test/player.test.ts

# 运行匹配名称的单个测试用例
pnpm --filter @webmuic/gateway exec vitest run -t "TokenBucket"
```

---

## 系统架构与模块职责

请求链路：浏览器 → Vite `/api` 代理 → 网关 → 网易云 / QQ 后端（拓扑图见 `README.md`）。

### 1. `apps/gateway`（网关层）
- **路由入口**：`src/server.ts`、`src/app.ts`，路由模块化挂载于 `src/routes/`。
- **数据统一契约**：在 `src/types.ts` 定义核心模型（`Track`, `Playlist`, `Artist`, `Album`）。
  - 曲目 ID 格式统一规范为 `${platform}:${platformTrackId}`（如 `netease:2652820720`、`qq:0039MnYb0qxYhV`）。
  - 音质档位抽象为 `standard` / `high` / `lossless` / `hires`，适配器内部映射到各平台上游参数。
- **适配器抽象**：`src/adapters/` 分别处理网易云与 QQ 的响应差异与异常归一化，支持聚合搜索交替穿插（`searchAll`）与单平台降级。
- **配置集中**：`src/config.ts` 汇总端口/上游地址（可由 `GATEWAY_HOST`、`GATEWAY_PORT`、`NETEASE_BASE`、`QQ_BASE` 覆盖）、凭证文件路径与限速参数 `limits`。
- **凭证管理**：`src/credentials.ts`。真实凭证持久化在 `apps/gateway/.env.local`（权限 600，已 gitignore，测试可用 `WEBMUIC_ENV_FILE` 覆盖）；网易云注入 query 参数；QQ 则将 cookie 写入 `apps/gateway/.qq-cookie.txt`（`WEBMUIC_QQ_COOKIE_FILE` 可覆盖）供 QQ 后端热读取。
- **限速与熔断**：`src/limiter.ts` 提供令牌桶与 `SingleFlight`（合并并发相同请求）；上游连续异常 5 次后进入 3 分钟冷却（见 `limits.cooldownThreshold`/`cooldownMs`）。
- **播放地址解析**：`src/resolver.ts` 以 `TtlCache`（`src/cache.ts`，LRU + TTL，进程内存态）缓存播放 URL，TTL 封顶 30 分钟；音质按 `QUALITY_LADDER`（hires → lossless → high → standard）定义，上游 403 时 `invalidateResolved` 清该曲全部档位缓存后重解析。
- **音频流代理**：`src/routes/stream.ts` 代理两平台音频 CDN（host 白名单校验，仅透传 Range/Content-* 等播放相关响应头），前端永远拿不到 CDN 直链或 cookie；同源代理也是前端 Web Audio 均衡器能工作的前提（见下）。

### 2. `apps/web`（前端 WebUI）
- **技术栈**：Vue 3 Composition API + Pinia + Vue Router + 原生 CSS（不使用大型 UI 库）。
- **播放核心**：`src/stores/player.ts` 配合 `src/composables/useAudio.ts` 驱动 HTML5 Audio 播放、歌曲切换、高潮/副歌定位与播放列表管理。
- **音效链**：`useAudio.ts` 创建单例 `<audio>`（`crossOrigin='anonymous'`）并交给 `src/composables/useAudioEngine.ts` 接入 Web Audio（9 段 peaking EQ + 低音增强）；参数由 `src/stores/audioFx.ts` 管理。`createMediaElementSource` 对同一元素只能调用一次，且非同源/无 CORS 的音源会被静音——因此音频必须走网关 `/api` 代理。
- **离线缓存**：`src/offlineStorage.ts` 用 IndexedDB（`webmuic_offline_db`）存歌曲 Blob；`useAudio.ts` 播放前优先命中离线缓存。
- **持久化**：除离线音频外，前端状态只经 `src/storage.ts` 写 localStorage（键前缀 `webmuic:`），凭证类信息绝不落到前端。
- **歌词引擎**：`src/components/LyricDrawer.vue` 毫秒级歌词同步、滚动与逐句点击快进。
- **请求入口**：前端统一调用同源 `/api`（`src/api/client.ts`），Vite 将其代理到网关（`GATEWAY_BASE` 可覆盖），Range 头原样透传。

### 3. `services/qq`（QQ 音乐后端补丁机制）
上游 `Rain120/qq-music-api` 需依赖 `scripts/patch-qq-backend.mjs` 打入 6 处补丁：
- P1/P2：强制只绑定 `127.0.0.1`，支持环境变量读取。
- P3/P4：新增 `src/util/qq-cookie.ts` 热读取本地 cookie 文件，并在 `request.ts` 中向上游补充 Cookie 请求头。
- P5/P6：uin 从 cookie 动态提取；将失效的 `client_search_cp` 接口替换为 `search_for_qq_cp`。
- 打补丁完成后会生成 `services/qq/.webmuic-patched` 标记。
