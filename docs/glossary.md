# 术语笔记

最后更新：2026-10-29

个人笔记，用于回顾概念和沟通用词；规范定义以 [protocol.md](protocol.md) 和 [decision.md](decision.md) 为准。

## 核心概念地图（边界 → 内容 → 状态 → 传播）

| 层 | 概念 | 一句话 |
| --- | --- | --- |
| 执行边界 | Thread / Run | 上下文边界与执行边界；记忆挂 thread，事件挂 run |
| 内容单元 | Message / Block / ToolCall / Stage / Approval / Artifact | 静态内容进 block，有生命周期或交互的进时间线行 |
| 状态模型 | AgentEvent / Reducer / 投影 | append-only 事件日志是唯一事实源，界面是它的投影 |
| 传播与验证 | Transport / Fixture / Span | mock 与 SSE 共用 reducer；fixture 是契约；Span 走独立通道 |

字段级定义见 [protocol.md §3–§8](protocol.md#3-事件信封)，渲染边界见 [rendering.md §2](rendering.md#2-工具与引用的渲染边界)。

## Thread 与 Run

- **Thread**：上下文边界。
- **Run**：一次可回放、可取消、可恢复的 Agent 执行。
- **Chat**：一个会话 = 一个 thread；一轮输入与回复 = 一个 run；多轮共享 thread。
- **Release**：一个发版任务 = 一个 thread；一次执行尝试 = 一个 run。
- 审批、暂停、断线恢复：不新建 run。
- 新会话 / 新发版任务：新 thread。
- 同一 thread 默认只有一个活跃 run；thread 没有显式结束事件，run 以 `run.completed` / `run.failed` 终结。
- Chat handoff 到 Release：用 `parentRunId` 关联来源，但 Release 使用自己的 thread。

## 消息与事件

- `user`：用户输入；`assistant`：Agent 输出文本。
- 工具调用、reasoning、审批不是消息角色，是独立的时间线行。
- `eventId`：全局唯一；事件日志统一用 `${runId}:${seq}`。
- `seq`：run 内递增，客户端按 seq 应用和去重；`runId` 是执行边界。

## Reducer

- 签名：`reduce(state, event) => newState`，状态机里的迁移函数。
- 事件日志是唯一状态源，reducer 把事件折叠成 UI 可用的状态；消息、工具卡、审批都是它的投影。
- 入口先过滤：run/thread 不符、`seq <= lastSeq`、`eventId` 已应用都原样返回；未知 type 只推进元信息。
- 只做不可变更新，不碰时钟、随机数、DOM 和网络；时间取自 `event.ts`。
- `text.delta` 有两条路径：带 `blockId` 直接追加且拒写已闭合块；不带则对未闭合尾块重新分段，已闭合前缀不动。
- mock fixture 与真实 SSE 共用它，所以换 transport、回放、单测都不需要改 reducer。
- 正式契约见 [protocol.md §5](protocol.md#5-reducer-契约)。

## Agent 应用最小概念

抛开框架与供应商，需要掌握的最小集是七组：

| 概念 | 本质 | 本仓库落点 |
| --- | --- | --- |
| Agent loop | 模型 → 工具 → 观察 → 再模型 | LangGraph 工具循环 |
| 执行与状态模型 | 会话/执行边界、事件日志、可回放可恢复 | Thread / Run、reducer |
| 流式一致性 | 增量到达、半截 JSON、乱序去重、取消与重连的终态 | `seq` / `eventId`、SSE |
| 工具与安全 | 不可逆操作审批；文档/日志不可信；不执行模型输出的 HTML/JSX | approval、防注入约定 |
| 上下文与检索 | 上下文预算、记忆分层、RAG 作为工具、引用与拒答 | BM25 检索工具 |
| 可观测性与评测 | trace、token/耗时/成本、离线 fixture、指标化评测 | Span、离线评测 |
| 确定性边界 | 高风险流程尽量确定性，LLM 只做有界任务 | Release 六阶段 |

Embedding、向量库、LangChain 的具体 API 是选型细节，不是核心概念；换掉它们不影响对系统的理解。必背五个词：**Run（执行边界）、Event（事实源）、Reducer（投影）、Tool 状态机（能力）、Approval / Trace（可控与可审计）**。

## 面试追问三层

模板：是什么 → 为什么 → 怎么量化/证明。其余概念套同一形状。

| 概念 | 是什么 | 为什么 | 怎么证明 |
| --- | --- | --- | --- |
| Run | 一次可回放、可取消、可恢复的执行 | 上下文与执行边界分开，审批和重连不新建 run | `seq` / `eventId` 去重；取消后有 `cancelled` 终态 |
| 事件日志 + reducer | append-only 事实源 + 纯函数投影 | 前端状态当事实源，回放、恢复、多端就会失真 | fixture 差分测试；mock 与 SSE 共用同一 reducer |
| 工具状态机 | 工具调用是有生命周期的状态，不是一次函数调用 | 参数半截到达、需要审批、失败后还能继续 | 半截 JSON 容错解析；状态迁移单测 |
| 审批 / HITL | 不可逆操作暂停，等人工决定 | 安全与可审计；前端不能自行放行 | 决定后追加 `approval_resolved` + `run.resumed`，客户端按 `lastEventId` 恢复 |
| 确定性边界 | 流程确定性，LLM 只做有界任务 | 可审计、可回滚、可解释 | Release 阶段视图由事件投影，不硬编码流程 |
| Trace / Span | 平台自身遥测，不进事件流 | 调试与成本分析不应污染模型上下文 | `runId` / `spanId` 关联；token、耗时、成本可查 |

## 命名

- 前缀：`run_` / `thread_` / `msg_` / `tc_` / `ap_` / `cit_` / `art_` / `reas_` / `evt_`。
- fixture ID 用「前缀_场景_序号」，保持静态、可回放。
