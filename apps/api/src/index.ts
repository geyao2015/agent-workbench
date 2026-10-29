import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";

import type { AgentEvent, Timing } from "@agent-workbench/protocol";

import { createAgentApi } from "./agent-api.js";
import { createChatAgent } from "./agent/graph.js";
import { loadRuntimeConfig, publicRuntimeInfo } from "./config.js";
import { loadFixtures, watchFixtures } from "./fixtures.js";
import type { FixtureDefinition } from "./fixtures.js";
import { KnowledgeBase } from "./kb/index.js";
import { RunManager } from "./runs/run-manager.js";
import { ThreadStore } from "./runs/thread-store.js";

try {
  process.loadEnvFile();
} catch {
  // 没有 .env 时继续使用进程环境变量
}

const config = (() => {
  try {
    return loadRuntimeConfig();
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  }
})();

const port = config.port;
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const hasWebBuild = existsSync(webDist);
let fixtures = loadFixtures();

watchFixtures(() => {
  try {
    fixtures = loadFixtures();
    console.log(`Reloaded fixtures: ${[...fixtures.keys()].join(", ")}`);
  } catch (cause) {
    console.error("fixture 重载失败", cause);
  }
});

const kb = KnowledgeBase.load(config.docsDir);
const agentRuntime = (() => {
  if (config.mode !== "agent") {
    return undefined;
  }

  const threads = new ThreadStore(config.storeDir);
  const agent = createChatAgent(config, kb);
  const runs = new RunManager({ agent, kb, store: threads });

  return { threads, runs };
})();

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
const LONG_CONVERSATION_FIXTURE = "chat-large-nodes";
const LONG_CONVERSATION_TURNS = 100;

interface DemoRunPayload {
  runId: string;
  events: AgentEvent[];
}

interface DemoThreadPayload {
  threadId: string;
  runs: DemoRunPayload[];
}

function pickRandomChatFixture(): FixtureDefinition | undefined {
  const chatFixtures = [...fixtures.values()].filter(
    ({ scenario }) => scenario.runKind === "chat",
  );

  if (chatFixtures.length === 0) {
    return undefined;
  }

  return chatFixtures[Math.floor(Math.random() * chatFixtures.length)];
}

function buildDemoTurn(
  threadId: string,
  chunk: string,
  index: number,
  total: number,
): DemoRunPayload {
  const runId = `run_demo_${randomUUID()}`;
  const userMessageId = `msg_demo_user_${index + 1}`;
  const assistantMessageId = `msg_demo_assistant_${index + 1}`;
  const prompt = `继续展开第 ${index + 1} 组节点。`;
  const ts = Date.now() - (total - index) * 30_000;
  const events: AgentEvent[] = [
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "run.started",
      payload: { kind: "chat", title: prompt },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.started",
      payload: { messageId: userMessageId, role: "user" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.delta",
      payload: { messageId: userMessageId, delta: prompt },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.block.completed",
      payload: { messageId: userMessageId, blockId: `${userMessageId}:b0` },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.completed",
      payload: { messageId: userMessageId, stopReason: "stop" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.started",
      payload: { messageId: assistantMessageId, role: "assistant" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.delta",
      payload: { messageId: assistantMessageId, delta: chunk },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "citation.added",
      payload: {
        messageId: assistantMessageId,
        citationId: `cit_demo_${index + 1}`,
        sourceId: "doc_engineering_wiki",
        title: "长会话测试数据",
      },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.block.completed",
      payload: {
        messageId: assistantMessageId,
        blockId: `${assistantMessageId}:b0`,
      },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.completed",
      payload: { messageId: assistantMessageId, stopReason: "stop" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "run.completed",
      payload: {
        status: "done",
        usage: { inputTokens: 300, outputTokens: 200 },
      },
    },
  ];

  return {
    runId,
    events: events.map((event, eventIndex) => ({
      ...event,
      eventId: `${runId}:${eventIndex + 1}`,
      seq: eventIndex + 1,
    })),
  };
}

function createLongConversationDemo(): DemoThreadPayload {
  const fixture = fixtures.get(LONG_CONVERSATION_FIXTURE);

  if (!fixture) {
    throw new Error(`缺少 fixture：${LONG_CONVERSATION_FIXTURE}`);
  }

  const chunks = fixture.events.flatMap((event) =>
    event.type === "text.delta" ? [event.payload.delta] : [],
  );

  if (chunks.length === 0) {
    throw new Error(`fixture 中没有可用的 text.delta：${LONG_CONVERSATION_FIXTURE}`);
  }

  const chunksPerTurn = Math.max(
    1,
    Math.ceil(chunks.length / LONG_CONVERSATION_TURNS),
  );
  const turns: string[] = [];

  for (let index = 0; index < chunks.length; index += chunksPerTurn) {
    turns.push(chunks.slice(index, index + chunksPerTurn).join(""));
  }

  const threadId = `thread_${randomUUID()}`;

  return {
    threadId,
    runs: turns.map((chunk, index) =>
      buildDemoTurn(threadId, chunk, index, turns.length),
    ),
  };
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

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "agent-workbench-api",
    runtime: config.mode,
    message:
      config.mode === "agent"
        ? "Hono agent runtime is running."
        : "Hono mock runtime is running. hello world!",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/runtime", (c) =>
  c.json({
    ...publicRuntimeInfo(config),
    docs: kb.list().length,
  }),
);

if (agentRuntime) {
  app.route(
    "/",
    createAgentApi({
      runs: agentRuntime.runs,
      threads: agentRuntime.threads,
      kb,
    }),
  );
}

app.get("/api/scenarios", (c) =>
  c.json({
    scenarios: [...fixtures.values()].map(({ scenario }) => ({
      name: scenario.name,
      description: scenario.description,
      runKind: scenario.runKind,
    })),
  }),
);

app.post("/api/demo/long-conversation", (c) => {
  try {
    return c.json(createLongConversationDemo());
  } catch (cause) {
    return c.json(
      { error: cause instanceof Error ? cause.message : "生成长会话失败" },
      500,
    );
  }
});

// mock 运行时：fixture 回放，保留 M1 的暂停、审批与断线重放语义
if (config.mode === "mock") {
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
    ? fixtures.get(requestedFixture)
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
}
// end mock 运行时路由

if (hasWebBuild) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  console.log(
    config.mode === "agent"
      ? `Runtime: agent (${config.provider}/${config.model}) · KB ${kb.list().length} docs`
      : `Runtime: mock · ${fixtures.size} fixtures`,
  );
  console.log(
    hasWebBuild
      ? `Serving web from ${webDist}`
      : "web/dist not found; run `pnpm build` for single-URL mode",
  );
});
