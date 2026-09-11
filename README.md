# Aaas-Space

> **将文档、知识库、项目管理与 AI 赋能整合一体的轻量级团队协作空间。**

Aaas-Space 是一个前后端分离、契约驱动的轻量级一体化团队协作平台，将 **项目管理、文档知识库、在线表格、AI 赋能** 四个核心场景整合进同一个工作空间。面向个人 / 学校 / 中小团队，提供文档与项目管理的协作体验，用统一数据模型打通文档、项目、团队三个模块，并配套独立管理后台（platform）。

---

## 核心功能

### 用户端（apps/web）

- **工作台**：欢迎页、全局搜索、快捷新建（文档 / 表格 / Wiki / AI 助手）、最近文档（访问 / 创建 / 收藏）、我的待办与临近里程碑、项目进度总览。
- **文档**：富文本编辑器，支持 KaTeX 公式、Markdown、Word/PDF 导入、表格编辑、PDF 导出、模板中心、版本对比与回滚、评论与 @ 提及、反向链接、分享（只读 / 可编辑）。**上传文件** 批量解析，**上传给 AI** 自动分类整理为文件夹树（≤10 文件、可取消）。
- **在线表格**：单元格编辑、列 / 行拖拽列宽与高度、冻结行列、撤销重做、筛选。
- **知识库（Wiki）**：树形目录、子页面、重命名 / 移动 / 搜索、团队与个人知识库隔离、目录树增删改查。
- **权限管理**：文档 / 知识库 / 团队空间，文档支持可见范围（个人 / 团队 / 公开）、基础权限（可阅读 / 可编辑 / 可管理）及逐成员授权，`findDoc` 统一解析并返回有效权限，列表按权限过滤，子级继承父级。
- **项目管理**：项目仪表盘、任务看板（拖拽流转状态）、甘特图时间线、里程碑、需求 / 任务评论、待办视图，里程碑 / 需求 / 任务以多维表格展示并支持名称 + 时间筛选，覆盖需求、任务、里程碑全链路。
- **团队空间**：团队创建 / 成员管理、团队级文档与知识库。
- **回收站**：文档与项目软删除、恢复、彻底删除。
- **AI 助手**：写作、续写、润色、摘要、任务拆解，支持对选中文本或整篇文档处理并写入，SSE 流式渲染。
- **实时协同**（MVP）：基于 WebSocket 的房间广播、在线状态与内容实时同步。

### 管理端（apps/admin）

- 概览统计、用户管理、团队管理、文档管理、项目管理、评论审计，与用户端数据实时同步，支撑企业级治理与审计。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · Vite 8 · Tailwind CSS 4 · TanStack Query · React Router 7 · Lucide Icons |
| 文档解析 | marked · KaTeX · DOMpurify · mammoth(Word) · pdfjs-dist(PDF) · html2pdf |
| 后端 | Hono · @hono/node-ws（WebSocket） · zod-validator |
| 持久层 | Drizzle ORM · PostgreSQL（postgres.js 驱动） |
| 契约层 | @pulse-space/contracts（Zod Schema，前后端共享类型与校验） |
| AI | DashScope OpenAI 兼容接口 · 流式 SSE（默认模型 glm-5.2） |
| 测试 | Vitest（单测 · API in-memory · 契约） · Playwright（E2E，见 playwright.config.ts & e2e/） |
| 包管理 | pnpm 11 · Monorepo workspace |

---

## Monorepo 结构

```
.
├── apps/
│   ├── web/          # 用户端前端（端口 5183）
│   ├── admin/        # 管理端前端（端口 5184）
│   └── api/          # 后端 API（端口 3101）
├── packages/
│   └── contracts/    # 前后端共享契约（Zod Schema + TS 类型）
├── e2e/              # Playwright 端到端测试
├── infra/
│   └── postgres/     # PostgreSQL docker-compose（端口 5434）
├── playwright.config.ts
└── pnpm-workspace.yaml
```

---

## 快速开始

前置依赖：Node.js ≥ 24 · pnpm ≥ 11.9 · Docker（可选，用于本地数据库）。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 PostgreSQL（Docker）
pnpm db:up

# 3.（可选）配置后端环境变量
# 数据库等参数已有默认值（见 apps/api/src/config.ts），仅在使用 AI 功能时需配置 QWEN_API_KEY
# 可手动在 apps/api/.env 中填写 QWEN_API_KEY（.gitignore 已排除 .env）

# 4. 初始化数据库（建表 + 种子数据）
pnpm --filter @pulse-space/api db:migrate
pnpm --filter @pulse-space/api db:seed

# 5. 启动后端与用户端（管理端用 pnpm dev:admin）
pnpm dev:api     # http://localhost:3101
pnpm dev:web     # http://localhost:5183
```

### 常用脚本

```bash
pnpm dev                  # 并行启动全部应用
pnpm dev:web              # 仅用户端
pnpm dev:api              # 仅后端
pnpm typecheck            # 全量类型检查
pnpm test:e2e             # Playwright E2E
pnpm db:generate|migrate|seed   # Drizzle 迁移与种子
pnpm db:up|down           # 启停数据库
```

### 端口与环境变量

| 项 | 默认值 |
| --- | --- |
| Web 前端 | `http://localhost:5183` |
| Admin 管理端 | `http://localhost:5184` |
| API | `http://localhost:3101` |
| PostgreSQL | `localhost:5434`（`pulse_space / pulse_space`） |

`apps/api/.env` 关键变量（默认值见 `apps/api/src/config.ts`）：

```
DATABASE_URL=postgres://pulse_space:pulse_space@localhost:5434/pulse_space
WEB_ORIGIN=http://localhost:5183
ADMIN_ORIGIN=http://localhost:5184
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=<你的 API Key>
QWEN_MODEL=glm-5.2
```

---

## 架构与设计约定

- **前后端分离 + 契约驱动**：所有接口与数据结构以 `packages/contracts` 的 Zod Schema 为准，微信文档 / 用户端 / 管理端共享同一类型。
- **统一响应**：后端统一返回 `{ code, message, data, timestamp }`，全局异常处理，不裸返回堆栈。
- **实时协同**：`/api/ws/docs/:id` WebSocket 房间，保存驱动广播 + 在线状态（MVP 基于内存 Set）。

---

## 测试

- **单元 / API 测试**（Vitest）：见 `apps/*/src/**/*.test.ts`，覆盖核心逻辑、契约校验与 Hono in-memory 请求。
- **E2E 测试**（Playwright）：见 `e2e/`，覆盖登录、文档创建、知识库、项目管理、回收站、分享等关键用户旅程。

```bash
pnpm --filter @pulse-space/web test        # 用户端单测
pnpm --filter @pulse-space/api test        # 后端测试
pnpm test:e2e                              # E2E
```

---

## 文档

工程规范 / 开发流程见 `.trae/rules/pulse.md`（六大铁律：前后端成对交付、页面必有路由与跳转、接口必有映射、前后台同步更新、数据必落库、端到端验收）。

---

**Pulse-Space · 用一份产品数据打通文档、项目与团队协作。**
