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

import { loadFixtures } from "./fixtures.js";

const port = Number(process.env.PORT ?? 8787);
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const hasWebBuild = existsSync(webDist);
const fixtures = loadFixtures();

interface MockRun {
  runId: string;
  threadId: string;
  timing: Timing;
  events: AgentEvent[];
  emittedCount: number;
  activeStreams: number;
  cancelRequested: boolean;
  paused: boolean;
  pauseRequested: boolean;
  finished: boolean;
}

const runs = new Map<string, MockRun>();

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
    message: "Hono mock runtime is running. hello world!",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/scenarios", (c) =>
  c.json({
    scenarios: [...fixtures.values()].map(({ scenario }) => ({
      name: scenario.name,
      description: scenario.description,
      runKind: scenario.runKind,
    })),
  }),
);

app.post("/api/runs", async (c) => {
  const body = await c.req.json<{ fixture?: unknown }>().catch(() => null);
  const fixtureName = body?.fixture;

  if (typeof fixtureName !== "string" || fixtureName.length === 0) {
    return c.json({ error: "fixture 必填" }, 400);
  }

  const fixture = fixtures.get(fixtureName);

  if (!fixture) {
    return c.json({ error: `未知 fixture：${fixtureName}` }, 404);
  }

  const runId = `run_${randomUUID()}`;
  const threadId = `thread_${randomUUID()}`;
  const events = fixture.events.map((event) => ({
    ...event,
    runId,
    threadId,
    eventId: `${runId}:${event.seq}`,
  }));

  runs.set(runId, {
    runId,
    threadId,
    timing: fixture.scenario.timing,
    events,
    emittedCount: 0,
    activeStreams: 0,
    cancelRequested: false,
    paused: false,
    pauseRequested: false,
    finished: false,
  });

  return c.json({ runId, threadId, fixture: fixtureName, kind: fixture.scenario.runKind });
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
    run.pauseRequested = false;
  }

  return c.json({ paused: true });
});

app.get("/api/runs/:runId/events", (c) => {
  const run = runs.get(c.req.param("runId"));

  if (!run) {
    return c.json({ error: "run 不存在" }, 404);
  }

  if (run.paused && !run.finished) {
    const resumed = buildResumedEvent(run, run.emittedCount);
    insertEventAt(run, run.emittedCount, resumed);
    run.emittedCount += 1;
    run.paused = false;
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
      }
    } finally {
      run.activeStreams = Math.max(0, run.activeStreams - 1);
    }
  });
});

if (hasWebBuild) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  console.log(`Loaded ${fixtures.size} fixtures: ${[...fixtures.keys()].join(", ")}`);
  console.log(
    hasWebBuild
      ? `Serving web from ${webDist}`
      : "web/dist not found; run `pnpm build` for single-URL mode",
  );
});
