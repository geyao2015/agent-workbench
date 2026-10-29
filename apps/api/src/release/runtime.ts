import { randomUUID } from "node:crypto";

import type { Risk } from "@agent-workbench/protocol";

import type { ActiveRun, RunRegistry } from "../runs/run-registry.js";
import type { ApprovalRegistry } from "./approvals.js";
import type { ArtifactStore } from "./artifacts.js";
import { buildDiffArtifact } from "./diff.js";
import type {
  AuditArtifactBody,
  ReleaseScenario,
  ReleaseStage,
} from "./types.js";

function abortError(): Error {
  const error = new Error("release run 已取消");
  error.name = "AbortError";
  return error;
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

export class ReleaseRuntime {
  private readonly approvalsUsed: AuditArtifactBody["approvals"] = [];
  private readonly artifactsUsed: AuditArtifactBody["artifacts"] = [];
  private readonly stagesUsed: AuditArtifactBody["stages"] = [];
  private rejected = false;
  private pendingApprovalId: string | null = null;

  constructor(
    private readonly deps: {
      run: ActiveRun;
      scenario: ReleaseScenario;
      artifacts: ArtifactStore;
      approvals: ApprovalRegistry;
      signal: AbortSignal;
      checkpoint: () => void;
    },
  ) {}

  async execute(): Promise<void> {
    const { run, signal } = this.deps;
    const log = run.log;

    try {
      for (const stage of this.deps.scenario.stages) {
        if (this.rejected) {
          break;
        }

        this.throwIfAborted();
        await this.runStage(stage);
        this.deps.checkpoint();
      }

      if (this.rejected) {
        const audit = this.deps.scenario.stages.find(
          (stage) => stage.kind === "audit",
        );

        if (audit) {
          await this.runStage(audit);
        }

        log.append("run.completed", { status: "cancelled" });
        return;
      }

      log.append("run.completed", { status: "done" });
    } catch (cause) {
      if (signal.aborted || isAbortError(cause)) {
        this.cancelPendingApproval();
        log.append("run.completed", { status: "cancelled" });
        return;
      }

      log.append("run.failed", {
        code: "release_stage_failed",
        message: cause instanceof Error ? cause.message : "Release 阶段执行失败",
        retryable: false,
      });
    } finally {
      this.deps.approvals.clearRun(run.runId);
    }
  }

  private async runStage(stage: ReleaseStage): Promise<void> {
    this.throwIfAborted();
    this.deps.run.log.append("stage.started", {
      stageId: stage.id,
      name: stage.name,
      kind: stage.kind,
    });
    this.deps.checkpoint();

    switch (stage.kind) {
      case "preflight": {
        this.completeStage(stage, "success", stage.summary ?? "前置检查通过");
        return;
      }

      case "conflict_resolve": {
        await this.resolveConflicts(stage);
        return;
      }

      case "diff_approval": {
        await this.requestApproval(stage);
        return;
      }

      case "test": {
        this.runTest(stage);
        return;
      }

      case "release_notes": {
        this.writeReleaseNotes(stage);
        return;
      }

      case "dry_run_tag": {
        this.completeStage(
          stage,
          "success",
          `dry-run tag ${this.deps.scenario.tag} 已创建（模拟）`,
        );
        return;
      }

      case "audit": {
        this.writeAudit(stage);
        return;
      }

      default: {
        throw new Error(`未知 Release 阶段：${String(stage.kind)}`);
      }
    }
  }

  private async resolveConflicts(stage: ReleaseStage): Promise<void> {
    const diff = buildDiffArtifact(this.deps.scenario.files);
    const artifactId = `art_diff_${randomUUID()}`;
    const info = this.deps.artifacts.write(this.deps.run.runId, artifactId, {
      mime: "application/json",
      body: JSON.stringify(diff, null, 2),
    });

    this.deps.run.log.append("artifact.created", {
      artifactId,
      kind: "diff",
      title: `${this.deps.scenario.version} 冲突 diff`,
      mime: info.mime,
      size: info.size,
      uri: info.uri,
      stageId: stage.id,
    });
    this.artifactsUsed.push({
      artifactId,
      kind: "diff",
      title: `${this.deps.scenario.version} 冲突 diff`,
    });

    const hunkCount = this.deps.scenario.files.reduce(
      (count, file) => count + file.hunks.length,
      0,
    );

    this.completeStage(
      stage,
      "success",
      `解决 ${this.deps.scenario.files.length} 个文件 / ${hunkCount} 个冲突`,
    );
  }

  private async requestApproval(stage: ReleaseStage): Promise<void> {
    const approvalId = `ap_${randomUUID()}`;
    const log = this.deps.run.log;
    const risk: Risk = stage.risk ?? "high";

    log.append("approval.required", {
      approvalId,
      scope: "stage",
      stageId: stage.id,
      title: `批准${stage.name}`,
      description: stage.description,
      risk,
      args: {
        files: this.deps.scenario.files.map((file) => file.path),
        version: this.deps.scenario.version,
      },
    });
    log.append("run.paused", { reason: "approval", approvalId });
    this.pendingApprovalId = approvalId;
    this.deps.checkpoint();

    const decision = await this.deps.approvals.wait(
      approvalId,
      this.deps.run.runId,
      this.deps.signal,
    );

    if (!decision) {
      throw abortError();
    }

    this.pendingApprovalId = null;
    log.append("approval.resolved", {
      approvalId,
      approved: decision.approved,
      ...(decision.note ? { note: decision.note } : {}),
    });
    this.approvalsUsed.push({
      approvalId,
      stageId: stage.id,
      approved: decision.approved,
      ...(decision.note ? { note: decision.note } : {}),
    });
    log.append("run.resumed", {});

    if (!decision.approved) {
      this.rejected = true;
      this.completeStage(stage, "skipped", "审批拒绝，停止发版");
      return;
    }

    this.completeStage(stage, "success", "已批准并应用");
  }

  private runTest(stage: ReleaseStage): void {
    const attempt = this.deps.scenario.ciAttempts[stage.id] ?? {
      status: "success" as const,
      summary: "测试通过",
    };

    if (attempt.status === "error") {
      this.completeStage(stage, "error", attempt.summary);
      throw new Error(attempt.summary);
    }

    this.completeStage(stage, "success", attempt.summary);
  }

  private writeReleaseNotes(stage: ReleaseStage): void {
    const body = this.deps.scenario.notesTemplate.replaceAll(
      "{{version}}",
      this.deps.scenario.version,
    );
    const artifactId = `art_notes_${randomUUID()}`;
    const title = `${this.deps.scenario.version} Release Notes`;
    const info = this.deps.artifacts.write(this.deps.run.runId, artifactId, {
      mime: "text/markdown",
      body,
    });

    this.deps.run.log.append("artifact.created", {
      artifactId,
      kind: "release_notes",
      title,
      mime: info.mime,
      size: info.size,
      uri: info.uri,
      stageId: stage.id,
    });
    this.artifactsUsed.push({ artifactId, kind: "release_notes", title });
    this.completeStage(stage, "success", "Release Notes 已生成");
  }

  private writeAudit(stage: ReleaseStage): void {
    const body: AuditArtifactBody = {
      version: this.deps.scenario.version,
      runId: this.deps.run.runId,
      stages: [
        ...this.stagesUsed,
        {
          id: stage.id,
          name: stage.name,
          status: "success",
          summary: "审计记录已生成",
        },
      ],
      approvals: this.approvalsUsed,
      artifacts: this.artifactsUsed,
      completedAt: new Date().toISOString(),
    };
    const artifactId = `art_audit_${randomUUID()}`;
    const title = `${this.deps.scenario.version} 发版审计记录`;
    const info = this.deps.artifacts.write(this.deps.run.runId, artifactId, {
      mime: "application/json",
      body: JSON.stringify(body, null, 2),
    });

    this.deps.run.log.append("artifact.created", {
      artifactId,
      kind: "document",
      title,
      mime: info.mime,
      size: info.size,
      uri: info.uri,
      stageId: stage.id,
    });
    this.artifactsUsed.push({ artifactId, kind: "document", title });
    this.completeStage(stage, "success", "审计记录已生成");
  }

  private cancelPendingApproval(): void {
    if (!this.pendingApprovalId) {
      return;
    }

    const approvalId = this.pendingApprovalId;
    this.pendingApprovalId = null;

    this.deps.run.log.append("approval.resolved", {
      approvalId,
      approved: false,
      note: "run cancelled",
    });
  }

  private completeStage(
    stage: ReleaseStage,
    status: "success" | "error" | "skipped",
    summary: string,
  ): void {
    this.deps.run.log.append("stage.completed", {
      stageId: stage.id,
      status,
      summary,
    });
    this.stagesUsed.push({
      id: stage.id,
      name: stage.name,
      status,
      summary,
    });
    this.deps.checkpoint();
  }

  private throwIfAborted(): void {
    if (this.deps.signal.aborted) {
      throw abortError();
    }
  }
}

export class ScenarioNotFoundError extends Error {
  constructor(scenarioId: string) {
    super(`未找到 Release 场景：${scenarioId}`);
    this.name = "ScenarioNotFoundError";
  }
}

export class ReleaseService {
  private readonly scenarios: ReleaseScenario[];

  constructor(
    private readonly deps: {
      registry: RunRegistry;
      scenarios: ReleaseScenario[];
      artifacts: ArtifactStore;
      approvals: ApprovalRegistry;
    },
  ) {
    this.scenarios = deps.scenarios;
  }

  listScenarios(): Array<{
    id: string;
    title: string;
    service: string;
    version: string;
    branch: string;
    stageCount: number;
  }> {
    return this.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      service: scenario.service,
      version: scenario.version,
      branch: scenario.branch,
      stageCount: scenario.stages.length,
    }));
  }

  start(input: { scenarioId?: string; threadId?: string }): ActiveRun {
    const scenario = input.scenarioId
      ? this.scenarios.find((candidate) => candidate.id === input.scenarioId)
      : this.scenarios[0];

    if (!scenario) {
      throw new ScenarioNotFoundError(input.scenarioId ?? "default");
    }

    const { run, signal } = this.deps.registry.begin({
      kind: "release",
      title: `${scenario.title} · ${scenario.service}`,
      threadId: input.threadId,
    });

    void this.execute(run, scenario, signal);

    return run;
  }

  private async execute(
    run: ActiveRun,
    scenario: ReleaseScenario,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const runtime = new ReleaseRuntime({
        run,
        scenario,
        artifacts: this.deps.artifacts,
        approvals: this.deps.approvals,
        signal,
        checkpoint: () => this.deps.registry.persist(run),
      });

      await runtime.execute();
    } catch (cause) {
      const last = run.log.lastEvent;

      if (
        last?.type !== "run.completed" &&
        last?.type !== "run.failed" &&
        !run.log.isFinished
      ) {
        run.log.append("run.failed", {
          code: "release_runtime_error",
          message: cause instanceof Error ? cause.message : "Release 运行时异常",
          retryable: false,
        });
      }
    } finally {
      this.deps.approvals.clearRun(run.runId);
      this.deps.registry.finish(run);
      this.deps.registry.persist(run);
    }
  }
}
