import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent } from "@agent-workbench/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { KnowledgeBase } from "../kb/index.js";
import { RunLog } from "../runs/run-log.js";
import type { ActiveRun } from "../runs/run-registry.js";
import { ApprovalRegistry } from "./approvals.js";
import { ArtifactStore } from "./artifacts.js";
import type { ConflictResolver } from "./conflict.js";
import { DeterministicConflictResolver } from "./conflict.js";
import { resolveFiles } from "./diff.js";
import { ReleaseRuntime } from "./runtime.js";
import { loadReleaseScenarios } from "./scenario.js";

const releasesDir = fileURLToPath(
  new URL("../../../../data/releases", import.meta.url),
);
const docsDir = fileURLToPath(
  new URL("../../../../data/docs", import.meta.url),
);
const scenario = loadReleaseScenarios(releasesDir)[0];
const kb = KnowledgeBase.load(docsDir);

if (!scenario) {
  throw new Error("缺少 release 场景");
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeHarness(
  conflictResolver: ConflictResolver = new DeterministicConflictResolver(),
) {
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
    conflictResolver,
    kb,
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
  it("批准两次后完成失败 RCA 与重跑链路并生成 audit", async () => {
    const { runtime, log, artifacts, approvals } = makeHarness();
    const execution = runtime.execute();

    await waitFor(
      () =>
        log.snapshotEvents().filter((event) => event.type === "approval.required")
          .length >= 1,
    );

    const firstApproval = log
      .snapshotEvents()
      .find((event) => event.type === "approval.required");

    if (!firstApproval || firstApproval.type !== "approval.required") {
      throw new Error("缺少第一次 approval.required");
    }

    approvals.resolve(firstApproval.payload.approvalId, {
      approved: true,
      note: "同意",
    });

    await waitFor(
      () =>
        log.snapshotEvents().filter((event) => event.type === "approval.required")
          .length >= 2,
    );

    const approvalsRequired = log
      .snapshotEvents()
      .filter((event) => event.type === "approval.required");
    const secondApproval = approvalsRequired[1];

    if (!secondApproval || secondApproval.type !== "approval.required") {
      throw new Error("缺少第二次 approval.required");
    }

    expect(secondApproval.payload.stageId).toBe("fix");
    approvals.resolve(secondApproval.payload.approvalId, {
      approved: true,
      note: "修复方案同意",
    });

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
    const toolNames = events.flatMap((event) =>
      event.type === "tool.started" ? [event.payload.name] : [],
    );

    expect(completed?.payload.status).toBe("done");
    expect(stages.map((stage) => stage.stageId)).toEqual([
      "preflight",
      "conflict",
      "diff",
      "test.1",
      "rca",
      "fix",
      "test.2",
      "notes",
      "tag",
      "audit",
    ]);
    expect(stages.find((stage) => stage.stageId === "test.1")?.status).toBe(
      "error",
    );
    expect(stages.find((stage) => stage.stageId === "rca")?.status).toBe(
      "success",
    );
    expect(stages.find((stage) => stage.stageId === "test.2")?.status).toBe(
      "success",
    );
    expect(artifactsCreated.map((artifact) => artifact.kind)).toEqual([
      "diff",
      "log_bundle",
      "document",
      "release_notes",
      "document",
    ]);
    expect(toolNames).toEqual(["search_logs", "get_log_context", "search_kb"]);

    const rca = artifactsCreated.find(
      (artifact) => artifact.kind === "document" && artifact.stageId === "rca",
    );

    if (!rca) {
      throw new Error("缺少 RCA artifact");
    }

    const rcaContent = artifacts.read("run_release", rca.artifactId);
    const rcaBody = JSON.parse(rcaContent?.body ?? "{}") as {
      rootCause: string;
      evidence: unknown[];
      runbook?: { sourceId: string };
    };

    expect(rcaBody.rootCause).toContain("payment_conflict");
    expect(rcaBody.evidence).toHaveLength(3);
    expect(rcaBody.runbook?.sourceId).toBe("incident-042-payment-callback");

    const audit = artifactsCreated.find(
      (artifact) => artifact.kind === "document" && artifact.stageId === "audit",
    );

    if (!audit) {
      throw new Error("缺少 audit artifact");
    }

    const content = artifacts.read("run_release", audit.artifactId);
    const body = JSON.parse(content?.body ?? "{}") as {
      approvals: Array<{ approved: boolean; stageId: string }>;
    };

    expect(body.approvals).toHaveLength(2);
    expect(body.approvals.map((approval) => approval.stageId)).toEqual([
      "diff",
      "fix",
    ]);
    expect(body.approvals.every((approval) => approval.approved)).toBe(true);
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

  it("LLM 回退时在 diff artifact 与阶段摘要中记录原因", async () => {
    const resolver: ConflictResolver = {
      resolve: async ({ scenario: input }) => ({
        files: resolveFiles(input.files),
        mode: "fallback",
        fallbackReason: "LLM timeout",
        latencyMs: 12,
      }),
    };
    const { runtime, log, artifacts, approvals } = makeHarness(resolver);
    const execution = runtime.execute();

    await waitFor(() =>
      log.snapshotEvents().some((event) => event.type === "approval.required"),
    );

    const approval = findEvent(log.snapshotEvents(), "approval.required");

    if (!approval) {
      throw new Error("缺少 approval.required");
    }

    approvals.resolve(approval.payload.approvalId, { approved: true });

    await waitFor(
      () =>
        log.snapshotEvents().filter((event) => event.type === "approval.required")
          .length >= 2,
    );

    const second = log
      .snapshotEvents()
      .filter((event) => event.type === "approval.required")[1];

    if (!second || second.type !== "approval.required") {
      throw new Error("缺少修复审批");
    }

    approvals.resolve(second.payload.approvalId, { approved: true });
    await execution;
    log.finish();

    const events = log.snapshotEvents();
    const diff = events.find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "diff",
    );
    const conflictStage = events.find(
      (event) =>
        event.type === "stage.completed" &&
        event.payload.stageId === "conflict",
    );

    if (!diff || diff.type !== "artifact.created") {
      throw new Error("缺少 diff artifact");
    }

    const content = artifacts.read("run_release", diff.payload.artifactId);
    const body = JSON.parse(content?.body ?? "{}") as {
      resolution?: { mode: string; fallbackReason?: string };
    };

    expect(body.resolution?.mode).toBe("fallback");
    expect(body.resolution?.fallbackReason).toContain("timeout");
    expect(
      conflictStage?.type === "stage.completed" &&
        conflictStage.payload.summary,
    ).toContain("确定性回退");
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
