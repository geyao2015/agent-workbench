import { Hono } from "hono";

import type { RunManager } from "./runs/run-manager.js";
import { streamRunEvents } from "./runs/sse.js";
import { deriveSpans } from "./spans/derive.js";

const MAX_PROMPT_LENGTH = 4000;
const MAX_THREAD_ID_LENGTH = 120;

export interface AgentApiDeps {
  runs: RunManager;
}

export function createAgentApi(deps: AgentApiDeps): Hono {
  const app = new Hono();

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

    return streamRunEvents(c, run);
  });

  app.get("/api/runs/:runId/spans", (c) => {
    const run = deps.runs.get(c.req.param("runId"));

    if (!run) {
      return c.json({ error: "run 不存在" }, 404);
    }

    return c.json({ spans: deriveSpans(run.log.snapshotEvents()) });
  });

  return app;
}
