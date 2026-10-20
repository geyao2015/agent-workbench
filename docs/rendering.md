# 渲染与性能实现

最后更新：2026-10-20

本文件记录前端渲染实现、增量 Markdown 分段优化与性能数据。阶段划分见 [plan.md](plan.md)，协议契约见 [protocol.md](protocol.md)，渲染目标见 [decision.md §3](decision.md#3-前端三个深挖点)。

## 1. 数据流

SSE → Zod 校验 → 纯函数 reducer → 行级投影 → 虚拟列表。

- reducer 维护消息、block、工具调用等状态
- 长会话按行展开：用户消息、assistant 头、单个 block、引用、状态提示
- `@tanstack/react-virtual` 只挂载视口附近的行，动态测量高度
- 流式时自动跟随底部；用户上滚后停止跟随，发送新消息时恢复

## 2. 增量 Markdown 分段

### 2.1 问题

每个 `text.delta` 都对整条消息重新分段并重建全部 block，复杂度约为 O(增量数 × 当前块数)。10k 块、500 增量时 reducer 约 2.39s。

### 2.2 不变量

- block 闭合后不可变
- 只有最后一个 open block 会继续增长
- 已闭合前缀不需要重新解析

### 2.3 算法

1. 取消息最后一个 block
2. 若为 open，前缀为其余 block，tail 为该 block 的 raw；否则前缀为全部 block，tail 为空
3. 只对 `tail + delta` 分段，`startIndex` 取前缀长度，保持 `${messageId}:bN` 稳定
4. 删除旧 open block，追加新分段，更新 message.text

显式携带 `blockId` 的事件保留原有路径。

### 2.4 流式边界

- 标题行未收到换行时保持 open
- open block 保留单个尾部换行，避免跨增量拼接时行粘连
- 最后一行未收到换行时不按 block 类型切换拆块，避免 `3.` 被截成 `3`

## 3. 正确性

差分测试把 5k 字 fixture 增量喂给 reducer，再对最终全文一次性分段，比较 block ID、index、kind、raw，结果完全一致（58 块）。

## 4. 性能数据

| 场景 | 优化前 | 优化后 |
| --- | --- | --- |
| 10k 块 / 500 增量 reduce | 2,390ms | 528ms |
| 200 增量基准 | 21.98ms | 1.86ms |
| 2000 块分段 | 0.64ms | 0.65ms |

浏览器 10k 块实测：同时挂载约 11–22 个 block，60fps，最大提交约 12ms；JS Heap 约 407MB，主线程阻塞约 3.5%。

## 5. 剩余限制

- 每次增量仍复制 blocks map、blockIds 和完整 message.text
- 单个永不闭合的块或代码围栏会让 tail 持续增长，最坏仍会退化
- 工具调用、reasoning 等复杂块尚未做同等优化
- 开发模式 StrictMode 会重复计数，生产构建数据更准确
