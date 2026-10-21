# 术语笔记

最后更新：2026-10-21

个人笔记，用于回顾概念和沟通用词；规范定义以 [protocol.md](protocol.md) 和 [decision.md](decision.md) 为准。

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
- `eventId`：全局唯一；mock 用 `${runId}:${seq}`。
- `seq`：run 内递增，客户端按 seq 应用和去重；`runId` 是执行边界。

## 命名

- 前缀：`run_` / `thread_` / `msg_` / `tc_` / `ap_` / `cit_` / `art_` / `reas_` / `evt_`。
- fixture ID 用「前缀_场景_序号」，保持静态、可回放。
