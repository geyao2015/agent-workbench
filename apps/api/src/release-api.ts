import { Hono } from "hono";

import type { ApprovalRegistry } from "./release/approvals.js";
import type { ArtifactStore } from "./release/artifacts.js";
import {
  ReleaseService,
  ScenarioNotFoundError,
} from "./release/runtime.js";
import { RunRegistry, ThreadBusyError } from "./runs/run-registry.js";
import { streamRunEvents } from "./runs/sse.js";
import type { ThreadStore } from "./runs/thread-store.js";

const MAX_THREAD_ID_LENGTH = 120;

export interface ReleaseApiDeps {
  release: ReleaseService;
  registry: RunRegistry;
  approvals: ApprovalRegistry;
  artifacts: ArtifactStore;
  threads: ThreadStore;
}

export function createReleaseApi(deps: ReleaseApiDeps): Hono {
  const app = new Hono();

  app.get("/api/releases/scenarios", (c) =>
    c.json({ scenarios: deps.release.listScenarios() }),
  );

  app.get("/api/releases/threads", (c) =>
    c.json({ threads: deps.threads.list({ kind: "release" }) }),
  );

  app.get("/api/releases/threads/:threadId/runs", (c) => {
    const cursor = c.req.query("cursor") ?? undefined;
    const limit = Number(c.req.query("limit") ?? 20);
    const page = deps.threads.page(
      c.req.param("threadId"),
      cursor,
      Number.isFinite(limit) ? limit : undefined,
    );

    if (!page) {
      return c.json({ error: "Release 会话不存在" }, 404);
    }

    return c.json(page);
  });

  app.post("/api/releases", async (c) => {
    const body = await c.req
      .json<{ scenarioId?: unknown; threadId?: unknown }>()
      .catch(() => null);
    const scenarioId =
      typeof body?.scenarioId === "string" && body.scenarioId.length > 0
        ? body.scenarioId
        : undefined;
    const threadId =
      typeof body?.threadId === "string" && body.threadId.length > 0
        ? body.threadId
        : undefined;

    if (threadId && threadId.length > MAX_THREAD_ID_LENGTH) {
      return c.json({ error: "threadId 过长" }, 400);
    }

    if (threadId && deps.registry.hasActiveRun(threadId)) {
      return c.json({ error: "该会话已有进行中的 run" }, 409);
    }

    try {
      const run = deps.release.start({ scenarioId, threadId });

      return c.json({
        runId: run.runId,
        threadId: run.threadId,
        kind: run.kind,
      });
    } catch (cause) {
      if (cause instanceof ScenarioNotFoundError) {
        return c.json({ error: cause.message }, 404);
      }

      if (cause instanceof ThreadBusyError) {
        return c.json({ error: cause.message }, 409);
      }

      throw cause;
    }
  });

  app.post("/api/releases/runs/:runId/rollback", async (c) => {
    const parentRunId = c.req.param("runId");
    const active = deps.registry.get(parentRunId);
    const stored = active
      ? active.log.snapshotEvents()
      : deps.threads.findRun(parentRunId)?.events;

    if (!stored) {
      return c.json({ error: "Release run 不存在" }, 404);
    }

    const started = stored.find((event) => event.type === "run.started");

    if (
      started?.type === "run.started" &&
      started.payload.title?.startsWith("回滚 ")
    ) {
      return c.json({ error: "回滚 run 不支持再次回滚" }, 409);
    }

    const last = stored.at(-1);

    if (last?.type !== "run.completed" || last.payload.status !== "done") {
      return c.json({ error: "只有成功完成的 run 可以回滚" }, 409);
    }

    const body = await c.req
      .json<{ scenarioId?: unknown }>()
      .catch(() => null);
    const scenarioId =
      typeof body?.scenarioId === "string" && body.scenarioId.length > 0
        ? body.scenarioId
        : undefined;

    try {
      const run = deps.release.startRollback({ parentRunId, scenarioId });

      return c.json({
        runId: run.runId,
        threadId: run.threadId,
        kind: run.kind,
        parentRunId,
      });
    } catch (cause) {
      if (cause instanceof ScenarioNotFoundError) {
        return c.json({ error: cause.message }, 404);
      }

      throw cause;
    }
  });

  app.post("/api/releases/runs/:runId/cancel", (c) => {
    const run = deps.registry.get(c.req.param("runId"));

    if (!run) {
      return c.json({ error: "Release run 不存在" }, 404);
    }

    return c.json({ cancelled: deps.registry.cancel(run.runId) });
  });

  app.get("/api/releases/runs/:runId/events", (c) => {
    const run = deps.registry.get(c.req.param("runId"));

    if (!run) {
      return c.json({ error: "Release run 不存在" }, 404);
    }

    return streamRunEvents(c, run);
  });

  app.get("/api/releases/runs/:runId/events.json", (c) => {
    const runId = c.req.param("runId");
    const active = deps.registry.get(runId);
    const events = active
      ? active.log.snapshotEvents()
      : deps.threads.findRun(runId)?.events;

    if (!events) {
      return c.json({ error: "Release run 不存在" }, 404);
    }

    return c.json({ runId, events });
  });

  app.post("/api/releases/approvals/:approvalId", async (c) => {
    const body = await c.req
      .json<{ approved?: unknown; note?: unknown }>()
      .catch(() => null);

    if (typeof body?.approved !== "boolean") {
      return c.json({ error: "approved 必填且为布尔值" }, 400);
    }

    const note =
      typeof body?.note === "string" && body.note.length > 0
        ? body.note
        : undefined;
    const resolved = deps.approvals.resolve(c.req.param("approvalId"), {
      approved: body.approved,
      ...(note ? { note } : {}),
    });

    if (!resolved) {
      return c.json({ error: "审批不存在或已处理" }, 404);
    }

    return c.json({ resolved: true, approved: body.approved });
  });

  app.get("/api/releases/runs/:runId/artifacts/:artifactId", (c) => {
    const content = deps.artifacts.read(
      c.req.param("runId"),
      c.req.param("artifactId"),
    );

    if (!content) {
      return c.json({ error: "artifact 不存在" }, 404);
    }

    return c.json(content);
  });

  return app;
}
