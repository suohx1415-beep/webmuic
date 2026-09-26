# AGENTS.md

本机自用的 WebUI 音乐播放器：聚合网易云音乐与 QQ 音乐（pnpm monorepo）。

## Setup commands

- Install deps: `pnpm install`（若需网易云服务：`cd services/netease && pnpm install`）
- Start dev:    `pnpm dev`（执行 `node scripts/dev-all.mjs`，一键拉起网关、web 与上游服务）
- Build:        `pnpm --filter @webmuic/web build`
- Test:         `pnpm test`（执行 `@webmuic/gateway` 的 Vitest 测试：`pnpm --filter @webmuic/gateway test`）
- Typecheck:    `pnpm typecheck`（递归检查：`pnpm -r typecheck`）
- Smoke test:   `pnpm smoke`（冒烟验证：`node scripts/smoke.mjs`）

## Project layout

- `apps/gateway/` — Node.js/Express 网关：持有凭证、归一化响应、限速缓存、音频代理
- `apps/web/` — Vue 3 + Vite + Pinia 前端 WebUI 播放器
- `services/netease/` — 网易云后端服务（NeteaseCloudMusicApi）
- `scripts/` — 开发调度、冒烟测试、路由转储与上游补丁脚本
- `docs/` — 运行手册（runbook.md）与 API 规范契约（api-contract.md）

## Code style

- Node 版本环境：推荐 Node 20（参考 `.nvmrc`，系统 Node 高版本时可使用内置 `.tools/node20/`）
- TypeScript 严格模式（`tsconfig.json`: `strict: true`）
- 模块规范：ES Module (`"type": "module"`)
- 提交前务必运行 `pnpm typecheck` 与 `pnpm test` 保证类型与测试通过

## Testing instructions

- 单元测试：`pnpm test`（使用 Vitest，主要覆盖网关适配器、凭证、限速及核心逻辑）
- 冒烟测试：`pnpm smoke`（验证端口可达性与基础链路）
- 新增功能需在对应测试目录（如 `apps/gateway/test/`）补充测试用例

## PR & commit conventions

- 基于 `main` 分支检出功能分支，请勿直接推送至主分支
- 提交信息遵循 Conventional Commits 规范（`feat:`, `fix:`, `docs:`, `refactor:`, `test:` 等）

## Security

- 绝不上报或提交敏感凭证：`.env`、`.env.local` 与 `apps/gateway/.qq-cookie.txt` 均被 `.gitignore` 忽略
- 架构安全约束：所有服务进程默认仅绑定 `127.0.0.1`，平台 Cookie 仅由网关在本机安全持有，绝不下发至浏览器前端
