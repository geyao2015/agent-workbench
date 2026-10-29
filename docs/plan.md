# 执行计划

最后更新：2026-10-29

本文件是阶段划分、阶段状态、执行清单与验收标准的唯一来源。当前项目阶段摘要见 [README.md §8](../README.md#8-当前阶段)；技术选型与运行方式见 [decision.md §2](decision.md#2-技术选型与运行方式)；协议契约见 [protocol.md](protocol.md)。

阶段状态取值：`未开始` / `进行中` / `已完成`。状态变化时同步更新本文件的「最后更新」日期。

## 1. 阶段划分

按能力成长拆分，而不是按技术模块。每个阶段都是一条端到端纵切，结束时能演示、能更新简历、能回答面试追问。

### 阶段 A：Agent 前端

| 阶段 | 状态 | 完成后具备的能力 | 可演示交付 | 简历 / 面试可讲 | 时间盒 |
| --- | --- | --- | --- | --- | --- |
| M0 可运行的流式 Chat 地基 | 已完成 | 能搭可运行的流式 Agent 前端骨架 | 本地单 URL mock 聊天：SSE、事件协议、fixture 回放、reducer、基础 Markdown、快捷场景、事件检查器 | 事件协议、SSE、流式状态管理、从零搭建 | 1.5–2 周 |
| M1 Agent 渲染层深挖 | 已完成 | 能独立开发 Agent 项目的渲染与交互层 | 增量 Markdown、工具调用/审批状态、reasoning、引用、长会话虚拟化、性能基准 | 块级增量渲染、10k 块长会话、工具状态机、渲染次数优化 | 约 3 周 |

### 阶段 B：完整 Agent

| 阶段 | 状态 | 完成后具备的能力 | 可演示交付 | 简历 / 面试可讲 | 时间盒 |
| --- | --- | --- | --- | --- | --- |
| M2 Chat Agent 全栈 | 已完成 | 能开发完整的 Chat Agent（前后端） | Hono + LangGraph、工具循环、记忆、知识库 RAG、引用、历史会话列表（[加载方式](protocol.md#10-待定问题随阶段决定)）、真实模型接入 | Agentic RAG、工具循环、checkpointer、SSE 全链路 | 约 3 周 |
| M3 Release Agent | 已完成 | 能开发完整垂直 Agent 项目 | 可审计发版工作台：阶段、冲突解决、diff 审批、审计、回滚、日志排查、Chat handoff | 确定性工作流 + 有边界 LLM + HITL + 审计 | 3–4 周 |
| M4 可观测性与评测 | 已完成 | 能调试、评测和运营 Agent | Trace 瀑布、事件回放、检索元数据过滤、检索/RCA 评测、离线评测报告；真实模型端到端待 Key | Trace/调试、评测体系、量化指标、架构文档 | 2–3 周 |

## 2. 阶段约束与验收

- M0–M1 全部基于 mock / fixture，不接真实模型；部署后公开 demo 需标注 mock runtime。
- M0–M1 合计不超过 5 周；M1 结束必须能演示三个前端深挖点。
- 每个阶段退出条件：可运行、端到端场景、测试通过、1–3 个量化指标、README 更新、能回答 3 个面试追问。

## 3. M0 执行清单

开始前确认 [decision.md §8](decision.md#8-待确认) 的样式方案；部署平台不阻塞 M0。

1. 初始化 pnpm monorepo（结构见 [README.md §5](../README.md#5-仓库结构规划)）。
2. 实现 `AgentEvent` v1 类型 + Zod schema。
3. 定义 fixture JSONL 格式与回放器（`fixtures/`）。
4. 实现纯函数 reducer + 单测。
5. 实现 transport：mock fixture 回放 + SSE 适配，共用同一 `AgentEvent` 协议。
6. 搭聊天壳：输入框、消息列表、快捷场景、基础 Markdown、事件检查器。
7. 实现取消与断线重连语义。
8. 按 [decision.md §2](decision.md#2-技术选型与运行方式) 的运行方式，用单个后端进程在本地同时服务 web 静态资源和 API（mock 模式）。

M0 验收：

- 本地单 URL 能流式输出。
- 取消与断线重连不产生脏状态或重复事件。
- fixture / reducer 测试通过。
- typecheck 通过。

M0 之前不做 M1 及以后的内容。

## 4. 验收记录

| 阶段 | 结果与证据 |
| --- | --- |
| M2 | 流式 Chat、LangGraph 工具循环、BM25 RAG、历史快照；离线检索 3/3 top-1；真实模型需配 Key 验证 |
| M3 S1 | 确定性阶段、阶段审批、diff/audit artifact；headless 端到端；artifact 重启可读 |
| M3 S2 | 结构化输出冲突解决 + 确定性回退；假模型验证 llm/fallback；Diff 展示 rationale |
| M3 S3 | test.1 失败 → log_bundle → 日志工具/RCA → 修复审批 → test.2 重跑；Logs 页 |
| M3 S4 | 完成 run → 回滚 child run（parentRunId）→ 回滚审批 → 审计记录 mode/target/parent |
| M3 S5 | `prepare_release` handoff 卡片 → Release run（`sourceRunId`）；耗时 / 审批 / artifact 指标 |
| M4 | Trace 从事件派生；16 篇语料 + 50 题检索基线；10 个 RCA 案例；元数据过滤；离线评测报告 |

- 合计测试：protocol 62、API 62；`typecheck` / `build` / `check-docs` 全绿。
- 已知限制：运行中的 Chat / Release run 依赖内存 runtime，服务重启后不可恢复，pending approval 失效；已完成 run 与 artifact 仍可读。
- 安全：guard 拦截索要密钥/系统提示词/越狱输入，检索结果标记为不可信数据，输出做密钥脱敏。
- M4 已落地离线基线；真实模型端到端答案质量、引用准确率与成本估算待 Key/单价。

## 5. 跨阶段待办

- [x] 安全防护（已完成）：确定性 input guard、检索数据分隔、流式输出脱敏与三类测试；历史种子会过滤被拦截的用户输入。
- [x] 展示层 v1：首屏工程亮点卡、工程说明抽屉、guard 独立卡片与 Demo 入口已实现；盲测与落地页见 [showcase.md](showcase.md)。
- [x] 评测集构造：16 篇语料；`data/eval/retrieval.jsonl` 50 题（含无答案）；金标冻结，不用于调参。
- [x] RAG 检索评测：`pnpm eval:retrieval`，Recall@1/@4、MRR、Abstain。
- [ ] RAG 端到端评测：补 `goldAnswerPoints` / `goldEvidenceIds`；忠实度、引用准确率、答案正确性；需真实模型 + judge + 人工抽检。
- [x] RCA 评测集：10 个合成事故，证据定位与 runbook 检索；`pnpm eval:rca`。
- [ ] 成本与真实 provider 延迟：待配置 Key 与单价。
