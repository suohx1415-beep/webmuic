# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述与核心约束

webmuic 是本机自用的现代 WebUI 音乐播放器，基于 pnpm monorepo，聚合网易云音乐与 QQ 音乐。

- **安全边界**：所有进程（网易云 3010、QQ 3200、网关 8787、前端 5173）**默认且必须仅绑定 `127.0.0.1`**。
- **凭证隔离**：平台 Cookie 仅由网关在本地内存或本地文件持有，**严禁下发给前端**；对外仅暴露前 8 位 SHA256 指纹。
- **环境要求**：Node 20（见 `.nvmrc`）。若系统 Node 版本较高，`dev-all.mjs` 会优先选用 `.tools/node20/`。

---

## 常用开发命令

### 依赖安装与补丁

```bash
pnpm install                     # 安装 monorepo 依赖
pnpm bootstrap                   # 跨平台一键安装全量依赖并自动给 QQ 后端打补丁 (node scripts/install-all.mjs)
pnpm patch:qq                    # 重新执行 QQ 后端补丁 (node scripts/patch-qq-backend.mjs)
```

### 服务运行与调试

```bash
pnpm dev                         # 顺序启动 netease(3010) → qq(3200) → gateway(8787) → web(5173) 并等待就绪
pnpm start:open                  # 启动并自动在浏览器打开 http://127.0.0.1:5173
pnpm smoke                       # 运行链路冒烟测试 (node scripts/smoke.mjs)
pnpm routes                      # 打印网关注册的全部 API 路由 (node scripts/dump-routes.mjs)

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

```text
浏览器 WebUI: http://127.0.0.1:5173 (Vue 3 + Vite + Pinia)
      │
      ▼ (Vite /api 代理)
网关服务:   http://127.0.0.1:8787 (Express + TypeScript)
      ├── 网易云后端: http://127.0.0.1:3010 (NeteaseCloudMusicApi)
      └── QQ 音乐后端: http://127.0.0.1:3200 (Rain120/qq-music-api, 已打 6 项关键补丁)
```

### 1. `apps/gateway`（网关层）
- **路由入口**：`src/server.ts`、`src/app.ts`，路由模块化挂载于 `src/routes/`。
- **数据统一契约**：在 `src/types.ts` 定义核心模型（`Track`, `Playlist`, `Artist`, `Album`）。
  - 曲目 ID 格式统一规范为 `${platform}:${platformTrackId}`（如 `netease:2652820720`、`qq:0039MnYb0qxYhV`）。
  - 音质档位抽象为 `standard` / `high` / `lossless` / `hires`，适配器内部映射到各平台上游参数。
- **适配器抽象**：`src/adapters/` 分别处理网易云与 QQ 的响应差异与异常归一化，支持聚合搜索交替穿插（`searchAll`）与单平台降级。
- **凭证管理**：`src/credentials.ts`。网易云注入 query 参数；QQ 则将 cookie 写入本地 `apps/gateway/.qq-cookie.txt` 供 QQ 后端热读取。
- **限速与熔断**：`src/limiter.ts` 令牌桶限速，连续失败触发平台冷却（默认 3 分钟熔断）。
- **音频流代理**：`src/routes/stream.ts` 代理 QQ 音频 CDN，屏蔽外部直链防盗链及安全问题。

### 2. `apps/web`（前端 WebUI）
- **技术栈**：Vue 3 Composition API + Pinia + Vue Router + 原生 CSS（不使用大型 UI 库）。
- **播放核心**：`src/stores/player.ts` 配合 `src/composables/useAudio.ts` 驱动 HTML5 Audio 播放、歌曲切换、高潮/副歌定位与播放列表管理。
- **歌词引擎**：`src/components/LyricDrawer.vue` 毫秒级歌词同步、滚动与逐句点击快进。

### 3. `services/qq`（QQ 音乐后端补丁机制）
上游 `Rain120/qq-music-api` 需依赖 `scripts/patch-qq-backend.mjs` 打入 6 处补丁：
- P1/P2：强制只绑定 `127.0.0.1`，支持环境变量读取。
- P3/P4：新增 `src/util/qq-cookie.ts` 热读取本地 cookie 文件，并在 `request.ts` 中向上游补充 Cookie 请求头。
- P5/P6：uin 从 cookie 动态提取；将失效的 `client_search_cp` 接口替换为 `search_for_qq_cp`。
- 打补丁完成后会生成 `services/qq/.webmuic-patched` 标记。
