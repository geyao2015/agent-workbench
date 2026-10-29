import { describe, expect, it } from "vitest";

import { RunLog } from "./run-log.js";

function makeLog(): RunLog {
  const log = new RunLog({ runId: "run_log", threadId: "thread_log", kind: "chat" });

  log.append("run.started", { kind: "chat" });
  log.append("message.started", { messageId: "msg_a", role: "assistant" });
  log.append("text.delta", { messageId: "msg_a", delta: "你好" });
  log.finish();

  return log;
}

describe("RunLog", () => {
  it("按 seq 追加事件并生成连续 eventId", () => {
    const log = makeLog();
    const events = log.snapshotEvents();

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.eventId)).toEqual([
      "run_log:1",
      "run_log:2",
      "run_log:3",
    ]);
  });

  it("按 Last-Event-ID 只回放之后的事件", async () => {
    const log = makeLog();
    const replayed: number[] = [];

    for await (const event of log.iterate(log.sequenceAfter("run_log:1"))) {
      replayed.push(event.seq);
    }

    expect(replayed).toEqual([2, 3]);
  });

  it("未知 Last-Event-ID 回退到完整回放", async () => {
    const log = makeLog();
    const replayed: number[] = [];

    for await (const event of log.iterate(log.sequenceAfter("missing"))) {
      replayed.push(event.seq);
    }

    expect(replayed).toEqual([1, 2, 3]);
  });

  it("完成后 iterate 立即结束，不会挂起", async () => {
    const log = makeLog();
    const iterator = log.iterate(3);

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });
});
