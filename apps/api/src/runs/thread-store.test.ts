import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@agent-workbench/protocol";

import { afterEach, describe, expect, it } from "vitest";

import { ThreadStore, type StoredRun } from "./thread-store.js";

const tempDirs: string[] = [];

function makeStore(): { store: ThreadStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "aw-threads-"));
  tempDirs.push(dir);

  return { store: new ThreadStore(dir), dir };
}

function buildRun(
  threadId: string,
  runId: string,
  prompt: string,
  answer: string,
  createdAt: number,
): StoredRun {
  const base = { v: 1 as const, runId, threadId, ts: createdAt };
  const events: AgentEvent[] = [
    {
      ...base,
      eventId: `${runId}:1`,
      seq: 1,
      type: "run.started",
      payload: { kind: "chat", title: prompt },
    },
    {
      ...base,
      eventId: `${runId}:2`,
      seq: 2,
      type: "message.started",
      payload: { messageId: `${runId}:u`, role: "user" },
    },
    {
      ...base,
      eventId: `${runId}:3`,
      seq: 3,
      type: "text.delta",
      payload: { messageId: `${runId}:u`, delta: prompt },
    },
    {
      ...base,
      eventId: `${runId}:4`,
      seq: 4,
      type: "message.completed",
      payload: { messageId: `${runId}:u`, stopReason: "stop" },
    },
    {
      ...base,
      eventId: `${runId}:5`,
      seq: 5,
      type: "message.started",
      payload: { messageId: `${runId}:a`, role: "assistant" },
    },
    {
      ...base,
      eventId: `${runId}:6`,
      seq: 6,
      type: "text.delta",
      payload: { messageId: `${runId}:a`, delta: answer },
    },
    {
      ...base,
      eventId: `${runId}:7`,
      seq: 7,
      type: "message.completed",
      payload: { messageId: `${runId}:a`, stopReason: "stop" },
    },
    {
      ...base,
      eventId: `${runId}:8`,
      seq: 8,
      type: "run.completed",
      payload: { status: "done" },
    },
  ];

  return { runId, kind: "chat", title: prompt, createdAt, events };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ThreadStore", () => {
  it("从最新一轮向前分页返回物化快照", () => {
    const { store } = makeStore();
    const threadId = "thread_test";

    store.ensure(threadId, "1.2.0 发版");

    for (let index = 0; index < 5; index += 1) {
      store.saveRun(
        threadId,
        buildRun(
          threadId,
          `run_${index}`,
          `问题 ${index}`,
          `回答 ${index}`,
          index,
        ),
      );
    }

    const latest = store.page(threadId, undefined, 2);

    expect(latest?.runs.map((run) => run.runId)).toEqual(["run_3", "run_4"]);
    expect(latest?.nextCursor).toBe("3");

    const earlier = store.page(threadId, latest?.nextCursor ?? undefined, 2);

    expect(earlier?.runs.map((run) => run.runId)).toEqual(["run_1", "run_2"]);
    expect(earlier?.nextCursor).toBe("1");

    const first = store.page(threadId, earlier?.nextCursor ?? undefined, 2);

    expect(first?.runs.map((run) => run.runId)).toEqual(["run_0"]);
    expect(first?.nextCursor).toBeNull();
  });

  it("列表返回标题、消息数与最后一条回答预览", () => {
    const { store } = makeStore();

    store.ensure("thread_a", "INC-042 根因");
    store.saveRun(
      "thread_a",
      buildRun("thread_a", "run_a", "为什么重试？", "因为 409 被误判为可重试。", 10),
    );

    const [summary] = store.list();

    expect(summary?.threadId).toBe("thread_a");
    expect(summary?.title).toBe("INC-042 根因");
    expect(summary?.messageCount).toBe(2);
    expect(summary?.preview).toBe("因为 409 被误判为可重试。");
  });

  it("重启后从磁盘恢复会话", () => {
    const { store, dir } = makeStore();

    store.ensure("thread_persist", "持久化");
    store.saveRun(
      "thread_persist",
      buildRun("thread_persist", "run_p", "问题", "回答", 1),
    );

    const reloaded = new ThreadStore(dir);
    const page = reloaded.page("thread_persist");

    expect(page?.runs[0]?.messages["run_p:a"]?.text).toBe("回答");
    expect(reloaded.historyMessages("thread_persist")).toEqual([
      { role: "user", text: "问题" },
      { role: "assistant", text: "回答" },
    ]);
  });
});
