# 执行计划与待办

最后更新：2026-10-30

本文件是执行计划、待办分组、验收标准与已知限制的唯一来源；能力缺口与推进顺序见 [agent-map.md](../architecture/agent-map.md)，架构决策见 [decision.md](decision.md)，协议契约见 [protocol.md](../architecture/protocol.md)。

## 1. 当前状态

核心链路已完成：流式 Chat（事件协议、增量渲染、工具循环、BM25 RAG、历史快照）、Release 发版工作台（阶段审批、LLM 冲突、RCA、回滚、handoff）、Trace 与离线评测。真实模型端到端质量、引用准确率与成本待配置 Key；已知限制见 §4。

## 2. 已完成

- **协议与渲染**：AgentEvent v1 + 纯函数 reducer；fixture 回放、SSE 重放、取消与断线重连；增量 Markdown、闭合块冻结、长会话虚拟化与渲染基准。
- **Chat**：Hono + LangGraph 工具循环、BM25 知识库、引用与拒答、历史快照分页、对话追加队列；工具/审批/reasoning/引用时间线卡；离线检索 3/3 top-1，真实模型需配 Key 验证。
- **Release**：确定性阶段、阶段审批、diff/audit artifact；LLM 冲突结构化输出 + 确定性回退；test.1 失败 → 日志 RCA → 修复审批 → test.2 重跑；回滚 child run（parentRunId）与审计；`prepare_release` handoff（sourceRunId）；耗时/审批/artifact 指标。
- **评测、Trace 与安全**：Trace 从事件派生；17 篇语料（含前端组件库）+ 50 题检索金标（`eval:retrieval`）、10 个 RCA 案例（`eval:rca`）、元数据过滤、离线评测报告、渲染基准；input guard、检索数据分隔、输出脱敏。
- **展示与回归**：工程亮点卡、工程说明抽屉、guard 卡片；protocol 62 / API 83 测试，Playwright 11 条关键路径，typecheck / build / check-docs 全绿。
- **知识库浏览**：Chat header 入口；按 `service` → `type` 目录树浏览知识库，Markdown 预览与 `service` / `type` / `tags` 元数据；列表与全文接口见 [protocol.md §6](../architecture/protocol.md#6-transport-契约)。
- **运行时切换**：默认 mock；`RuntimeController` 全局模式 + `MODEL_CATALOG` 目录；mock/agent 双运行时分发；header 切换控件（无 Key 禁用），流式中挂起切换；`run.started.runtime` 快照；mock 终态落库，侧栏与模式解耦。

## 3. 待办

### 3.1 输入框

- [ ] 思考模式开关：运行时切换思考/非思考，经 `modelKwargs` 透传；前置是解决 GLM 关思考后流式 `tool_call` delta 缺 `role`、LangChain 丢块。
- [ ] 语音输入：Web Speech adapter 优先，选型见 [decision.md §8](decision.md#8-待确认)；交互与降级见 [multimodal.md §2](../architecture/multimodal.md#2-交互)。
- [ ] 图片识别：上传、预览、视觉模型回答、mock 降级；安全边界见 [multimodal.md §5](../architecture/multimodal.md#5-安全与隐私)。
- [ ] 文件与音视频上传：输入框支持图片、文件、音视频附件。

### 3.2 会话内容

- [ ] 代码块：复制 + 语法高亮；抽取通用 `CodeBlock`（语言、最大高度、换行）复用到 Markdown、工具卡参数/结果与事件检查器。
- [ ] 文本复制快捷键。
- [ ] 音视频消息以卡片渲染。
- [ ] 对话分支：从指定消息拆出 branch thread；需要 `branchFrom` / `parentThreadId` 元数据和事件前缀/快照 fork。
- [ ] 引用下钻：`citation.added` 增加 `blockId` / `chunkId` / `quote`；block 尾部引用标记，点击弹层展示原文摘录；完整文档只走 source API / artifact，侧栏拉取原文并按 `chunkId` 定位高亮，关联 retrieval span 与引用准确率评测。
- [ ] 会话内目录（Outline）：按 run 分组提取提问与 assistant heading；hover 200–300ms 显示摘要预览，点击按 `runId / messageId / blockId` 跳转。
  - 预览只渲染摘要并按锚点缓存；目录在 block 闭合时更新，长会话虚拟化或折叠；支持键盘选择、Enter 跳转、Esc 关闭。预览卡参考 Obsidian Page Preview：白底、圆角、细边框、柔和阴影，靠边翻转并 clamp；左侧用长短灰线表示标题层级，`+N` 语义待定。
- [ ] 端上 UI 打磨（借机学习 TailwindCSS）。

### 3.3 统计与模型

- [ ] 拆分统计看板：把 `PerformancePanel` 升级为「性能」「费用」两类；性能补真实 provider 首 token 与端到端延迟，费用按单价汇总 `run.completed.usage` 的 token 与成本，按 run/thread 聚合。
- [ ] 模型列表与模型切换：按 `MODEL_CATALOG` 展示可切换模型并切换具体模型；思考模式开关见 3.1。
- [ ] 真实 provider 基线（统计看板前置）：用免费额度的 OpenAI 兼容 provider 跑通一次真实调用，拿到单价与延迟。

### 3.4 Agent 能力

- [ ] RAG 端到端评测：补 `goldAnswerPoints` / `goldEvidenceIds`，评忠实度、引用准确率与答案正确性；需真实模型 + judge + 人工抽检。
- [ ] 服务端队列：追加队列移到 RunRegistry，解决多标签页一致性与 409 单活跃 run 约束；当前队列只在单页内存。
- [ ] 运行态持久化恢复：服务重启后恢复运行中 run 与 pending approval。

### 3.5 知识库文件

- [ ] 文档 id 与互链：`metadata.json` 增加显式 `id`（初值同文件名），加载与 `check-docs` 校验 id 唯一、正文内链目标存在；内链只写 docId，按 id 解析跳转，不解析文件路径。
- [ ] 文档版本：同一 docId 多个版本快照 + `currentVersion` 指针（模型见 [decision.md §4](decision.md#知识库文档模型)、[storage.md §3.2](../architecture/storage.md#32-文本内容)）；列表与预览默认当前版本，可切换历史版本并标「仅供查阅」；预览接口增加 `version` 参数（缺省当前版本）；检索只索引当前版本；`citation.added` 增加可选 `docVersion`，实现时同步 [protocol.md](../architecture/protocol.md)。
- [ ] 上传：新增文档并触发索引重建，上传后可在文件库查看；暂不做在线编辑。
- [ ] 上传安全：限制类型与大小，文档内容按不可信数据处理。

### 3.6 多 Agent 架构

- [ ] 明确角色拆分、调度方式、共享/私有上下文、工具权限与 handoff 边界。
- [ ] 协议扩展 `agentId` 等可选字段，Trace 按 agent 关联；先选一个场景落地（如 Release 内拆分检查/修复/审计）。

### 3.7 持久化与数据库

表结构、数据库约定与迁移顺序见 [storage.md](../architecture/storage.md)，按顺序逐段实现：

- [ ] 本地 pg：先装 Docker Desktop 并确认 `docker compose version`，再用 `docker compose` 起 Postgres；`DATABASE_URL` 进 `.env.example`，启动时执行迁移。
- [ ] `Storage` 与 repository 接口，文件实现收到接口后面。
- [ ] 运行时落库：threads / runs / events，导入现有 `.data/threads`，快照改派生。
- [ ] 集成测试切真库：每个 worker 独立 schema，纯单测保持离线。
- [ ] 文本内容落库：documents / chunks 与 bigram 倒排索引，`data/docs` 改为 seed import。
- [ ] 产品迭代落库：iterations / features / iteration_links 与 PRD / 技术方案 / 发版记录，知识库增加迭代分类。
- [ ] prompt 版本、spans、独立日志库与 artifacts 接入 `Storage`。

### 3.8 工程化与交付

- [ ] 测试统一并纳入 typecheck：单测与源码共置、统一 `.test.ts`（`packages/protocol/src/__tests__` 迁出）；E2E 保持根级并升级为独立 workspace（`e2e/package.json` + tsconfig，仍用 `pnpm dev` 起全链路），统一 `.spec.ts` 并纳入 tsconfig；共享辅助只抽 2 处以上复用的（事件构造、临时 store / app），不预先建 `packages/testing`。
- [ ] 单测执行与调试：支持按包 / 文件 / 用例运行（`pnpm test -- <path>`、`-t`）与 watch 模式；补编辑器断点调试配置（`node --inspect-brk` 或 VS Code launch.json），能对单条用例断点逐帧调试。
- [ ] 多分支并行开发（git worktree）：用 `claude -w <name>` / `EnterWorktree` 在 `.claude/worktrees/<name>` 建独立 checkout；补 `.gitignore` 的 `.claude/worktrees/`、`.worktreeinclude`（只复制 `.env`）、`worktree.baseRef`；各 worktree 用 `VITE_PORT` / `PORT` / `API_ORIGIN` 与独立 `.data/` 并行（端口 env 已就绪，E2E 固定 5174 / 8788 与 `.data/e2e`）；各 worktree 独立 `pnpm install`。
- [ ] 分支规范：开发分支暂定 `feature/<描述>_<时间戳>_<迭代 id>`；发版分支待补命名与切出时机（与迭代 `base_branch` / `feature_branch` 的映射见 [storage.md §3.3](../architecture/storage.md#33-产品迭代)，迭代侧见 3.10）；确认后写入 [AGENTS.md](../../AGENTS.md) 作为生效规则。
- [ ] oxlint（type-aware）+ Prettier 清理后接入 GitHub Actions：format / lint / typecheck / test / build / check-docs；E2E 可选。
- [ ] 本地开发与线上测试切换：环境变量与 API base URL 切换，补线上一套冒烟测试。
- [ ] Mock 数据真实化：
  - Demo fixture 由知识库、1.2.0 发版场景与 INC-042 日志组合生成并提交 JSONL，禁止“节点 N”/lorem 进入 Demo；长会话改为 30–50 轮真实 Q&A，长报告改为发版检查/事故复盘，图片用本地合成截图 + 固定识别文本。
  - 节点生成器只保留给 `pnpm bench:streaming` 与压测入口，快捷项标注“压测数据”；增加 `fixtures:check`：校验领域锚点、引用 `sourceId`、占位词和块数。
- [ ] 部署与演示入口：前端 Netlify + 后端 Render/Fly；CORS、API base URL、mock 标注、环境变量校验、健康检查与跨域 SSE 实测。
- [ ] API 资源化：run 收敛为单一 `/api/runs/:runId`（按 `kind` 判别，吸收 `/api/releases/runs/*` 的 cancel / events / spans），审批统一为 `/api/approvals/:id`；补 `GET /api/runs/:runId` 与 `POST /api/threads`；创建类接口返回 201 + `Location`；动作端点改资源语义（`cancel` / `pause` → `PATCH /api/runs/:runId { status }`，`rollback` → `POST /api/runs` 带 `parentRunId`，审批决议 → `PATCH /api/approvals/:id { status, note? }`），路径中不再出现动词。与 3.10 迭代重做同步，避免 Release 命名空间改两遍；实现时同步 [protocol.md §6](../architecture/protocol.md#6-transport-契约)。
- [ ] API 版本化：路由统一挂 `/api/v1`，前端 transport 收敛到单一 base URL；与事件协议 `v: 1` 区分（URL 版本管 HTTP 契约，事件版本管 AgentEvent）；同步 protocol.md 的接口清单与 Changelog。

### 3.9 文档

- [ ] 整理文档：难点分析单独归类，清理重复与过期描述。

### 3.10 迭代与发版流程

- [ ] 新建迭代：版本号 + 目标 + PRD / 技术方案（上传或引用已有知识库文档），文档写入知识库并重建索引；feature 先手填，状态只用 pending / in_progress / done。
- [ ] 迭代文档进入检索：PRD / 技术方案 / 发版记录按迭代分类写入（依赖 3.5 的写入与版本能力），Chat 可按迭代过滤并引用，引用钉 `docVersion`。
- [ ] 迭代详情：顶层 `Releases` 改为 `Iterations`，不新增 tab；详情沿用 Overview / Logs / Diff / Trace / Events / Audit，发版作为迭代内阶段。
- [ ] 协议加法：`run.started` 增加可选 `iterationId`，`RunKind` 暂不变；实现时同步 [protocol.md](../architecture/protocol.md) 的 Changelog 与 [storage.md](../architecture/storage.md)。
- [ ] 发版段重做：当前固定阶段链（前置检查 → 冲突解决 → Diff 审批 → 测试 → RCA → 修复审批 → 重测 → 回滚 → Release Notes → 审计）不是目标形态；以迭代容器 + 功能分支为输入，阶段粒度确认后按切片重做，复用现有 stage / 审批 / artifact / 回滚与 Trace 派生。
- [ ] 删除旧 Release：迭代发版段达到能力对等（冲突 → 审批 → 失败 RCA → 回滚，补齐 fixture 与 E2E）后，整块删除路由、UI、fixture、测试与文档，不留兼容层。

## 4. 验收与限制

- 每个切片退出条件：可运行、端到端场景、测试通过、1–3 个量化指标、README 更新、能回答 3 个面试追问。
- 运行中的 Chat / Release run 依赖内存 runtime，服务重启后不可恢复，pending approval 失效；已完成 run 与 artifact 仍可读。
- 运行时模式为进程内全局状态，重启回默认 mock；mock 会话终态落库，`bench-*` 与断开未取消的 run 不落库。
- 真实模型端到端答案质量、引用准确率与成本估算待 Key/单价。
- 发版为模拟环境，不接真实 CI/CD。
