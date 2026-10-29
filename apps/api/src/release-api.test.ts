import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent } from "@agent-workbench/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createReleaseApi } from "./release-api.js";
import { ApprovalRegistry } from "./release/approvals.js";
import { ArtifactStore } from "./release/artifacts.js";
import { DeterministicConflictResolver } from "./release/conflict.js";
import { ReleaseService } from "./release/runtime.js";
import { loadReleaseScenarios } from "./release/scenario.js";
import { RunRegistry } from "./runs/run-registry.js";
import { ThreadStore } from "./runs/thread-store.js";

const releasesDir = fileURLToPath(
  new URL("../../../data/releases", import.meta.url),
);
const scenarios = loadReleaseScenarios(releasesDir);
const tempDirs: string[] = [];

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "aw-release-api-"));
  tempDirs.push(dir);

  const threads = new ThreadStore(dir);
  const registry = new RunRegistry(threads);
  const artifacts = new ArtifactStore(join(dir, "artifacts"));
  const approvals = new ApprovalRegistry();
  const release = new ReleaseService({
    registry,
    scenarios,
    artifacts,
    approvals,
    conflictResolver: new DeterministicConflictResolver(),
  });
  const app = createReleaseApi({
    release,
    registry,
    approvals,
    artifacts,
    threads,
  });

  return { app, threads };
}

async function getEvents(app: ReturnType<typeof makeApp>["app"], runId: string) {
  const response = await app.request(`/api/releases/runs/${runId}/events.json`);
  const data = (await response.json()) as { events: AgentEvent[] };

  return data.events;
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 1500,
): Promise<void> {
  const startedAt = Date.now();

  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("release API", () => {
  it("创建、暂停审批、拒绝同 thread 并发、完成并读取 artifact", async () => {
    const { app } = makeApp();
    const createResponse = await app.request("/api/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread_release_api" }),
    });
    const created = (await createResponse.json()) as {
      runId: string;
      threadId: string;
      kind: string;
    };

    expect(createResponse.status).toBe(200);
    expect(created.kind).toBe("release");

    await waitFor(async () =>
      (await getEvents(app, created.runId)).some(
        (event) => event.type === "approval.required",
      ),
    );

    const pausedEvents = await getEvents(app, created.runId);
    const approval = pausedEvents.find(
      (event) => event.type === "approval.required",
    );

    if (!approval || approval.type !== "approval.required") {
      throw new Error("缺少 approval.required");
    }

    const conflict = await app.request("/api/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: "thread_release_api" }),
    });

    expect(conflict.status).toBe(409);

    const resolveResponse = await app.request(
      `/api/releases/approvals/${approval.payload.approvalId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, note: "同意" }),
      },
    );

    expect(resolveResponse.status).toBe(200);

    await waitFor(async () =>
      (await getEvents(app, created.runId)).some(
        (event) => event.type === "run.completed",
      ),
    );

    const events = await getEvents(app, created.runId);
    const diff = events.find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "diff",
    );

    if (!diff || diff.type !== "artifact.created" || !diff.payload.uri) {
      throw new Error("缺少 diff artifact");
    }

    const artifactResponse = await app.request(diff.payload.uri);
    const artifact = (await artifactResponse.json()) as {
      mime: string;
      body: string;
    };

    expect(artifactResponse.status).toBe(200);
    expect(artifact.mime).toBe("application/json");
    expect(artifact.body).toContain("diff --git");

    const threadsResponse = await app.request("/api/releases/threads");
    const threads = (await threadsResponse.json()) as {
      threads: Array<{ kind: string; title: string }>;
    };

    expect(threads.threads[0]?.kind).toBe("release");
  });
});
