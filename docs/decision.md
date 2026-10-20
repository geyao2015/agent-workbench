# 项目决策记录

最后更新：2026-10-20

本文件是决策、理由与阶段规划的唯一来源。产品定位与功能范围见 [README.md](../README.md)；协议契约见 [protocol.md](protocol.md)。

## 1. 架构与协议决策

- **两个场景，不合并界面**：Chat 与 Release 共享 runtime、协议和组件，但保持独立界面。理由：Chat 是渲染能力主展示面，Release 是结构化执行面，合并会同时牺牲两者。
- **Chat 保持 Agent 属性**：保留工具循环、会话记忆和多步任务；不得退化为纯 RAG 问答链。
- **协议优先**：先定义 append-only `AgentEvent` v1（`runId / messageId / blockId / toolCallId / seq`），再做 UI；M0 起草、M1 用 fixture 验证、M2 接入真实后端后冻结 v1，后续只做加法。
- **Mock 是事件 fixture 回放器**，不是"关键词 → 假文本"；快捷选项对应完整事件序列。
- **transport 统一抽象**为 `AsyncIterable<AgentEvent>`；mock 与真实 SSE 共用同一个 reducer。
- **领域事件与 telemetry 分离**：`AgentEvent` 驱动 UI；`Span`（OTel 风格）进 trace store，通过 `runId / spanId / toolCallId` 关联，不混入事件流。
- **单一状态源**：run 的事件日志是唯一状态源；聊天、Release 工作台、Trace 都是它的投影。
- **Release UI 是事件投影**：阶段视图由事件驱动，不能硬编码流程。
- **确定性优先**：发版步骤尽量是确定性工作流；LLM 只用于冲突解决、文案生成、风险摘要等有边界任务。
- **不做通用平台**：共享协议、transport、组件即可，不为复用做通用 Agent / 知识库 / 日志平台抽象。
- **前端先行**：M0–M1 在 mock/fixture 上完成渲染层；M2 只替换 transport 和 runtime，不重写 UI。

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
| 样式 | 待定 | 待确认 |
| 部署 | M0 先本地运行；部署形态与平台待定 | 待确认 |

- M0 运行方式：单个 Hono 进程在本地同时服务 web 静态资源和 API；不引入部署平台。
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
- 运行追踪：Trace 瀑布、Events 原始事件流、回放、token / 耗时 / 成本。
- 不建日志平台；小规模合成语料 + 本地索引 + SQLite FTS / 内存即可。

## 5. 信息架构

- 顶层导航：Chat / Releases，不设第三个业务 tab。
- Release run 详情：Overview / Logs / Diff / Trace / Events / Audit。
- Chat：日志与检索结果以工具卡片内联展示；调试时打开 Trace/Events 抽屉。
- 可选后期增加顶层 Log Explorer，用于跨 run 搜索和"让 Agent 分析"。

## 6. Release 场景决策

- 使用本地玩具仓库 + 模拟 CI。理由：作品集不需要真实部署，同时避免真实凭证与环境风险；审批、审计、回滚仍可完整演示。
- LLM 只用于冲突解决、文案生成、风险摘要等有边界任务；其余步骤保持确定性工作流。
- 不使用前雇主的代码、数据、内部 prompt、架构图或系统名；独立重构 + 合成数据，注意 NDA。

## 7. 阶段与能力成长

按能力成长拆分，而不是按技术模块。每个阶段都是一条端到端纵切，结束时能演示、能更新简历、能回答面试追问。

### 阶段 A：Agent 前端

| 阶段 | 完成后具备的能力 | 可演示交付 | 简历 / 面试可讲 | 时间盒 |
| --- | --- | --- | --- | --- |
| M0 可运行的流式 Chat 地基 | 能搭可运行的流式 Agent 前端骨架 | 本地单 URL mock 聊天：SSE、事件协议、fixture 回放、reducer、基础 Markdown、快捷场景 | 事件协议、SSE、流式状态管理、从零搭建 | 1.5–2 周 |
| M1 Agent 渲染层深挖 | 能独立开发 Agent 项目的渲染与交互层 | 增量 Markdown、工具调用/审批状态、reasoning、引用、长会话虚拟化、性能基准 | 块级增量渲染、10k 块长会话、工具状态机、渲染次数优化 | 约 3 周 |

### 阶段 B：完整 Agent

| 阶段 | 完成后具备的能力 | 可演示交付 | 简历 / 面试可讲 | 时间盒 |
| --- | --- | --- | --- | --- |
| M2 Chat Agent 全栈 | 能开发完整的 Chat Agent（前后端） | Hono + LangGraph、工具循环、记忆、知识库 RAG、引用、真实模型接入 | Agentic RAG、工具循环、checkpointer、SSE 全链路 | 约 3 周 |
| M3 Release Agent | 能开发完整垂直 Agent 项目 | 可审计发版工作台：阶段、冲突解决、diff 审批、审计、回滚、日志排查 | 确定性工作流 + 有边界 LLM + HITL + 审计 | 3–4 周 |
| M4 可观测性与评测 | 能调试、评测和运营 Agent | 日志根因分析、Trace 瀑布、事件回放、检索/RCA 评测、性能与成本报告 | Trace/调试、评测体系、量化指标、架构文档 | 2–3 周 |

### 关键约束

- M0–M1 全部基于 mock / fixture，不接真实模型。
- M2 只替换 transport 和 runtime，不重写渲染层。
- M0 先本地运行，部署平台待定，不纳入 M0 验收；部署后公开 demo 需标注 mock runtime。
- M0–M1 合计不超过 5 周；M1 结束必须能演示三个前端深挖点。
- 每个阶段退出条件：可运行、端到端场景、测试通过、1–3 个量化指标、README 更新、能回答 3 个面试追问。
- 协议在 M2 接入真实后端后冻结 v1。

## 8. 求职叙事

- 简历不要写"类 ChatGPT 应用"；写具体决策、难点和指标，且每条都能被追问三层。
- 阶段 A（M0–M1）结束可投 Agent 前端岗位；M2 后可投全栈 AI 应用；M3 后可投 Agent 工程师；M4 补上可观测性与评测。
- 公司经历如实写"参与发版 Agent、负责冲突解决"；side project 写"独立重构的简化版"。
- 要能回答：为什么不用 Next/Express、为什么事件与 telemetry 分离、如何评测检索和根因、流式渲染如何避免重渲染。
- 核心观点：不是所有 Agent 都该做成聊天框；Chat 是入口，结构化执行面负责高风险、可审计流程。

## 9. 待确认

- 样式 / UI 库方案（M0 开始前确认）。
- 部署形态与平台（M0 不阻塞，当前本地运行）。

## 10. 变更记录

| 日期 | 变更 | 理由 |
| --- | --- | --- |
| 2026-10-20 | v0 初稿：定位、架构、协议、范围、阶段 | 项目启动 |
| 2026-10-20 | 示例领域定为研发领域，不设公司品牌名，以服务名 + 事故编号为锚点 | 用户确认不需要公司名 |
| 2026-10-20 | 前端 React + Vite、后端 Hono + Node、pnpm、Vitest 按默认值确认 | 用户确认技术选型 |
| 2026-10-20 | M0 改为本地运行，部署平台暂缓，不纳入 M0 验收 | 用户决定先本地运行 |
| 2026-10-20 | 文档改为单一事实源：README 管产品事实、本文件管决策、AGENTS 管规则、protocol 管契约 | 消除重复与状态不一致 |
