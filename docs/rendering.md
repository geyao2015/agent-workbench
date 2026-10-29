# 渲染与性能实现

最后更新：2026-10-29

本文件记录前端渲染实现、增量 Markdown 分段优化与性能数据。阶段划分见 [plan.md](plan.md)，协议契约见 [protocol.md](protocol.md)，渲染目标见 [decision.md §3](decision.md#3-前端三个深挖点)。

## 1. 数据流

SSE → Zod 校验 → 纯函数 reducer → 行级投影 → 虚拟列表。

- reducer 维护消息、block、工具调用等状态
- 长会话按行展开：用户消息、assistant 头、单个 block、引用、状态提示
- `@tanstack/react-virtual` 只挂载视口附近的行，动态测量高度
- 流式时自动跟随底部；用户上滚后停止跟随，发送新消息时恢复

### 虚拟列表选型

- 自研的真正成本不在算可见区间，而在行高动态变化：流式中代码高亮完成、表格换行、工具卡从运行中展开都会改变高度，视口上方的行变化还必须做滚动补偿，否则内容会跳动
- `@tanstack/react-virtual` 已提供逐行 ResizeObserver 测量缓存、滚动补偿、二分查找可见区间；这些是它的主要价值，`overscan` 和 `getItemKey` 只是配置
- headless：只接管定位与测量，不侵入 `ChatRowView` 的 DOM、样式与 memo 边界
- 不用 react-window：`VariableSizeList` 需要预先给定行高，不适合流式未知高度
- 贴底跟随、首末行留白、`Profiler` 埋点仍由 `ChatFeed` 自己实现，没有交给库

## 2. 工具与引用的渲染边界

- assistant 文本、代码、表格等静态内容按 Markdown block 渲染
- 工具调用、审批、reasoning、阶段、artifact 等有生命周期或交互的内容作为独立时间线行，由 AgentEvent 投影，不进入 Markdown AST
- 引用等只读、轻量信息可以内联到 Markdown；当前以消息底部的可展开来源行展示，保留 `title / sourceId / locator`
- 不执行模型输出中的 MDX、JSX 或原始 HTML；需要内联结构化内容时只接受受控占位符，并映射到事件状态
- 工具卡片内部可以用 Markdown 渲染结果预览

### 卡片容器

- `AgentCard` 统一头部、状态、内容、操作与底栏；工具、审批、reasoning 及后续异构内容（音视频、PDF、流程卡）复用同一容器
- 时间线按 `startedAtSeq` 合并消息与工具调用，保证同一 run 内文本与工具卡片正确交错
- 工具卡片由 `ToolCallState` 投影：参数半截到达时尝试容错解析并展示部分结构，解析失败回退原文；`tool.ready` 后展示结构化参数，结果与耗时来自 `tool.result`
- 审批作为工具卡片底栏，由 `ApprovalState` 投影；决定通过 `POST /api/approvals/:approvalId` 追加 `tool.approval_resolved` / `run.resumed` 事件，客户端按 `lastEventId` 恢复，前端状态不作为事实源；当前审批链路只在 mock 模式演示，M3 接入真实审批
- 运行错误由 `RunState.errors` 投影为时间线错误行，区分局部错误与致命错误；工具错误仍留在工具卡内

选择理由：

- 工具参数会半截到达，状态会多次变化，审批还会中断和恢复；Markdown 只适合静态文本
- 事件日志是唯一状态源，卡片必须从 reducer 投影，才能回放和断线恢复
- 避免模型输出直接注入组件，减少 XSS 与 prompt injection 风险
- 独立行可以复用虚拟化和 memo，嵌入 Markdown 会破坏块冻结与更新粒度

## 3. 增量 Markdown 分段

### 3.1 问题

每个 `text.delta` 都对整条消息重新分段并重建全部 block，复杂度约为 O(增量数 × 当前块数)。10k 块、500 增量时 reducer 约 2.39s。

### 3.2 不变量

- block 闭合后不可变
- 只有最后一个 open block 会继续增长
- 已闭合前缀不需要重新解析

### 3.3 算法

1. 取消息最后一个 block
2. 若为 open，前缀为其余 block，tail 为该 block 的 raw；否则前缀为全部 block，tail 为空
3. 只对 `tail + delta` 分段，`startIndex` 取前缀长度，保持 `${messageId}:bN` 稳定
4. 删除旧 open block，追加新分段，更新 message.text

显式携带 `blockId` 的事件保留原有路径。

### 3.4 流式边界

- 标题行未收到换行时保持 open
- open block 保留单个尾部换行，避免跨增量拼接时行粘连
- 最后一行未收到换行时不按 block 类型切换拆块，避免 `3.` 被截成 `3`

## 4. 正确性

差分测试把 5k 字 fixture 增量喂给 reducer，再对最终全文一次性分段，比较 block ID、index、kind、raw，结果完全一致（58 块）。

## 5. 性能数据

| 场景 | 优化前 | 优化后（2026-10-20 复测） |
| --- | --- | --- |
| 10k 块 / 500 增量 reduce | 2,390ms | 513.76ms |
| 200 增量基准 | 21.98ms | 1.81ms |
| 2000 块分段 | 0.64ms | 0.66ms |

| 总块数 / 增量 | reducer | 首 token | 实际挂载块 | FPS | JS Heap |
| --- | --- | --- | --- | --- | --- |
| 200 / 50 | 2ms | 58ms | 200 | 60 | 11.0MB |
| 2000 / 100 | 23ms | 56ms | 889 | 60 | 22.8MB |
| 10000 / 500 | 511ms | 35ms | 2207 | 60 | 54.9MB |

上表为 2026-10-29 生产构建、1280×900 mock 运行时，`data/bench/streaming.jsonl` 定义规模；`pnpm bench:streaming` 生成 fixture 并写 `data/bench/results.json`。10k 场景仅挂载约 22% 的块。复现：`pnpm build && PORT=8788 pnpm start`，另开终端 `BENCH_BASE_URL=http://localhost:8788 pnpm bench:streaming`；开发模式 StrictMode 会重复计数，不作为基准。

## 6. 剩余限制

- 每次增量仍复制 blocks map、blockIds 和完整 message.text
- 单个永不闭合的块或代码围栏会让 tail 持续增长，最坏仍会退化
- 工具调用、reasoning 等复杂块尚未做同等优化
- 开发模式 StrictMode 会重复计数；生产构建下 Profiler 不提供提交耗时，FPS 与内存更准确
