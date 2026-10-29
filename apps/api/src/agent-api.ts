import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { KnowledgeBase } from "./kb/index.js";
import type { RunManager } from "./runs/run-manager.js";
import type { ThreadStore } from "./runs/thread-store.js";

const MAX_PROMPT_LENGTH = 4000;
const MAX_THREAD_ID_LENGTH = 120;

export interface AgentApiDeps {
  runs: RunManager;
  threads: ThreadStore;
  kb: KnowledgeBase;
}

export function createAgentApi(deps: AgentApiDeps): Hono {
  const app = new Hono();

  app.get("/api/kb/docs", (c) => c.json({ docs: deps.kb.list() }));

  app.get("/api/threads", (c) => c.json({ threads: deps.threads.list() }));

  app.get("/api/threads/:threadId/runs", (c) => {
    const cursor = c.req.query("cursor") ?? undefined;
    const limit = Number(c.req.query("limit") ?? 20);
    const page = deps.threads.page(
      c.req.param("threadId"),
      cursor,
      Number.isFinite(limit) ? limit : undefined,
    );

    if (!page) {
      return c.json({ error: "会话不存在" }, 404);
    }

    return c.json(page);
  });

  app.post("/api/runs", async (c) => {
    const body = await c.req
      .json<{ prompt?: unknown; threadId?: unknown }>()
      .catch(() => null);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return c.json({ error: "prompt 必填" }, 400);
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return c.json({ error: `prompt 不能超过 ${MAX_PROMPT_LENGTH} 字符` }, 400);
    }

    const threadId =
      typeof body?.threadId === "string" && body.threadId.length > 0
        ? body.threadId
        : undefined;

    if (threadId && threadId.length > MAX_THREAD_ID_LENGTH) {
      return c.json({ error: "threadId 过长" }, 400);
    }

    if (threadId && deps.runs.hasActiveRun(threadId)) {
      return c.json({ error: "该会话已有进行中的 run" }, 409);
    }

    const run = deps.runs.createChatRun({ prompt, threadId });

    return c.json({
      runId: run.runId,
      threadId: run.threadId,
      kind: run.kind,
    });
  });

  app.post("/api/runs/:runId/cancel", (c) => {
    const run = deps.runs.get(c.req.param("runId"));

    if (!run) {
      return c.json({ error: "run 不存在" }, 404);
    }

    return c.json({ cancelled: deps.runs.cancel(run.runId) });
  });

  app.get("/api/runs/:runId/events", (c) => {
    const run = deps.runs.get(c.req.param("runId"));

    if (!run) {
      return c.json({ error: "run 不存在" }, 404);
    }

    const lastEventId =
      c.req.header("last-event-id") ?? c.req.query("lastEventId");
    const afterSeq = run.log.sequenceAfter(lastEventId);

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      for await (const event of run.log.iterate(afterSeq, abort.signal)) {
        await stream.writeSSE({
          id: event.eventId,
          data: JSON.stringify(event),
        });
      }
    });
  });

  return app;
}
