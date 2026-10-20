# 项目决策记录

最后更新：2026-10-20

本文件是决策与理由的唯一来源。产品定位与功能范围见 [README.md](../README.md)；执行阶段见 [plan.md](plan.md)；协议契约见 [protocol.md](protocol.md)。

## 1. 架构与协议决策

- **两个场景，不合并界面**：Chat 与 Release 共享 runtime、协议和组件，但保持独立界面。理由：Chat 是渲染能力主展示面，Release 是结构化执行面，合并会同时牺牲两者。
- **Chat 保持 Agent 属性**：保留工具循环、会话记忆和多步任务；不得退化为纯 RAG 问答链。
- **协议优先**：先定义 append-only `AgentEvent` v1（`runId / messageId / blockId / toolCallId / seq`），再做 UI；冻结与版本规则见 [protocol.md §9](protocol.md#9-版本与兼容)。
- **Mock 是事件 fixture 回放器**，不是"关键词 → 假文本"；快捷选项对应完整事件序列。
- **transport 统一抽象**为 `AsyncIterable<AgentEvent>`；mock 与真实 SSE 共用同一个 reducer。
- **领域事件与 telemetry 分离**：`AgentEvent` 驱动 UI；`Span`（OTel 风格）进 trace store，通过 `runId / spanId / toolCallId` 关联，不混入事件流。
- **单一状态源**：run 的事件日志是唯一状态源；聊天、Release 工作台、Trace 都是它的投影。
- **Release UI 是事件投影**：阶段视图由事件驱动，不能硬编码流程。
- **确定性优先**：发版步骤尽量是确定性工作流；LLM 只用于冲突解决、文案生成、风险摘要等有边界任务。
- **不做通用平台**：共享协议、transport、组件即可，不为复用做通用 Agent / 知识库 / 日志平台抽象。
- **前端先行**：M2 只替换 transport 和 runtime，不重写 M0–M1 完成的渲染层。

## 2. 技术选型与运行方式

| 层 | 选型 | 状态 |
| --- | --- | --- |
| 运行时 | Node 22+，ESM | 已确认 |
| 语言 | TypeScript strict | 已确认 |
| 包管理 | pnpm workspaces | 已确认 |
| 前端 | React + Vite + TypeScript | 已确认 |
| 后端 | Hono + Node（常驻进程，SSE） | 已确认 |
| Agent | LangGraph JS / LangChain v1 | 已定 |
| 协议 | append-only AgentEvent + Zod | 已定 |
| 测试 | Vitest；Playwright（后期 E2E） | 已确认 |
| 检索 | 本地索引 → SQLite FTS | 已定方向 |
| 存储 | 内存 / JSONL → SQLite FTS；checkpointer 先内存 | 已定方向 |
| 样式 | Tailwind CSS + shadcn/ui | 已确认 |

- M0 运行方式：单个 Hono 进程在本地同时服务 web 静态资源和 API；不引入部署平台。
- 开发期使用 Vite dev server（HMR），`/api` 代理到 Hono；构建后由 Hono 单进程托管 web 静态资源。
- 不选 Next.js 全栈作为主方案：serverless 对长连接、长任务、取消/恢复限制多；若用需自托管 Node。
- Express 只需达到"能读、能改、能解释区别"，不深研；Koa 不作为新项目选项。

## 3. 前端三个深挖点

1. 流式 Markdown：块级增量解析、稳定 blockId、闭合块冻结、未闭合 fence/表格/强调降级；避免每 token 全量 parse 和整树重渲染。
2. 长会话性能：块级虚拟化、闭合块 memo、按块订阅（`useSyncExternalStore`）、rAF 合并 token 增量；目标 10k 块稳定 60fps。
3. 工具调用与运行状态：半截 JSON 参数解析、工具状态机、reasoning 折叠、interrupt/审批 UI。

所有深挖点都要有可量化证据：渲染次数、帧率、首 token 延迟、内存。

## 4. 横向能力

### RAG

- 检索做成工具，Agent 决定何时查、查几次、是否改写 query。
- 必须支持引用、拒答、元数据过滤、检索评测和 trace 可见。
- 不设虚构公司品牌名，以服务名（主例 `checkout-service`）和事故编号（如 `INC-042`）作为语料锚点，保证文档、日志、发版记录可相互引用。
- 评测指标：recall@k、引用准确率、答案忠实度。

### 日志

- 业务日志：Agent 工具（`search_logs`、`get_log_context`、`group_errors`、`get_commit_diff`），输出根因 + 证据 + 修复建议，用合成故障集评测。
- 不建日志平台；小规模合成语料 + 本地索引 + SQLite FTS / 内存即可。

## 5. 信息架构

- 顶层导航：Chat / Releases，不设第三个业务 tab。
- Release run 详情：Overview / Logs / Diff / Trace / Events / Audit。
- Chat：日志与检索结果以工具卡片内联展示；调试时打开 Trace/Events 抽屉。
- 可选后期增加顶层 Log Explorer，用于跨 run 搜索和"让 Agent 分析"。

## 6. Release 场景决策

- Release 在模拟环境中执行。理由：作品集不需要真实环境，同时避免真实凭证与 NDA 风险；审批、审计、回滚仍可完整演示。
- 数据与合规要求见 [README.md §7](../README.md#7-非目标) 与 [§10](../README.md#10-数据与合规)。

## 7. 求职叙事

- 简历不要写"类 ChatGPT 应用"；写具体决策、难点和指标，且每条都能被追问三层。
- 阶段 A（M0–M1）结束可投 Agent 前端岗位；M2 后可投全栈 AI 应用；M3 后可投 Agent 工程师；M4 补上可观测性与评测。
- 公司经历如实写"参与发版 Agent、负责冲突解决"；side project 写"独立重构的简化版"。
- 要能回答：为什么不用 Next/Express、为什么事件与 telemetry 分离、如何评测检索和根因、流式渲染如何避免重渲染。
- 核心观点：不是所有 Agent 都该做成聊天框；Chat 是入口，结构化执行面负责高风险、可审计流程。

## 8. 待确认

- 部署形态与平台（M0 不阻塞，当前本地运行）。

## 9. 变更记录

| 日期 | 变更 | 理由 |
| --- | --- | --- |
| 2026-10-20 | v0 初稿：定位、架构、协议、范围、阶段 | 项目启动 |
| 2026-10-20 | 示例领域定为研发领域，不设公司品牌名，以服务名 + 事故编号为锚点 | 用户确认不需要公司名 |
| 2026-10-20 | 前端 React + Vite、后端 Hono + Node、pnpm、Vitest 按默认值确认 | 用户确认技术选型 |
| 2026-10-20 | M0 改为本地运行，部署平台暂缓，不纳入 M0 验收 | 用户决定先本地运行 |
| 2026-10-20 | 样式采用 Tailwind CSS + shadcn/ui；开发期 Vite 代理 `/api` 到 Hono，构建后单进程托管 | 启动 M0，确认样式待定项 |
