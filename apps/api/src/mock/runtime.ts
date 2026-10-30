import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AgentEvent, Timing } from "@agent-workbench/protocol";

import type { FixtureDefinition } from "../fixtures.js";

export interface MockRuntime {
  app: Hono;
  owns(runId: string): boolean;
}

export function createMockRuntime(
  getFixtures: () => Map<string, FixtureDefinition>,
): MockRuntime {
  const app = new Hono();

interface MockRun {
  runId: string;
  threadId: string;
  timing: Timing;
  events: AgentEvent[];
  emittedCount: number;
  activeStreams: number;
  cancelRequested: boolean;
  paused: boolean;
  pausedReason: "user" | "approval" | null;
  pauseRequested: boolean;
  awaitingApproval: string | null;
  finished: boolean;
}

const runs = new Map<string, MockRun>();

const MAX_PROMPT_LENGTH = 4000;

function pickRandomChatFixture(): FixtureDefinition | undefined {
  const chatFixtures = [...getFixtures().values()].filter(
    ({ scenario }) => scenario.runKind === "chat",
  );

  if (chatFixtures.length === 0) {
    return undefined;
  }

  return chatFixtures[Math.floor(Math.random() * chatFixtures.length)];
}

function createRunEvents(
  runId: string,
  threadId: string,
  fixture: FixtureDefinition,
  prompt: string,
): AgentEvent[] {
  const userMessageId = `msg_user_${randomUUID()}`;
  const runStarted: AgentEvent = {
    v: 1,
    eventId: "",
    seq: 0,
    runId,
    threadId,
    ts: 0,
    type: "run.started",
    payload: { kind: fixture.scenario.runKind, title: prompt.slice(0, 60) },
  };
  const userEvents: AgentEvent[] = [
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts: 0,
      type: "message.started",
      payload: { messageId: userMessageId, role: "user" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts: 0,
      type: "text.delta",
      payload: { messageId: userMessageId, delta: prompt },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts: 0,
      type: "text.block.completed",
      payload: { messageId: userMessageId, blockId: `${userMessageId}:b0` },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts: 0,
      type: "message.completed",
      payload: { messageId: userMessageId, stopReason: "stop" },
    },
  ];
  const fixtureTail = fixture.events.filter(
    (event, index) => !(index === 0 && event.type === "run.started"),
  );

  return [runStarted, ...userEvents, ...fixtureTail].map(
    (event, index): AgentEvent => ({
      ...event,
      eventId: `${runId}:${index + 1}`,
      seq: index + 1,
      runId,
      threadId,
      ts: 0,
    }),
  );
}

function delayForSeq(timing: Timing, seq: number): number {
  if (timing.mode === "fast") {
    return 0;
  }

  return timing.bySeq?.[String(seq)] ?? timing.defaultMs;
}

function buildCancelledEvent(run: MockRun, atIndex: number): AgentEvent {
  const previous = atIndex > 0 ? run.events[atIndex - 1] : undefined;
  const seq = (previous?.seq ?? 0) + 1;

  return {
    v: 1,
    eventId: `${run.runId}:cancelled:${seq}`,
    seq,
    runId: run.runId,
    threadId: run.threadId,
    ts: Date.now(),
    type: "run.completed",
    payload: { status: "cancelled" },
  };
}

function buildPausedEvent(run: MockRun, atIndex: number): AgentEvent {
  const seq = atIndex + 1;

  return {
    v: 1,
    eventId: `${run.runId}:paused:${seq}`,
    seq,
    runId: run.runId,
    threadId: run.threadId,
    ts: Date.now(),
    type: "run.paused",
    payload: { reason: "user" },
  };
}

function buildResumedEvent(run: MockRun, atIndex: number): AgentEvent {
  const seq = atIndex + 1;

  return {
    v: 1,
    eventId: `${run.runId}:resumed:${seq}`,
    seq,
    runId: run.runId,
    threadId: run.threadId,
    ts: Date.now(),
    type: "run.resumed",
    payload: atIndex > 0 ? { fromSeq: atIndex } : {},
  };
}

function buildApprovalTail(
  run: MockRun,
  toolCallId: string,
  approvalId: string,
  approved: boolean,
  note?: string,
): AgentEvent[] {
  const messageId = `msg_approval_result_${randomUUID()}`;
  const fromSeq = run.events.length;
  const events: AgentEvent[] = [];
  let seq = fromSeq;

  const push = (type: string, payload: unknown) => {
    seq += 1;
    events.push({
      v: 1,
      eventId: `${run.runId}:${seq}`,
      seq,
      runId: run.runId,
      threadId: run.threadId,
      ts: Date.now(),
      type,
      payload,
    } as AgentEvent);
  };

  push("tool.approval_resolved", {
    toolCallId,
    approvalId,
    approved,
    ...(note ? { note } : {}),
  });
  push("run.resumed", { fromSeq });

  if (approved) {
    push("tool.result", {
      toolCallId,
      status: "success",
      content: "已应用补丁：src/checkout/client.ts（3 处冲突）",
      durationMs: 260,
    });
  }

  push("message.started", { messageId, role: "assistant" });
  push("text.delta", {
    messageId,
    delta: approved
      ? "补丁已应用，文件冲突已解决。下一步可以运行冒烟测试。\n"
      : "已跳过补丁应用，文件保持不变。你可以调整冲突解决策略后再试。\n",
  });
  push("message.completed", { messageId, stopReason: "stop" });
  push("run.completed", {
    status: "done",
    usage: { inputTokens: 820, outputTokens: 240 },
  });

  return events;
}

function insertEventAt(run: MockRun, index: number, event: AgentEvent): void {
  const tail = run.events.slice(index).map((existing) => {
    const seq = existing.seq + 1;

    return { ...existing, seq, eventId: `${run.runId}:${seq}` };
  });

  run.events = [...run.events.slice(0, index), event, ...tail];
}

app.post("/api/runs", async (c) => {
  const body = await c.req
    .json<{ prompt?: unknown; fixture?: unknown; threadId?: unknown }>()
    .catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return c.json({ error: "prompt 必填" }, 400);
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return c.json({ error: `prompt 不能超过 ${MAX_PROMPT_LENGTH} 字符` }, 400);
  }

  const requestedFixture =
    typeof body?.fixture === "string" && body.fixture.length > 0
      ? body.fixture
      : undefined;
  const fixture = requestedFixture
    ? getFixtures().get(requestedFixture)
    : pickRandomChatFixture();

  if (!fixture) {
    return c.json(
      { error: requestedFixture ? `未知 fixture：${requestedFixture}` : "没有可用的 Chat fixture" },
      requestedFixture ? 404 : 500,
    );
  }

  const runId = `run_${randomUUID()}`;
  const threadId =
    typeof body?.threadId === "string" && body.threadId.length > 0
      ? body.threadId
      : `thread_${randomUUID()}`;
  const events = createRunEvents(runId, threadId, fixture, prompt);

  runs.set(runId, {
    runId,
    threadId,
    timing: fixture.scenario.timing,
    events,
    emittedCount: 0,
    activeStreams: 0,
    cancelRequested: false,
    paused: false,
    pausedReason: null,
    pauseRequested: false,
    awaitingApproval: null,
    finished: false,
  });

  return c.json({
    runId,
    threadId,
    fixture: fixture.scenario.name,
    kind: fixture.scenario.runKind,
  });
});

app.post("/api/runs/:runId/cancel", (c) => {
  const run = runs.get(c.req.param("runId"));

  if (!run) {
    return c.json({ error: "run 不存在" }, 404);
  }

  if (run.finished) {
    return c.json({ cancelled: false, reason: "finished" });
  }

  run.cancelRequested = true;

  if (run.activeStreams === 0) {
    const cancelled = buildCancelledEvent(run, run.emittedCount);
    run.events = [...run.events.slice(0, run.emittedCount), cancelled];
    run.emittedCount = run.events.length;
    run.paused = false;
    run.pausedReason = null;
    run.awaitingApproval = null;
    run.finished = true;
  }

  return c.json({ cancelled: true });
});

app.post("/api/runs/:runId/pause", (c) => {
  const run = runs.get(c.req.param("runId"));

  if (!run) {
    return c.json({ error: "run 不存在" }, 404);
  }

  if (run.finished) {
    return c.json({ paused: false, reason: "finished" });
  }

  if (run.paused) {
    return c.json({ paused: true });
  }

  run.pauseRequested = true;

  if (run.activeStreams === 0) {
    const paused = buildPausedEvent(run, run.emittedCount);
    insertEventAt(run, run.emittedCount, paused);
    run.emittedCount += 1;
    run.paused = true;
    run.pausedReason = "user";
    run.pauseRequested = false;
  }

  return c.json({ paused: true });
});

app.post("/api/approvals/:approvalId", async (c) => {
  const body = await c.req
    .json<{ approved?: unknown; note?: unknown; runId?: unknown }>()
    .catch(() => null);
  const approved = body?.approved;

  if (typeof approved !== "boolean") {
    return c.json({ error: "approved 必填且为布尔值" }, 400);
  }

  const approvalId = c.req.param("approvalId");
  const requestedRun =
    typeof body?.runId === "string" ? runs.get(body.runId) : undefined;
  const run = requestedRun
    ? requestedRun.awaitingApproval === approvalId
      ? requestedRun
      : undefined
    : [...runs.values()].find(
        (candidate) => candidate.awaitingApproval === approvalId,
      );

  if (!run) {
    return c.json({ error: "审批不存在或已处理" }, 404);
  }

  const approvalEvent = run.events.find(
    (event) =>
      event.type === "tool.approval_required" &&
      event.payload.approvalId === approvalId,
  );

  if (!approvalEvent || approvalEvent.type !== "tool.approval_required") {
    return c.json({ error: "缺少对应的 tool.approval_required 事件" }, 500);
  }

  const note =
    typeof body?.note === "string" && body.note.length > 0 ? body.note : undefined;
  const tail = buildApprovalTail(
    run,
    approvalEvent.payload.toolCallId,
    approvalId,
    approved,
    note,
  );

  run.events = [...run.events, ...tail];
  run.emittedCount = run.events.length;
  run.paused = false;
  run.pausedReason = null;
  run.awaitingApproval = null;

  return c.json({ resolved: true, runId: run.runId, approved });
});

app.get("/api/runs/:runId/events", (c) => {
  const run = runs.get(c.req.param("runId"));

  if (!run) {
    return c.json({ error: "run 不存在" }, 404);
  }

  if (run.paused && run.pausedReason === "user" && !run.finished) {
    const resumed = buildResumedEvent(run, run.emittedCount);
    insertEventAt(run, run.emittedCount, resumed);
    run.emittedCount += 1;
    run.paused = false;
    run.pausedReason = null;
  }

  const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId");
  const lastIndex = lastEventId
    ? run.events.findIndex((event) => event.eventId === lastEventId)
    : -1;
  const startIndex = lastIndex >= 0 ? lastIndex + 1 : 0;

  return streamSSE(c, async (stream) => {
    run.activeStreams += 1;
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    const cancelAt = async (index: number) => {
      const cancelled = buildCancelledEvent(run, index);
      run.events = [...run.events.slice(0, index), cancelled];
      run.emittedCount = index + 1;
      run.paused = false;
      run.pausedReason = null;
      run.awaitingApproval = null;
      run.finished = true;
      await stream.writeSSE({
        id: cancelled.eventId,
        data: JSON.stringify(cancelled),
      });
    };

    const pauseAt = async (index: number) => {
      const paused = buildPausedEvent(run, index);
      insertEventAt(run, index, paused);
      run.emittedCount = index + 1;
      run.paused = true;
      run.pausedReason = "user";
      run.pauseRequested = false;
      await stream.writeSSE({
        id: paused.eventId,
        data: JSON.stringify(paused),
      });
    };

    try {
      let index = startIndex;

      while (true) {
        if (closed) {
          return;
        }

        if (run.cancelRequested && !run.finished) {
          await cancelAt(index);
          return;
        }

        if (run.pauseRequested && !run.paused && !run.finished) {
          await pauseAt(index);
          return;
        }

        const event = run.events[index];

        if (!event) {
          return;
        }

        const delay = delayForSeq(run.timing, event.seq);

        if (delay > 0) {
          await stream.sleep(delay);
        }

        if (closed) {
          return;
        }

        if (run.cancelRequested && !run.finished) {
          await cancelAt(index);
          return;
        }

        if (run.pauseRequested && !run.paused && !run.finished) {
          await pauseAt(index);
          return;
        }

        const approvalPause =
          event.type === "run.paused" && event.payload.reason === "approval";

        if (approvalPause) {
          run.paused = true;
          run.pausedReason = "approval";
          run.awaitingApproval = event.payload.approvalId ?? null;
        }

        await stream.writeSSE({
          id: event.eventId,
          data: JSON.stringify({ ...event, ts: Date.now() }),
        });
        run.emittedCount = Math.max(run.emittedCount, index + 1);
        index += 1;

        if (event.type === "run.completed" || event.type === "run.failed") {
          run.finished = true;
          return;
        }

        if (approvalPause) {
          return;
        }
      }
    } finally {
      run.activeStreams = Math.max(0, run.activeStreams - 1);
    }
  });
});

  return { app, owns: (runId) => runs.has(runId) };
}
