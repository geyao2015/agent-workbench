# Agent Workbench（研发 Agent 工作台）

> 从知识库对话到可审计发版。一个用于求职展示的研发 Agent 工作台：Chat 基于工程知识库对话，Release 执行可审计的发版流程。

**状态：核心链路已完成（Chat、Release、Trace 与离线评测；真实模型端到端待配置 Key）。** 技术选型与待确认项见 [docs/product/decision.md](docs/product/decision.md)；执行计划与待办见 [docs/product/plan.md](docs/product/plan.md)；事件协议见 [docs/architecture/protocol.md](docs/architecture/protocol.md)。

本文件是产品事实的唯一来源：项目定位、场景、演示流程、功能范围、非目标、当前状态、仓库结构与文档索引。

## 1. 项目是什么

一个产品、两个独立场景，共享同一套 Agent runtime、事件协议和通用能力，但**不合并界面**：

- **Chat**：研发/工程知识库对话，是前端能力的主展示面。覆盖流式渲染、增量 Markdown、长会话性能、异构内容、工具调用、RAG 引用等。
- **Release**：发版工作台，展示确定性工作流 + 有边界的 LLM（合并冲突解决）、人工审批、审计、回滚和可恢复执行。内部带上下文侧边 chat，复用同一套渲染组件。

Chat 可以通过 run 卡片 handoff 到 Release run，对话上下文不丢失。

一句话叙事：**一个研发 Agent 工作台，Chat 基于知识库对话，Release 执行可审计的发版流程。**

## 2. 项目目标

这个项目不是"ChatGPT 换皮"，而是用来展示三件事：

1. **前端工程深度**：流式 Markdown 增量渲染、长会话性能、工具调用状态机、异构内容与海量节点。
2. **Agent 工程能力**：工具循环、上下文工程、记忆、RAG、日志分析、human-in-the-loop、可观测性与评测。
3. **架构判断**：事件协议设计、领域事件与 telemetry 分离、确定性工作流与 LLM 的边界、范围控制。

## 3. 核心演示流程

1. 用户在 Chat 问："1.2.0 发版有哪些注意事项？" → Agent 检索发版规范和 runbook，带引用回答。
2. 用户说："帮我准备发版" → Chat 中插入 run 卡片，进入 Release 工作台。
3. Release 执行前置检查 → 发现合并冲突 → 冲突解决 Agent 给出方案和 diff → 人工审批。
4. 测试失败 → Agent 同时查日志、检索历史故障 runbook → 输出根因、证据和修复建议 → 审批后重跑。
5. Trace / Events 面板展示模型调用、工具调用、检索的耗时与 token；事件流可回放。

## 4. 架构总览

```mermaid
flowchart LR
  Web["apps/web<br/>前端"] -->|AgentEvent / SSE| API["apps/api<br/>后端"]
  API --> Runtime["Agent Runtime"]
  Runtime --> Tools["Tools<br/>KB / Logs / Git / CI"]
  Runtime --> State[("Checkpointer<br/>Store")]
  Runtime -->|AgentEvent| API
  Runtime -->|Span| Trace[("Trace Store")]
  API -->|Share| Protocol["packages/protocol<br/>共享协议包"]
  Web --> Protocol
```

关键设计决策见 [docs/product/decision.md §1](docs/product/decision.md#1-架构与协议决策)；技术选型与运行方式见 [docs/product/decision.md §2](docs/product/decision.md#2-技术选型与运行方式)。

## 5. 仓库结构

```
agent-workbench/
├── apps/
│   ├── web/              前端（React + Vite）
│   └── api/              后端（Hono + LangGraph）
├── packages/protocol/    共享协议包
├── e2e/                  Playwright UI 回归
├── fixtures/             Chat 事件 fixture；bench-* 由脚本生成
├── data/
│   ├── bench/            渲染基准数据集与结果
│   ├── docs/             合成工程文档（知识库）
│   ├── eval/             检索 / RCA / 答案评测集与日志
│   └── releases/         合成发版场景与玩具仓库
├── docs/                 product / architecture / quality / reference
├── scripts/              文档检查、fixture 生成、渲染基准
├── playwright.config.ts  E2E 配置
├── .env.example / .data/  环境变量示例；本地会话数据（gitignore）
├── AGENTS.md / CLAUDE.md  AI 规则与加载入口
└── README.md
```

## 6. 功能范围

### Chat

- 研发/工程知识库问答：研发规范、架构文档、API、runbook、故障复盘、发版规范。
- 多轮会话：同一 thread 累积多个 run，用户输入与回答都写入事件流。
- 检索是工具，Agent 决定何时查、查几次、是否改写 query。
- 回答带引用；资料不足时明确拒答。
- 保留工具、会话记忆和多步任务能力。

### Release

- 本地玩具仓库 + 模拟 CI，不接真实部署。
- 垂直链路：前置检查 → 冲突解决 Agent → diff 审批 → 测试 → release notes → dry-run tag → 审计 → 回滚。

### 日志与追踪

- 业务日志：Agent 通过工具查询、聚合、定位根因，输出证据和修复建议。
- 运行追踪：Trace 瀑布、Events 原始事件流、回放、token / 耗时 / 成本。
- 日志是横切能力：Chat 与 Release 各有入口，功能复用，作用域不同。

## 7. 非目标

- 不做真实 CI/CD 执行、Kubernetes 或多环境编排。
- 不做通用知识库平台、日志平台或 Agent 平台。
- 不新增第三个业务场景。
- 不使用前雇主的代码、数据、内部 prompt、架构图或系统名。
- 不在第一版实现权限体系、多租户、复杂文档接入。

## 8. 当前状态

**核心链路已完成**：Trace 瀑布、检索与 RCA 评测基线、文档元数据过滤、事件回放与评测报告均已落地；默认 mock，页面可全局切换实时 Agent。真实模型端到端评测与成本估算待配置 Key 和单价。

```bash
pnpm install
pnpm dev                    # Vite http://localhost:5173 + Hono http://localhost:8787
pnpm build && pnpm start    # 单 URL http://localhost:8787
pnpm test:e2e               # Playwright UI 回归（按需运行，使用本地 Chrome）
pnpm bench:streaming        # 流式渲染基准，结果写入 data/bench/results.json
```

默认使用 fixture mock 运行时；配置 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`（可配 `OPENAI_BASE_URL` / `OPENAI_MODEL`）后，可在页面 header 全局切换实时 Agent。环境变量示例见 [.env.example](.env.example)，知识库位于 `data/docs/`，会话数据写入本地 `.data/`；待办分组、验收标准与已知限制见 [docs/product/plan.md](docs/product/plan.md)。

## 9. 文档索引

- [docs/product/decision.md](docs/product/decision.md) — 技术选型、架构与范围决策、求职叙事、待确认项、变更记录
- [docs/product/plan.md](docs/product/plan.md) — 执行计划、待办分组、验收标准与已知限制
- [docs/product/showcase.md](docs/product/showcase.md) — 页面展示亮点与演示编排（待设计）
- [docs/architecture/agent-map.md](docs/architecture/agent-map.md) — Agent 应用难点分层、能力覆盖与推进顺序
- [docs/architecture/protocol.md](docs/architecture/protocol.md) — AgentEvent / Span 协议草案与 fixture 格式
- [docs/architecture/storage.md](docs/architecture/storage.md) — 数据分类、表结构、存储兼容与迁移顺序
- [docs/architecture/rendering.md](docs/architecture/rendering.md) — 渲染实现、增量分段与性能数据
- [docs/architecture/multimodal.md](docs/architecture/multimodal.md) — 语音输入、图片上传与识别的规划与安全边界
- [docs/quality/evaluation.md](docs/quality/evaluation.md) — 评测集、指标与基线
- [docs/reference/dependencies.md](docs/reference/dependencies.md) — 三方依赖、版本与用途
- [docs/reference/glossary.md](docs/reference/glossary.md) — 个人术语笔记（Thread / Run 等概念）
- [AGENTS.md](AGENTS.md) — AI 工作规则与文档来源约定
- [CLAUDE.md](CLAUDE.md) — Claude Code 加载入口

## 10. 数据与合规

- 所有示例数据均为合成数据。
- 文档与日志视为不可信输入，检索内容按数据分隔；实时 Agent 拒绝索要密钥/系统提示词，并对输出做密钥脱敏。
- 发版、回滚等不可逆操作必须人工审批。
