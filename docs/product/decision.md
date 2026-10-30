# 项目决策记录

最后更新：2026-10-30

本文件是决策与理由的唯一来源。产品定位与功能范围见 [README.md](../../README.md)；执行计划与待办见 [plan.md](plan.md)；协议契约见 [protocol.md](../architecture/protocol.md)。

## 1. 架构与协议决策

- **两个场景，不合并界面**：Chat 与迭代（发版为迭代内阶段）共享 runtime、协议和组件，但保持独立界面。理由：Chat 是渲染能力主展示面，迭代是结构化执行面，合并会同时牺牲两者。
- **Chat 保持 Agent 属性**：保留工具循环、会话记忆和多步任务；不得退化为纯 RAG 问答链。
- **协议优先**：先定义 append-only `AgentEvent` v1（`runId / messageId / blockId / toolCallId / seq`），再做 UI；冻结与版本规则见 [protocol.md §9](../architecture/protocol.md#9-版本与兼容)。
- **Mock 是事件 fixture 回放器**，不是"关键词 → 假文本"；快捷选项对应完整事件序列。
- **transport 统一抽象**为 `AsyncIterable<AgentEvent>`；mock 与真实 SSE 共用同一个 reducer。
- **领域事件与 telemetry 分离**：`AgentEvent` 驱动 UI；`Span`（OTel 风格）进 trace store，通过 `runId / spanId / toolCallId` 关联，不混入事件流。
- **单一状态源**：run 的事件日志是唯一状态源；聊天、迭代工作台、Trace 都是它的投影。
- **迭代与发版 UI 是事件投影**：阶段视图由事件驱动，不能硬编码流程。
- **确定性优先**：发版步骤尽量是确定性工作流；LLM 只用于冲突解决、文案生成、风险摘要等有边界任务。
- **不做通用平台**：共享协议、transport、组件即可，不为复用做通用 Agent / 知识库 / 日志平台抽象。
- **前端先行**：后端接入只替换 transport 和 runtime，不重写已完成的渲染层。

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
| 检索 | 本地 BM25 → SQLite FTS5 | BM25 已实现；FTS5 已定，待实现 |
| 存储 | SQLite（Kysely）+ Storage 抽象 → Postgres | 本地文件已实现；SQLite 已定，待实现 |
| 样式 | Tailwind CSS + shadcn/ui | 已确认 |
| 客户端状态 | zustand（全局运行时状态） | 已确认 |

- 本地运行方式：单个 Hono 进程同时服务 web 静态资源和 API；不引入部署平台。
- 开发期使用 Vite dev server（HMR），`/api` 代理到 Hono；构建后由 Hono 单进程托管 web 静态资源。
- 不选 Next.js 全栈作为主方案：serverless 对长连接、长任务、取消/恢复限制多；若用需自托管 Node。
- Express 只需达到"能读、能改、能解释区别"，不深研；Koa 不作为新项目选项。

## 3. 前端三个深挖点

1. 流式 Markdown：块级增量解析、稳定 blockId、闭合块冻结、未闭合 fence/表格/强调降级；避免每 token 全量 parse 和整树重渲染。
2. 长会话性能：块级虚拟化、闭合块 memo、按块订阅（`useSyncExternalStore`）、rAF 合并 token 增量；目标 10k 块稳定 60fps。
3. 工具调用与运行状态：半截 JSON 参数解析、工具状态机、reasoning 折叠、interrupt/审批 UI。
- 工具调用、审批、阶段、artifact 等有生命周期或交互的内容作为事件驱动的时间线行，不嵌入 Markdown；引用等只读轻量信息可内联到 Markdown。理由见 [rendering.md §2](../architecture/rendering.md#2-工具与引用的渲染边界)。

所有深挖点都要有可量化证据：渲染次数、帧率、首 token 延迟、内存。

## 4. 横向能力

### RAG

- 检索做成工具，Agent 决定何时查、查几次、是否改写 query。
- 必须支持引用、拒答、元数据过滤、检索评测和 trace 可见。
- 不设虚构公司品牌名，以服务名（主例 `checkout-service`）和事故编号（如 `INC-042`）作为语料锚点，保证文档、日志、发版记录可相互引用。
- 评测指标：recall@k、引用准确率、答案忠实度。

### 知识库文档模型

- **逻辑文档 + 不可变版本**：文档升版沿用同一 `docId`，追加版本快照并移动 `currentVersion` 指针，不新建 docId。理由：目录树与历史链保持稳定，避免 `-v2` 类假文档碎片；表结构见 [storage.md §3.2](../architecture/storage.md#32-文本内容)。
- **检索只收当前版本**：历史版本只供人查阅与审计，不进索引和模型上下文。理由：RAG 引用过期 API 比查不到更危险。
- **引用钉版本**：`citation.added` 增加可选 `docVersion`，引用按 `docId + docVersion + chunkId` 定位。理由：文档升版后旧 run 的引用不能漂移到新内容。
- **文档 id 显式维护**：id 存在文档元数据中，不从文件名或路径推导；正文互链只写 `docId`，不写文件路径。理由：移动或重命名文件不应断链；id 同时是检索金标与引用的锚点。

### 日志

- 业务日志：Agent 工具（`search_logs`、`get_log_context`、`group_errors`、`get_commit_diff`），输出根因 + 证据 + 修复建议，用合成故障集评测。
- 不建日志平台；小规模合成语料 + 本地索引 + SQLite FTS / 内存即可。

## 5. 信息架构

- 顶层导航：Chat / Iterations，不设第三个业务 tab；发版不单独占 tab。
- 迭代详情：Overview / Logs / Diff / Trace / Events / Audit；发版 run 的 Trace 与 Events 仍按 run 聚合。
- Chat：日志与检索结果以工具卡片内联展示；调试时打开 Trace/Events 抽屉。
- 可选后期增加顶层 Log Explorer，用于跨 run 搜索和"让 Agent 分析"。

## 6. 迭代与发版场景决策

- **迭代是一级容器，发版是阶段**：一次迭代包含多个 feature、一份 PRD、一份技术方案、一个功能分支和一个迭代版本号；发版是迭代的出口阶段，不是独立场景。
- **数据真实、执行模拟**：PRD、技术方案与发版记录是真实文档，写入知识库、可版本化、可被 Chat 检索引用；分支合并、CI 与部署仍是玩具仓库 + 模拟 CI。理由：作品集不需要真实环境，同时避免真实凭证与 NDA 风险，审批、审计、回滚仍可完整演示。
- **新起 iterations 领域，不原地改名**：Release 的语义是"一次执行"，直接改名为容器概念会造成层级错位。迭代详情复用现有 tabs 与 stage / 审批 / artifact / 回滚 / Trace 派生；旧 Release 保持可跑，达到能力对等后整块删除。删除条件与顺序见 [plan.md §3.10](plan.md#310-迭代与发版流程)。
- **feature 是轻量清单**：状态只做 pending / in_progress / done，不做 assignee、估点、看板与排期，避免退化为项目管理工具。
- **协议按加法预留**：`run.started` 增加可选 `iterationId`，`RunKind` 暂不变；迭代、feature 与文档关联的表结构见 [storage.md §3.3](../architecture/storage.md#33-产品迭代)。
- 数据与合规要求见 [README.md §7](../../README.md#7-非目标) 与 [§10](../../README.md#10-数据与合规)。

## 7. 求职叙事

- 简历不要写"类 ChatGPT 应用"；写具体决策、难点和指标，且每条都能被追问三层。
- 渲染与协议层完成可投 Agent 前端岗位；前后端全栈接入后可投全栈 AI 应用；迭代与发版、可观测性与评测完成后可投 Agent 工程师。
- 公司经历如实写"参与发版 Agent、负责冲突解决"；side project 写"独立重构的简化版"。
- 要能回答：为什么不用 Next/Express、为什么事件与 telemetry 分离、如何评测检索和根因、流式渲染如何避免重渲染。
- 核心观点：不是所有 Agent 都该做成聊天框；Chat 是入口，结构化执行面负责高风险、可审计流程。

## 8. 待确认

- 部署执行细节：后端 Render 或 Fly 二选一、实例规格、持久卷与跨域 SSE 实测（部署时确认）。
- 语音输入选型：Web Speech（快、跨浏览器受限）vs 服务端 Whisper / 流式 ASR；第一版倾向 Web Speech adapter，见 [multimodal.md §4](../architecture/multimodal.md#4-服务端与模型)。
- 图片存储与发送策略：保留时长、是否默认发模型 provider、EXIF 清理规则，见 [multimodal.md §5](../architecture/multimodal.md#5-安全与隐私)。
- 视觉模型支持与成本：当前 provider 是否支持图片、超限如何降级，需真实 Key 验证。

## 9. 变更记录

| 日期 | 变更 | 理由 |
| --- | --- | --- |
| 2026-10-20 | v0 初稿：定位、架构、协议、范围、阶段 | 项目启动 |
| 2026-10-20 | 示例领域定为研发领域，不设公司品牌名，以服务名 + 事故编号为锚点 | 用户确认不需要公司名 |
| 2026-10-20 | 前端 React + Vite、后端 Hono + Node、pnpm、Vitest 按默认值确认 | 用户确认技术选型 |
| 2026-10-20 | 改为本地运行，部署平台暂缓，不纳入首版验收 | 用户决定先本地运行 |
| 2026-10-20 | 样式采用 Tailwind CSS + shadcn/ui；开发期 Vite 代理 `/api` 到 Hono，构建后单进程托管 | 启动项目，确认样式待定项 |
| 2026-10-20 | 工具调用/审批作为事件驱动时间线行，不嵌入 Markdown；引用等只读内容可内联 | 生命周期、审批与回放必须由事件日志驱动，避免注入和流式占位同步问题 |
| 2026-10-20 | reasoning 以时间线折叠卡展示，默认展开，内容区限高滚动 | 保留推理过程可见性，同时避免长推理挤压正文 |
| 2026-10-29 | 模型接入支持 OpenAI 兼容与 Anthropic，按环境变量自动选择；无 Key 回退 fixture mock | 保证离线可运行，同时可接真实模型 |
| 2026-10-29 | 知识库检索采用本地 BM25（中文 bigram + 英文词），暂不引入 embedding / SQLite | 离线可测，符合本地索引方向 |
| 2026-10-29 | 历史会话返回物化快照 + cursor 分页，JSONL 持久化；checkpointer 用内存，重启后按历史消息种子恢复 | 不重放全部原始事件，重连与恢复语义一致 |
| 2026-10-29 | 同一 thread 只允许一个活跃 run，冲突返回 409 | 落地协议默认约束 |
| 2026-10-29 | 增加确定性输入 guard、检索数据分隔与流式输出脱敏 | 防密钥/系统提示词提取和文档注入；密钥仍不进入模型上下文 |
| 2026-10-29 | 阶段审批使用独立 `approval.*` 事件，不与工具审批混用 | 阶段 gate 与工具审批语义分离，便于审计与 UI 复用 |
| 2026-10-29 | 玩具仓库使用结构化冲突 hunk + 模拟 CI，不执行真实 git/CI | 离线确定、可测试，满足模拟环境约束 |
| 2026-10-29 | Release 先交付确定性主链路，LLM 冲突、RCA、回滚分切片 | 控制范围，先验证事件与 UI 纵切 |
| 2026-10-29 | LLM 冲突使用结构化输出 + 严格校验，失败/超时回退确定性方案 | 保证离线可演示与可审计，不把模型不可靠性带进发版主链路 |
| 2026-10-29 | `RELEASE_CONFLICT_MODE` 支持 auto / llm / fixture；Diff artifact 记录 mode、fallbackReason、latency 与 rationale | 便于对比 LLM 与确定性方案，并为后续评测留下数据 |
| 2026-10-29 | 失败 RCA 由确定性工具链完成（search_logs / get_log_context / search_kb），修复走阶段审批 | 日志根因需要可复现证据；LLM 仍只用于冲突解决等有边界任务 |
| 2026-10-29 | 回滚使用 child run + `parentRunId`，回滚审批后写审计 | 保持 run 终态不可变，同时保留回滚与原始发版的审计链 |
| 2026-10-29 | Chat handoff 使用 `prepare_release` 工具 + 独立 Release thread，`sourceRunId` 记录来源 | Chat 与 Release 界面分离，同时保留来源链；不在同一 thread 混合两种 run |
| 2026-10-29 | Release 详情摘要展示耗时、审批数、artifact 数与失败阶段 | 让确定性流程和人工 gate 有可量化证据 |
| 2026-10-29 | Trace 从事件日志派生 run/stage/tool/approval spans，暂不做独立模型 Span 埋点 | 与“事件日志是唯一状态源”一致，先提供可利用的 waterfall |
| 2026-10-29 | 检索评测使用 16 篇合成语料 + 50 题冻结金标；Abstain 阈值 4 仅对当前数据集校准 | 先建立可重复基线，阈值随数据集变化需重新评估 |
| 2026-10-29 | 对话追加首版使用客户端队列，run 结束后逐条发送；取消清空队列 | 先验证交互而不改服务端单活跃 run 约束；服务端队列与分支后续再做 |
| 2026-10-29 | 部署形态：前端 Netlify 静态托管，后端 Render/Fly 单 Node 服务；当前无鉴权阶段用 CORS，不拆 API | 兼顾静态 CDN/预览部署与 SSE、文件存储；Render/Fly、持久卷和跨域 SSE 在部署时再确认 |
| 2026-10-30 | 移除 M0–M4 阶段门禁与时间盒，执行计划合并为统一待办清单 | 阶段拆分对后续迭代无实际价值，单一待办更直接 |
| 2026-10-30 | 本地默认 mock；RUNTIME_MODE 只决定启动默认值，Key 只决定实时 Agent 是否可切换 | 页面内切换，不必改 .env 重启 |
| 2026-10-30 | 运行时是服务端全局单状态，只有 `POST /api/runtime` 带参数；mock 与 agent 双运行时共存，按当前模式或 run 归属分发 | 会话列表等接口不感知模式，避免全链路透传 |
| 2026-10-30 | 每个 run 在 `run.started.payload.runtime` 快照模式与模型；流式期间切换先挂起，run 结束后生效 | 在跑 run 语义稳定，切换可审计、可提示 |
| 2026-10-30 | 客户端全局状态引入 zustand 与 `@radix-ui/react-dropdown-menu` | 运行时状态跨 Chat/Release 共享且需要选择器订阅 |
| 2026-10-30 | mock 会话在终态（完成/取消）写入 `ThreadStore`；`bench-*` 与断开未取消的 run 不落库；侧栏与运行时解耦，切换模式保留 threadId | 会话列表是历史记录，不应随模式隐藏；mock 历史可作为后续 agent 上下文 |
| 2026-10-30 | 数据存储改为 DB 为源：SQLite + Kysely，日志独立库，大对象走 Storage；runtime 模式仍进程内；详见 [storage.md](../architecture/storage.md) | 本地跑通并可迁 Postgres；支撑产品迭代内容与 prompt 版本落库 |
| 2026-10-30 | 知识库文档采用逻辑文档 + 不可变版本；检索仅索引 current 版本；引用钉 `docVersion`；文档 id 显式存储在元数据，正文互链只写 docId | 升版不能断链、不能让历史版本污染检索；旧 run 的引用需可回溯 |
| 2026-10-30 | Release 升级为迭代容器：迭代含多 feature、PRD / 技术方案、功能分支与版本号，发版作为迭代内阶段；新起 iterations 领域，旧 Release 达到能力对等后整块删除；feature 仅保留轻量状态；`run.started` 加法预留 `iterationId`；数据真实、执行模拟 | 发版不应是独立场景；迭代才能承载多 feature 并联动知识库，原地改名会让容器与执行层语义错位 |
