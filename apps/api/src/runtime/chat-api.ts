import { Hono } from "hono";

import type { KnowledgeBase } from "../kb/index.js";
import type { MockRuntime } from "../mock/runtime.js";
import type { ThreadStore } from "../runs/thread-store.js";
import { RuntimeSwitchError, type RuntimeController } from "./controller.js";

export interface ChatApiDeps {
  controller: RuntimeController;
  threads: ThreadStore;
  kb: KnowledgeBase;
  agentApi: Hono;
  mock: MockRuntime;
  docs: number;
  releases: number;
}

export function createChatApi(deps: ChatApiDeps): Hono {
  const app = new Hono();

  const runtimeInfo = () => ({
    ...deps.controller.info(),
    docs: deps.docs,
    releases: deps.releases,
  });

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

  app.get("/api/runtime", (c) => c.json(runtimeInfo()));

  app.post("/api/runtime", async (c) => {
    const body = await c.req
      .json<{ mode?: unknown; modelId?: unknown }>()
      .catch(() => null);

    try {
      const info = deps.controller.setSelection({
        mode: typeof body?.mode === "string" ? body.mode : "",
        ...(typeof body?.modelId === "string" && body.modelId.length > 0
          ? { modelId: body.modelId }
          : {}),
      });

      return c.json({
        ...info,
        docs: deps.docs,
        releases: deps.releases,
      });
    } catch (cause) {
      if (cause instanceof RuntimeSwitchError) {
        return c.json(
          { error: cause.message, code: cause.code },
          cause.code === "agent_unavailable" ? 409 : 400,
        );
      }

      throw cause;
    }
  });

  app.post("/api/runs", (c) =>
    deps.controller.snapshot().mode === "agent"
      ? deps.agentApi.fetch(c.req.raw)
      : deps.mock.app.fetch(c.req.raw),
  );

  app.post("/api/runs/:runId/cancel", (c) => ownerOf(c.req.param("runId")).fetch(c.req.raw));

  app.get("/api/runs/:runId/events", (c) => ownerOf(c.req.param("runId")).fetch(c.req.raw));

  app.get("/api/runs/:runId/spans", (c) => ownerOf(c.req.param("runId")).fetch(c.req.raw));

  app.post("/api/runs/:runId/pause", (c) =>
    deps.mock.owns(c.req.param("runId"))
      ? deps.mock.app.fetch(c.req.raw)
      : c.json({ error: "run 不存在" }, 404),
  );

  app.post("/api/approvals/:approvalId", (c) => deps.mock.app.fetch(c.req.raw));

  function ownerOf(runId: string): Hono {
    return deps.mock.owns(runId) ? deps.mock.app : deps.agentApi;
  }

  return app;
}
