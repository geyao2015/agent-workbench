# 页面展示亮点记录

最后更新：2026-10-29

状态：待设计，尚未实现。用于记录作品集页面如何呈现工程能力；方案确认前不改 UI。

本文件是展示层亮点与演示编排的唯一来源。产品功能事实见 [README.md](../README.md)，执行计划与待办见 [plan.md](plan.md)。

## 1. 目标与原则

- 首屏让招聘方看到“解决了什么难问题”，而不是功能清单。
- 每条亮点都要有证据：测试、指标、代码位置或可运行入口。
- 优先产品内展示（空态、抽屉、就地卡片）；独立落地页待定。
- 不写“高性能、可扩展”这类没有证据的形容词。
- 真实模型、生产部署、评测数据未验证前，不对外宣称。

## 2. 现有亮点

| 领域 | 亮点 | 证据 | 代码 | 演示入口 |
| --- | --- | --- | --- | --- |
| 事件协议 | append-only AgentEvent v1、纯函数 reducer、SSE 重放/取消 | protocol 62 测试；事件检查器 | [events.ts](../packages/protocol/src/events.ts) · [reducer.ts](../packages/protocol/src/reducer.ts) | 事件面板 |
| 流式渲染 | 块级增量分段、闭合块冻结、长会话虚拟列表 | 10k 块/500 增量 513ms；200 增量 1.81ms；60fps | [blocks.ts](../packages/protocol/src/blocks.ts) · [chat-feed.tsx](../apps/web/src/components/chat/chat-feed.tsx) | 长会话 / 性能面板 |
| 交互状态 | 工具状态机、半截 JSON、审批、reasoning、引用 | fixture 回放；工具状态演示 | [tool-card.tsx](../apps/web/src/components/agent-card/tool-card.tsx) · [chat-rows.ts](../apps/web/src/lib/chat/chat-rows.ts) | 功能测试快捷项 |
| 对话追加 | 流式中继续输入并排队，run 结束后自动发送；取消清空 | E2E 覆盖自动发送与取消清空 | [ChatView.tsx](../apps/web/src/views/ChatView.tsx) · [chat-composer.tsx](../apps/web/src/components/chat/chat-composer.tsx) | Chat 输入框 |
| Agent runtime | Hono + LangGraph 工具循环、checkpointer、BM25 RAG | 16 篇文档；API 62 测试；离线假模型 E2E | [graph.ts](../apps/api/src/agent/graph.ts) · [tools.ts](../apps/api/src/agent/tools.ts) · [kb/index.ts](../apps/api/src/kb/index.ts) | 知识库问答 |
| 历史会话 | 物化快照 + cursor 分页、JSONL 持久化、重启种子恢复 | 22 轮分页验证；同 thread 单 run 409 | [thread-store.ts](../apps/api/src/runs/thread-store.ts) | 会话侧栏 |
| 安全边界 | 输入 guard、独立拦截卡片、输出脱敏、检索数据分隔 | 拦截请求不调用模型；三类测试 | [guard.ts](../apps/api/src/agent/guard.ts) · [runner.ts](../apps/api/src/agent/runner.ts) | 安全拒答 |
| 双运行时 | 无 Key 自动 mock；配置 Key 进入实时 Agent | 生产构建两种模式冒烟 | [config.ts](../apps/api/src/config.ts) | Header 运行时标识 |
| 发版工作台 | 确定性阶段、阶段审批、LLM 冲突、失败 RCA、回滚 child run、Chat handoff | 10 阶段端到端；LLM/fallback；失败 RCA；回滚与 parent 审计；handoff 携带 sourceRunId | [release/runtime.ts](../apps/api/src/release/runtime.ts) · [approvals.ts](../apps/api/src/release/approvals.ts) · [ReleaseDetailView.tsx](../apps/web/src/views/ReleaseDetailView.tsx) | Releases |
| 评测与 Trace | 50 题检索金标、10 个 RCA 案例、事件派生 Span 瀑布 | Recall@1 85.4%、Recall@4 100%、MRR 0.920；RCA 证据 100%、runbook@4 100% | [eval/](../apps/api/src/eval/) · [spans/derive.ts](../apps/api/src/spans/derive.ts) | 文档 + Trace tab |
| 渲染基准 | 数据集驱动的 reducer 与浏览器指标 | 200/2000/10000 块；10k 仅挂载 22% | [bench-streaming.mjs](../scripts/bench-streaming.mjs) · [data/bench/](../data/bench/) | [rendering.md §5](rendering.md#5-性能数据) |
| UI 自动化 | Playwright 覆盖 Chat 流式、Release 审批、移动端 header/抽屉、320px tabs | `pnpm test:e2e` 4 条关键路径 | [e2e/](../e2e/) · [playwright.config.ts](../playwright.config.ts) | `pnpm test:e2e` |

## 3. 工程问题记录（面试钩子）

只记录有非显而易见取舍或可量化收益的问题；功能清单和普通样式调整不记录。

| 问题 | 处理 | 证据 / 可追问点 |
| --- | --- | --- |
| 10k 块流式会话每个 token 全量分段，复杂度 O(增量 × 块数) | 只增量解析最后一个开放块，闭合块冻结 | reducer 2.39s → 514ms；blockId 为什么能保持稳定 |
| 旧 run 的 SSE 事件把新 run 标记为失败 | 终态按 runId 隔离，忽略非当前 run 的完成事件 | 回归测试；为什么不能只按 seq 判断 |
| 移动端 header 三栏互相挤压，抽屉又盖住 header | 窄屏隐藏品牌、导航与操作单行；抽屉改为内容区 absolute | 320–1440 无重叠；桌面仍保持停靠侧栏 |
| 320px 下 Release 详情 tabs 溢出，尾部不可达 | tab 栏横向滚动、按钮不换行、补 tablist 语义 | 最窄断点下 Audit 仍可点击 |
| 单 chunk 646KB，首屏和 Release 一起加载 | Release 路由懒加载 + markdown/react vendor 分组 | 主包 244KB；Release chunk 31KB 延迟加载 |
| 性能面板浮在右下角，遮挡对话与输入框 | 改为与事件共用的停靠侧栏，移动端从 header 下方展开 | 桌面主区收缩 384px；抽屉互斥；E2E |
| 单文件过大：`index.ts` 887 行，mock 与业务混在一起 | mock runtime / demo 数据拆到独立模块 | index 167 行；mock runtime 540 行；E2E 行为不变 |

## 4. 展示方案待办

- [x] 空态工程亮点卡：6 条，带指标与说明。
- [x] 头部「工程说明」抽屉：架构取舍、协议、性能、安全与限制。
- [x] guard 拦截独立时间线卡片：新增 `guard.blocked` 事件。
- [x] 亮点与 Demo 的映射：亮点卡可直接触发快捷项或打开 Releases。
- [ ] 首屏 10 秒可读性盲测。
- [ ] 是否做独立落地页（暂倾向不做）。

## 5. 不要宣称

- 真实模型生产验证、高并发、多租户、权限、真实 CI/CD。
- 引用准确率、端到端忠实度与成本数据（尚未评测；检索 recall 基线已有）。
- 真实模型 provider 延迟与成本估算。
- guard 是规则式防护，不是完整语义安全网关。

## 6. 维护规则

- 每完成一个可演示能力，在 §2 增加一行，写清证据与入口。
- 只有能指向代码、测试、指标或 Demo 的条目才算亮点。
- §3 只收有取舍或可量化收益的工程问题，每条能引出至少一个追问。
- 代码位置写到文件或符号，不写易漂移的行号；重构后同步更新链接。
- 页面展示文案与数据以本文件为准；实现页面展示前先更新本文件。
