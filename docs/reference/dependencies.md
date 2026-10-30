# 依赖清单

最后更新：2026-10-29

本文件记录各 workspace 的直接依赖与用途；版本为当前安装解析值，`package.json` 使用 `^` 范围。workspace 内部包 `@agent-workbench/protocol` 通过 `workspace:*` 引用，不计入三方依赖。

## 1. 前端 apps/web

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `react` / `react-dom` | 19.3.1 | UI 运行时 |
| `react-markdown` | 10.1.0 | Markdown → React 渲染 |
| `remark-gfm` | 4.0.1 | GFM 表格、删除线、任务列表 |
| `lucide-react` | 1.59.0 | 图标库 |
| `@tanstack/react-virtual` | 3.14.21 | 长会话行级虚拟化 |
| `@radix-ui/react-slot` | 1.5.0 | `asChild`，shadcn 风格 Button |
| `class-variance-authority` | 0.7.1 | Button 变体样式 |
| `clsx` | 2.1.1 | 类名拼接 |
| `tailwind-merge` | 3.7.0 | Tailwind 类名去重 |
| `tailwindcss` | 4.3.3 | 样式体系（dev） |
| `@tailwindcss/vite` | 4.3.3 | Tailwind Vite 插件（dev） |

shadcn/ui 不是 npm 依赖，而是复制组件源码的模式；当前只落地了 `Button`。

## 2. 后端 apps/api

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `hono` | 4.13.13 | HTTP 路由、中间件、SSE |
| `@hono/node-server` | 2.1.5 | Hono 的 Node 适配器 |
| `@langchain/langgraph` | 1.5.3 | Agent 状态图、checkpointer、消息流 |
| `@langchain/core` | 1.3.1 | ChatModel / Tool / Message 基础类型 |
| `@langchain/openai` | 1.8.0 | OpenAI 兼容模型（DeepSeek / Qwen / OpenAI） |
| `@langchain/anthropic` | 1.6.0 | Anthropic Claude 模型 |
| `zod` | 4.6.7 | 工具参数 schema 校验 |

## 3. 共享协议 packages/protocol

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `zod` | 4.6.7 | `AgentEvent` / fixture schema 校验 |

## 4. 构建、测试与工具链

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `typescript` | 7.0.2 | 全仓 strict 类型检查 |
| `vite` | 8.3.4 | 前端 dev server 与构建 |
| `@vitejs/plugin-react` | 6.1.2 | React Fast Refresh / JSX |
| `vitest` | 5.0.5 | 协议与 API 单测、性能基准 |
| `tsx` | 4.23.15 | API 开发运行与 watch |
| `@types/node` | 24.19.2 | Node 类型 |
| `@types/react` | 19.3.0 | React 类型 |
| `@types/react-dom` | 19.3.0 | React DOM 类型 |
| `@playwright/test` | 1.64.1 | UI 自动化与关键路径回归 |
| `pnpm` | 11.24.0 | workspace 包管理 |
| Node.js | >= 22 | 运行时 |

## 5. 当前刻意未引入

- 状态管理、路由、数据请求库：使用 React 内置能力与原生 `fetch`。
- 语法高亮库（Prism / Shiki / highlight.js）：代码块当前为纯文本。
- 完整 Radix / shadcn 组件集：按需逐个引入。
- ESLint / Prettier：暂未配置。
- 向量数据库与 embedding 服务：知识库检索使用自实现 BM25，离线可测。
