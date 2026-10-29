import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent } from "@agent-workbench/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { RunLog } from "../runs/run-log.js";
import type { ActiveRun } from "../runs/run-registry.js";
import { ApprovalRegistry } from "./approvals.js";
import { ArtifactStore } from "./artifacts.js";
import { ReleaseRuntime } from "./runtime.js";
import { loadReleaseScenarios } from "./scenario.js";

const releasesDir = fileURLToPath(
  new URL("../../../../data/releases", import.meta.url),
);
const scenario = loadReleaseScenarios(releasesDir)[0];

if (!scenario) {
  throw new Error("缺少 release 场景");
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), "aw-release-"));
  tempDirs.push(dir);

  const log = new RunLog({
    runId: "run_release",
    threadId: "thread_release",
    kind: "release",
  });
  log.append("run.started", { kind: "release", title: "1.2.0 发版" });

  const run: ActiveRun = {
    runId: "run_release",
    threadId: "thread_release",
    kind: "release",
    title: "1.2.0 发版",
    createdAt: 1,
    log,
  };
  const artifacts = new ArtifactStore(dir);
  const approvals = new ApprovalRegistry();
  const controller = new AbortController();
  const runtime = new ReleaseRuntime({
    run,
    scenario,
    artifacts,
    approvals,
    signal: controller.signal,
    checkpoint: () => {},
  });

  return { runtime, log, artifacts, approvals, controller };
}

function findEvent<T extends AgentEvent["type"]>(
  events: readonly AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }> | undefined {
  return events.find(
    (event): event is Extract<AgentEvent, { type: T }> => event.type === type,
  );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ReleaseRuntime", () => {
  it("批准后完成确定性主链路并生成 audit", async () => {
    const { runtime, log, artifacts, approvals } = makeHarness();
    const execution = runtime.execute();

    await waitFor(() =>
      log.snapshotEvents().some((event) => event.type === "approval.required"),
    );

    const approval = findEvent(log.snapshotEvents(), "approval.required");

    if (!approval) {
      throw new Error("缺少 approval.required");
    }

    expect(approvals.resolve(approval.payload.approvalId, { approved: true, note: "同意" })).toBe(true);
    await execution;
    log.finish();

    const events = log.snapshotEvents();
    const completed = findEvent(events, "run.completed");
    const stages = events.flatMap((event) =>
      event.type === "stage.completed" ? [event.payload] : [],
    );
    const artifactsCreated = events.flatMap((event) =>
      event.type === "artifact.created" ? [event.payload] : [],
    );

    expect(completed?.payload.status).toBe("done");
    expect(stages.map((stage) => stage.stageId)).toEqual([
      "preflight",
      "conflict",
      "diff",
      "test.1",
      "notes",
      "tag",
      "audit",
    ]);
    expect(stages.every((stage) => stage.status === "success")).toBe(true);
    expect(artifactsCreated.map((artifact) => artifact.kind)).toEqual([
      "diff",
      "release_notes",
      "document",
    ]);

    const audit = artifactsCreated.find((artifact) => artifact.kind === "document");

    if (!audit) {
      throw new Error("缺少 audit artifact");
    }

    const content = artifacts.read("run_release", audit.artifactId);

    expect(content?.mime).toBe("application/json");

    const body = JSON.parse(content?.body ?? "{}") as {
      approvals: Array<{ approved: boolean }>;
    };

    expect(body.approvals[0]?.approved).toBe(true);
  });

  it("拒绝审批后跳过 diff、执行 audit 并取消 run", async () => {
    const { runtime, log, approvals } = makeHarness();
    const execution = runtime.execute();

    await waitFor(() =>
      log.snapshotEvents().some((event) => event.type === "approval.required"),
    );

    const approval = findEvent(log.snapshotEvents(), "approval.required");

    if (!approval) {
      throw new Error("缺少 approval.required");
    }

    approvals.resolve(approval.payload.approvalId, { approved: false });
    await execution;
    log.finish();

    const events = log.snapshotEvents();
    const completed = findEvent(events, "run.completed");
    const diffStage = events.find(
      (event) =>
        event.type === "stage.completed" && event.payload.stageId === "diff",
    );
    const auditArtifact = events.find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "document",
    );

    expect(completed?.payload.status).toBe("cancelled");
    expect(diffStage?.type === "stage.completed" && diffStage.payload.status).toBe(
      "skipped",
    );
    expect(auditArtifact).toBeDefined();
  });

  it("等待审批时取消，run 以 cancelled 结束", async () => {
    const { runtime, log, controller } = makeHarness();
    const execution = runtime.execute();

    await waitFor(() =>
      log.snapshotEvents().some((event) => event.type === "approval.required"),
    );

    controller.abort();
    await execution;
    log.finish();

    const completed = findEvent(log.snapshotEvents(), "run.completed");

    expect(completed?.payload.status).toBe("cancelled");
  });
});
