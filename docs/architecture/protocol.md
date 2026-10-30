# Agent 事件协议（v1）

**状态：v1 已冻结（接入真实后端后）。冻结后只做加法：新增事件类型、可选字段与物化快照字段。**

本文档定义 Chat 与 Release 共用的 `AgentEvent` 协议、reducer 契约、fixture 格式、transport 接口，以及与之分离的 telemetry `Span` 模型。

## 1. 目标与非目标

目标：

- 一条 append-only 事件流驱动 Chat 和 Release 两个界面。
- 支持文本流、reasoning、工具调用（含半截 JSON 参数）、阶段、审批、artifact、错误、取消、恢复。
- 事件可回放、可重连、可测试；UI 状态由纯函数 reducer 派生。
- Mock fixture 与真实 SSE 使用同一协议、同一 reducer。

非目标：

- 不在事件流中传输完整的大 artifact（diff、日志包、文档全文）。
- 不把模型内部思考当作可展示内容；reasoning 是受控可选内容。
- 不定义持久化实现；内存、SQLite、Postgres 都可以承载事件日志。
- 不把 telemetry 混进 AgentEvent；Span 走独立通道。

## 2. 基本模型

- **Thread**：一段对话上下文，可包含多个 run。
- **Run**：一次 Agent 执行，`kind` 为 `chat` 或 `release`；事件按 run 隔离。
- **Message**：面向用户的文本消息；一条消息包含多个 Markdown block。
- **Block**：渲染单元，闭合后不可变。
- **ToolCall**：一次工具调用；参数可能流式到达，结果可能很长。
- **Stage**：Release run 中的确定性阶段。
- **Approval**：需要人工确认的动作。
- **Artifact**：diff、日志包、release notes 等大对象；事件只带元数据与引用。
- **Span**：telemetry，不属于 AgentEvent。

## 3. 事件信封

```ts
export type RunKind = "chat" | "release";

export interface AgentEvent<T = unknown> {
  v: 1;
  eventId: string;   // 全局唯一；SSE id / 去重
  seq: number;       // 每个 run 内从 1 单调递增
  runId: string;
  threadId: string;
  ts: number;        // epoch ms，由服务端产生
  type: AgentEventType;
  payload: T;
}
```

约束：

- `seq` 在单个 run 内严格递增，不跳号；客户端按 `seq` 应用。
- `eventId` 用于去重与断线重连，建议 ULID/UUID。
- 客户端忽略 `seq <= lastSeq` 的事件；重复投递必须无副作用。
- 同一 run 的事件顺序即语义顺序；不允许依赖到达时间。
- 未知 `type` 必须被忽略，不能导致 reducer 崩溃。

## 4. 事件类型

命名使用 `domain.action`。`payload` 均为可选字段友好的对象，新增字段不影响旧客户端。

### 4.1 生命周期

| type | payload | 说明 |
| --- | --- | --- |
| `run.started` | `{ kind, title?, parentRunId?, sourceRunId?, runtime? }` | run 开始；`sourceRunId` 用于 Chat handoff；`runtime` 快照 `mode / provider / model` |
| `run.paused` | `{ reason: "approval" \| "user", approvalId? }` | 等待审批或用户输入 |
| `run.resumed` | `{ fromSeq? }` | 恢复执行 |
| `run.completed` | `{ status: "done" \| "cancelled" \| "error", usage?: Usage }` | 终态；之后不再有事件 |
| `run.failed` | `{ code, message, retryable }` | 不可恢复错误；也可用 `run.completed` 的 error 状态 |

```ts
interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}
```

### 4.2 消息与文本

| type | payload | 说明 |
| --- | --- | --- |
| `message.started` | `{ messageId, role: "user" \| "assistant" }` | 新消息；用户输入也写入事件日志 |
| `text.delta` | `{ messageId, delta, blockId? }` | 追加文本；`blockId` 可选 |
| `text.block.completed` | `{ messageId, blockId }` | 显式闭合一个 block |
| `message.completed` | `{ messageId, stopReason? }` | 消息结束 |
| `reasoning.started` | `{ messageId, blockId? }` | 可选展示的推理块 |
| `reasoning.delta` | `{ messageId, delta, blockId? }` | 推理增量 |
| `reasoning.completed` | `{ messageId, blockId? }` | 推理结束 |
| `citation.added` | `{ messageId, citationId, sourceId, title?, locator? }` | 引用来源 |

Block 归属规则（默认）：

- 前端使用**确定性分段器**把消息文本切成 block，ID 为 `${messageId}:b${index}`。
- 已闭合 block 不可变；只增量解析当前开放 block。
- 若后端提供 `blockId`，以事件为准；同一条消息内不得混用两种模式。
- 分段规则必须是纯函数，保证 fixture 回放和多端一致。
- 用户输入以 `role: "user"` 的消息事件写入同一 run 的事件日志，先于 assistant 消息；prompt 不得只存在于前端状态。

### 4.3 工具调用

| type | payload | 说明 |
| --- | --- | --- |
| `tool.started` | `{ toolCallId, name }` | 模型提出工具调用 |
| `tool.args.delta` | `{ toolCallId, delta }` | 半截 JSON 字符串增量 |
| `tool.ready` | `{ toolCallId, args }` | 参数解析完成 |
| `tool.result` | `{ toolCallId, status: "success" \| "error", content, durationMs? }` | 工具结果 |
| `tool.approval_required` | `{ toolCallId, approvalId, title, description?, risk, args }` | 需要人工确认 |
| `tool.approval_resolved` | `{ toolCallId, approvalId, approved, note? }` | 审批结果 |

规则：

- `tool.args.delta` 只是字符串拼接；客户端可用 partial-json 解析，但非法状态必须可渲染。
- 工具结果可能很大：超过阈值时，`content` 只放摘要，完整内容作为 artifact。
- 工具错误不是 run 错误；`tool.result.status = "error"` 后 Agent 可以继续。
- 需要审批的工具在 `tool.ready` 后进入 `awaiting_approval`，不得先执行。

阶段级审批（Release）使用独立事件，不与工具审批混用：

| type | payload | 说明 |
| --- | --- | --- |
| `approval.required` | `{ approvalId, scope: "stage", stageId, title, description?, risk, args }` | 阶段 gate |
| `approval.resolved` | `{ approvalId, approved, note? }` | 阶段审批结果 |

阶段审批流程：`approval.required` → `run.paused { reason: "approval", approvalId }` → HTTP 决议 → `approval.resolved` → `run.resumed`。

### 4.4 Release 阶段与 artifact

| type | payload | 说明 |
| --- | --- | --- |
| `stage.started` | `{ stageId, name, kind? }` | 阶段开始 |
| `stage.completed` | `{ stageId, status: "success" \| "error" \| "skipped", summary? }` | 阶段结束 |
| `artifact.created` | `{ artifactId, kind, title, mime?, size?, uri?, stageId? }` | 大对象引用 |
| `artifact.updated` | `{ artifactId, patch? }` | 可选，仅用于小元数据 |

Artifact：

- `kind`：`diff`、`log_bundle`、`release_notes`、`plan`、`document`。
- 默认通过 `uri` / API 拉取内容，不放进事件流。
- 小于 8KB 的文本可选择内联到 `content`，但必须同时提供 `uri` 语义或版本。

### 4.5 错误

| type | payload | 说明 |
| --- | --- | --- |
| `error` | `{ code, message, retryable, scope? }` | 非致命错误，例如检索失败、单个工具失败 |
| `guard.blocked` | `{ category: "secret" \| "prompt" \| "jailbreak" }` | 输入被安全 guard 拦截，未进入模型 |

致命错误用 `run.failed`。`error` 事件只用于可恢复或可展示的局部错误。`guard.blocked` 在用户输入被拦截时先于拒答文本出现。

## 5. Reducer 契约

```ts
export function reduce(state: RunState, event: AgentEvent): RunState;
```

要求：

- **纯函数**：不读时钟、不读随机数、不访问 DOM/网络；时间来自 `event.ts`。
- **幂等**：同一事件重复应用结果不变。
- **顺序敏感**：按 `seq` 应用；`seq <= lastSeq` 直接忽略。
- **前向兼容**：未知 type 忽略；未知字段忽略。
- **不可变更新**：返回新对象；不在原 state 上就地修改。

状态形状（草案）：

```ts
interface RunState {
  runId: string;
  threadId: string;
  kind: RunKind;
  status: "idle" | "running" | "waiting_approval" | "paused"
        | "completed" | "failed" | "cancelled";
  lastSeq: number;
  appliedEventIds: Set<string>;

  messages: Record<string, MessageState>;
  messageOrder: string[];

  blocks: Record<string, BlockState>;
  toolCalls: Record<string, ToolCallState>;
  toolCallOrder: string[];

  stages: Record<string, StageState>;
  stageOrder: string[];

  approvals: Record<string, ApprovalState>;
  artifacts: Record<string, ArtifactState>;

  errors: Array<{
    code: string;
    message: string;
    seq: number;
    retryable: boolean;
    fatal: boolean;
  }>;

  guards: Array<{
    category: "secret" | "prompt" | "jailbreak";
    seq: number;
  }>;
}
```

关键状态：

```ts
interface CitationState {
  id: string;
  sourceId: string;
  title?: string;
  locator?: string;
}

interface ReasoningState {
  id: string;
  messageId: string;
  text: string;
  status: "streaming" | "completed";
  startedAtSeq: number;
}

interface MessageState {
  id: string;
  role: "user" | "assistant";
  status: "streaming" | "completed" | "error";
  text: string;
  blockIds: string[];
  citations: CitationState[];
  reasoning: ReasoningState[];
  startedAtSeq: number;
}

interface BlockState {
  id: string;
  messageId: string;
  index: number;
  raw: string;
  status: "open" | "closed";
  kind?: "paragraph" | "heading" | "list" | "code" | "table" | "blockquote";
}

interface ToolCallState {
  id: string;
  name: string;
  argsText: string;
  args?: unknown;
  status: "streaming" | "ready" | "running" | "success"
        | "error" | "awaiting_approval" | "rejected";
  result?: string;
  error?: { code: string; message: string };
  approvalId?: string;
  durationMs?: number;
  startedAtSeq: number;
}

interface StageState {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  summary?: string;
  startedAtSeq: number;
}

interface ApprovalState {
  id: string;
  scope?: "tool" | "stage";
  toolCallId?: string;
  stageId?: string;
  title: string;
  description?: string;
  args: unknown;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "expired";
  note?: string;
}

interface ArtifactState {
  id: string;
  kind: "diff" | "log_bundle" | "release_notes" | "plan" | "document";
  title: string;
  mime?: string;
  size?: number;
  uri?: string;
  stageId?: string;
  status: "created" | "ready" | "error";
}
```

时间线：

- Chat 渲染按 `messageOrder` + 消息内 block 顺序。
- Release 渲染按 `stageOrder`，工具调用挂在所属 stage 下（`stageId` 为可选字段）。
- 事件检查器直接展示原始事件 + reducer 快照。

## 6. Transport 契约

```ts
export interface StartRunInput {
  threadId: string;
  kind: RunKind;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTransport {
  start(input: StartRunInput, opts?: { signal?: AbortSignal }): AsyncIterable<AgentEvent>;
  resume(runId: string, lastEventId: string, opts?: { signal?: AbortSignal }): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  resolveApproval(
    approvalId: string,
    decision: { approved: boolean; note?: string },
  ): Promise<void>;
}
```

HTTP 形态（已实现，25 个接口；只有 `/api/runtime` 携带运行时模式参数）：

| 方法 | 路径 | 功能与约束 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回当前运行时模式 |
| GET | `/api/scenarios` | mock Chat fixture 列表，供快捷项 |
| POST | `/api/demo/long-conversation` | 生成长会话事件集；仅压测，不作产品接口 |
| GET | `/api/runtime` | 当前模式、模型、模型目录、docs/releases 计数 |
| POST | `/api/runtime` | `{ mode, modelId? }` 切换全局运行时；无 Key 切 agent 返回 409 |
| GET | `/api/kb/docs` | 知识库文档 `{ id, title }` |
| GET | `/api/threads` | Chat 会话列表，按 `updatedAt` 倒序 |
| GET | `/api/threads/:threadId/runs` | Chat 物化快照分页，`cursor` / `limit`（≤ 50） |
| POST | `/api/runs` | 创建 Chat run，返回 `runId / threadId / kind` |
| GET | `/api/runs/:runId/events` | Chat SSE 事件流 |
| POST | `/api/runs/:runId/cancel` | 协作式取消 |
| GET | `/api/runs/:runId/spans` | 从事件派生 `Span[]` |
| POST | `/api/runs/:runId/pause` | 暂停并自动恢复；仅 mock |
| POST | `/api/approvals/:approvalId` | 工具审批；仅 mock |
| GET | `/api/releases/scenarios` | 发版场景列表 |
| GET | `/api/releases/threads` | Release 会话列表 |
| GET | `/api/releases/threads/:threadId/runs` | Release 物化快照分页 |
| POST | `/api/releases` | `{ scenarioId?, threadId?, sourceRunId? }` 启动发版 run |
| POST | `/api/releases/runs/:runId/rollback` | 创建回滚 child run；仅成功完成的非回滚 run |
| POST | `/api/releases/runs/:runId/cancel` | 取消 Release run |
| GET | `/api/releases/runs/:runId/events` | Release SSE 事件流 |
| GET | `/api/releases/runs/:runId/spans` | 派生 span，活跃或已落库 run 均可 |
| GET | `/api/releases/runs/:runId/events.json` | 原始事件快照，供调试与回放 |
| POST | `/api/releases/approvals/:approvalId` | 阶段审批 |
| GET | `/api/releases/runs/:runId/artifacts/:artifactId` | 拉取 artifact 内容 |

路由分发：

- `POST /api/runs` 按当前全局模式分发到 agent 或 mock；其余 run 级接口按 run 归属分发，切换模式不影响在跑 run。
- mock 独有的暂停与工具审批接口在 agent 模式下不可用。
- 创建类接口返回 `{ runId, threadId, kind }`；快照分页返回 `RunHistoryPage`；spans 返回 `{ spans }`；artifact 返回 `{ mime, body }`；错误统一 `{ error }`，可带 `code`。
- 当前版本无鉴权与 CORS 配置，部署前需补。

SSE 约定：

- `id` 使用 `eventId`；断线后客户端回传 `Last-Event-ID`。
- 心跳是 transport 层注释（例如 `: ping`），不是 AgentEvent。
- 服务端从事件日志回放 `seq > lastSeq` 的事件；找不到时回退到 checkpoint 或完整回放。
- 同一 thread 只允许一个活跃 run，冲突返回 409；并行队列未实现。

取消语义：

- `AbortSignal` 从前端传到 transport、runtime、工具。
- 取消后仍要发出 `run.completed { status: "cancelled" }` 作为终态。
- 已产生的事件保留；不做回滚。

## 7. Fixture 格式

每个场景一个目录：

```
fixtures/
  chat-long-markdown/
    scenario.json
    events.jsonl
  release-conflict-approval/
    scenario.json
    events.jsonl
```

`scenario.json`：

```json
{
  "name": "chat-long-markdown",
  "description": "流式输出长 Markdown：标题、表格、代码块、引用",
  "runKind": "chat",
  "threadId": "thread_fixture",
  "timing": {
    "mode": "delays",
    "defaultMs": 30,
    "bySeq": { "1": 0, "2": 10 }
  }
}
```

`events.jsonl`：每行一个完整 `AgentEvent`。

```jsonl
{"v":1,"eventId":"evt_001","seq":1,"runId":"run_demo","threadId":"thread_fixture","ts":0,"type":"run.started","payload":{"kind":"chat","title":"长文演示"}}
{"v":1,"eventId":"evt_002","seq":2,"runId":"run_demo","threadId":"thread_fixture","ts":0,"type":"message.started","payload":{"messageId":"msg_001","role":"assistant"}}
{"v":1,"eventId":"evt_003","seq":3,"runId":"run_demo","threadId":"thread_fixture","ts":0,"type":"text.delta","payload":{"messageId":"msg_001","delta":"# LangChain"}}
{"v":1,"eventId":"evt_004","seq":4,"runId":"run_demo","threadId":"thread_fixture","ts":0,"type":"message.completed","payload":{"messageId":"msg_001"}}
{"v":1,"eventId":"evt_005","seq":5,"runId":"run_demo","threadId":"thread_fixture","ts":0,"type":"run.completed","payload":{"status":"done"}}
```

回放规则：

- `timing.mode = "delays"`：按 `bySeq` / `defaultMs` 延迟。
- `timing.mode = "fast"`：测试/CI 忽略延迟，同步产出。
- fixture 的 `runId` / `threadId` 在加载时可重写，避免多个场景冲突。
- Chat fixture 只保存 assistant 侧事件；运行时后端把用户 prompt 写成 user 消息事件插入事件日志。
- fixture 是**契约测试**：真实后端修复 bug 后，优先补 fixture，而不是只写 UI 测试。

必需覆盖的场景：

1. 普通短文本。
2. 长 Markdown（标题、列表、表格、code fence、引用）。
3. 未闭合 code fence / 表格（截断渲染）。
4. 工具调用成功（半截 JSON + 结果）。
5. 工具调用失败（模型继续解释）。
6. 需要人工审批（暂停 → 批准 / 拒绝）。
7. 取消（流式中途 abort）。
8. 运行错误。
9. 超长会话（用于性能测试，可程序化生成）。
10. Release 完整链路（检查 → 冲突 → diff → 审批 → 测试失败 → 日志分析 → 重跑）。

## 8. Telemetry Span（与 AgentEvent 分离）

```ts
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  runId: string;
  name: string;
  kind: "agent" | "model" | "tool" | "retriever" | "stage" | "internal";
  startTime: number;
  endTime?: number;
  status: "running" | "ok" | "error";
  attributes: Record<string, unknown>;
}
```

约定：

- Span **不进入** AgentEvent 流；通过独立 endpoint / store 提供给 Trace 面板。
- 关联字段：`runId`、`spanId`、`parentSpanId`、`toolCallId`、`approvalId`、`traceId`。
- 属性名兼容 OpenTelemetry GenAI 语义（如 `gen_ai.request.model`、`gen_ai.usage.input_tokens`），但不强制引入 OTel SDK。
- 建议 span 名称：`agent.run`、`model.call`、`tool.search_kb`、`retriever.query`、`stage.release.preflight`。
- Trace 面板只读；通过 `runId` / `spanId` 关联日志行与事件。

区分：

- **业务日志**是 Agent 的分析对象，通过工具查询，可能进入模型上下文。
- **Span** 是平台自身的执行遥测，用于调试和性能分析，不作为模型上下文。

## 9. 版本与兼容

- v1 已在接入真实后端后冻结。
- 允许的变更：新增事件类型、新增可选字段、新增 payload 字段。
- 不允许的变更：改变已有事件语义、删除字段、改变字段类型。
- 破坏性变更必须升 `v: 2`，并在本文件底部记录迁移说明。
- 客户端必须忽略未知事件类型和未知字段。
- 每次协议变更更新本文件末尾的 Changelog。

## 10. 待定问题（持续更新）

1. **Block ID 归属**：默认前端确定性分段；已验证渲染指标，暂不切换后端下发。
2. **Artifact 内联阈值**：默认 8KB 以下可内联；需要实测事件体积。
3. **审批粒度**：已实现。工具审批沿用 `tool.*`，Release 阶段使用 `approval.*` + `run.paused/resumed`。
4. **取消语义**：工具是否必须支持 `AbortSignal`；默认是，超时后标记为 cancelled。
5. **恢复来源**：开发期事件日志；生产期 checkpoint。接口保持一致。
6. **Reasoning 可见性**：时间线默认展开，内容区限高滚动；调试抽屉仍可查看原文，避免长推理挤压正文。
7. **同一 thread 的并发 run**：默认单活跃 run；后续再设计队列。
8. **Token 统计粒度**：默认在 `run.completed.usage` + span attributes；是否增加 `usage.updated` 待定。
9. **历史会话加载**：已实现。打开已有 thread 不做流式回放，也不一次性返回全部历史事件；默认按 cursor 分页返回服务端物化的消息/块，原始事件只用于调试与回放。若分页直接返回原始事件，分页边界必须附带 checkpoint 快照，否则 reducer 无法从中间 `seq` 重建状态。`/api/demo/long-conversation` 这类批量生成接口只作为性能压测工具，不作为产品历史接口。实现为 `GET /api/threads/:threadId/runs?cursor=&limit=`，返回 `RunSnapshot`（`appliedEventIds` 序列化为数组）与 `nextCursor`。

## 11. Changelog

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-10-20 | v0 | 初稿：信封、事件类型、reducer、fixture、transport、Span |
| 2026-10-20 | v0 | 用户输入纳入事件流（`message.started` 支持 user 角色）；多轮 run 共用 thread |
| 2026-10-20 | v0 | reducer 状态保留引用元数据（`CitationState`）与工具耗时（`ToolCallState.durationMs`） |
| 2026-10-20 | v0 | reducer 记录 reasoning 块（`ReasoningState`）；UI 默认展开并限高 |
| 2026-10-20 | v0 | `RunState.errors` 记录 `retryable / fatal`，区分局部错误与致命错误 |
| 2026-10-29 | v1 | 冻结 v1；新增 `RunSnapshot` / `ThreadSummary` / `RunHistoryPage` 物化快照契约 |
| 2026-10-29 | v1 | 历史会话按 cursor 分页返回快照，不回放全部原始事件 |
| 2026-10-29 | v1 | 新增 `approval.required` / `approval.resolved` 阶段级审批；artifact 增加可选 `stageId` |
| 2026-10-29 | v1 | `run.started` 增加可选 `sourceRunId`，记录 Chat → Release handoff 来源 |
| 2026-10-29 | v1 | 新增 `guard.blocked`，记录安全拦截类别；RunState 增加 `guards` |
| 2026-10-30 | v1 | `run.started` 增加可选 `runtime`（`mode / provider / model`），快照 run 启动时的运行时；新增 `POST /api/runtime` 切换全局模式 |
| 2026-10-30 | v1 | 补全 HTTP 接口清单（25 个）与路由分发、响应与错误语义 |
