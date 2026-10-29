import type { AgentEvent } from "@agent-workbench/protocol";
import { describe, expect, it } from "vitest";

import { deriveSpans } from "./derive.js";

function event(
  seq: number,
  ts: number,
  type: AgentEvent["type"],
  payload: unknown,
): AgentEvent {
  return {
    v: 1,
    eventId: `run_span:${seq}`,
    seq,
    runId: "run_span",
    threadId: "thread_span",
    ts,
    type,
    payload,
  } as AgentEvent;
}

const events: AgentEvent[] = [
  event(1, 1000, "run.started", { kind: "release", title: "1.2.0" }),
  event(2, 1010, "stage.started", {
    stageId: "preflight",
    name: "前置检查",
    kind: "preflight",
  }),
  event(3, 1020, "stage.completed", {
    stageId: "preflight",
    status: "success",
    summary: "通过",
  }),
  event(4, 1030, "tool.started", { toolCallId: "tc_1", name: "search_logs" }),
  event(5, 1050, "tool.result", {
    toolCallId: "tc_1",
    status: "success",
    content: "hit",
    durationMs: 20,
  }),
  event(6, 1060, "approval.required", {
    approvalId: "ap_1",
    scope: "stage",
    stageId: "diff",
    title: "批准 diff",
    risk: "high",
    args: {},
  }),
  event(7, 1060, "run.paused", { reason: "approval", approvalId: "ap_1" }),
  event(8, 1100, "approval.resolved", { approvalId: "ap_1", approved: true }),
  event(9, 1100, "run.resumed", {}),
  event(10, 1120, "run.completed", {
    status: "done",
    usage: { inputTokens: 100, outputTokens: 20 },
  }),
];

describe("deriveSpans", () => {
  it("从事件日志派生 run / stage / tool / approval spans", () => {
    const spans = deriveSpans(events);

    expect(spans.map((span) => span.name)).toEqual([
      "agent.run",
      "stage.preflight",
      "tool.search_logs",
      "approval.wait",
    ]);

    const root = spans[0]!;
    expect(root.endTime! - root.startTime).toBe(120);
    expect(root.status).toBe("ok");
    expect(root.attributes.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
    });

    const tool = spans.find((span) => span.name === "tool.search_logs")!;
    expect(tool.startTime).toBe(1030);
    expect(tool.endTime).toBe(1050);
    expect(tool.status).toBe("ok");
    expect(tool.attributes.durationMs).toBe(20);
    expect(tool.parentSpanId).toBe(root.spanId);

    const approval = spans.find((span) => span.name === "approval.wait")!;
    expect(approval.endTime! - approval.startTime).toBe(40);
    expect(approval.attributes.approved).toBe(true);
  });

  it("运行失败时 root span 标记 error", () => {
    const spans = deriveSpans([
      event(1, 1000, "run.started", { kind: "release" }),
      event(2, 1010, "run.failed", {
        code: "x",
        message: "boom",
        retryable: false,
      }),
    ]);

    expect(spans[0]?.status).toBe("error");
  });
});
