import { randomUUID } from "node:crypto";

import type { Risk } from "@agent-workbench/protocol";

import type { KnowledgeBase } from "../kb/index.js";
import type { RuntimeSelection } from "../runtime/controller.js";
import type { ActiveRun, RunRegistry } from "../runs/run-registry.js";
import type { ApprovalRegistry } from "./approvals.js";
import type { ArtifactStore } from "./artifacts.js";
import type { ConflictResolver } from "./conflict.js";
import { buildDiffArtifact } from "./diff.js";
import {
  findEvidence,
  formatLogHits,
  getLogContext,
  searchLogs,
} from "./logs.js";
import type {
  AuditArtifactBody,
  RcaArtifactBody,
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
  private testFailed = false;
  private toolSeq = 0;

  constructor(
    private readonly deps: {
      run: ActiveRun;
      scenario: ReleaseScenario;
      artifacts: ArtifactStore;
      approvals: ApprovalRegistry;
      conflictResolver: ConflictResolver;
      kb: KnowledgeBase;
      stages: ReleaseStage[];
      mode: "release" | "rollback";
      targetTag?: string;
      signal: AbortSignal;
      checkpoint: () => void;
    },
  ) {}

  async execute(): Promise<void> {
    const { run, signal } = this.deps;
    const log = run.log;

    try {
      for (const stage of this.deps.stages) {
        if (this.rejected) {
          break;
        }

        this.throwIfAborted();
        await this.runStage(stage);
        this.deps.checkpoint();
      }

      if (this.rejected) {
        const audit = this.deps.stages.find((stage) => stage.kind === "audit");

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

      case "rca": {
        await this.analyzeFailure(stage);
        return;
      }

      case "fix_approval": {
        if (!this.testFailed) {
          this.completeStage(stage, "skipped", "测试通过，无需修复审批");
          return;
        }

        await this.requestApproval(stage);
        return;
      }

      case "rollback_preflight": {
        this.completeStage(
          stage,
          "success",
          `目标 tag ${this.deps.targetTag ?? "unknown"}，当前版本 ${this.deps.scenario.version}`,
        );
        return;
      }

      case "rollback_approval": {
        await this.requestApproval(stage);
        return;
      }

      case "rollback_execute": {
        this.executeRollback(stage);
        return;
      }

      case "rollback_verify": {
        this.completeStage(
          stage,
          "success",
          "健康检查通过，支付成功率恢复到基线",
        );
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
    const resolution = await this.deps.conflictResolver.resolve({
      scenario: this.deps.scenario,
      signal: this.deps.signal,
    });
    const diff = buildDiffArtifact(this.deps.scenario.files, resolution);
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
    const modeLabel =
      resolution.mode === "llm"
        ? "LLM"
        : resolution.mode === "fallback"
          ? "确定性回退"
          : "确定性";
    const fallbackSuffix = resolution.fallbackReason
      ? `（回退原因：${resolution.fallbackReason.slice(0, 120)}）`
      : "";

    console.info(
      `[release] conflict resolution mode=${resolution.mode} latency=${resolution.latencyMs ?? 0}ms${resolution.fallbackReason ? ` fallback=${resolution.fallbackReason}` : ""}`,
    );

    this.completeStage(
      stage,
      "success",
      `${modeLabel}解决 ${this.deps.scenario.files.length} 个文件 / ${hunkCount} 个冲突${fallbackSuffix}`,
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
      this.testFailed = true;
      this.completeStage(stage, "error", attempt.summary);
      this.writeLogBundle(stage);

      if (stage.id !== "test.1") {
        throw new Error(attempt.summary);
      }

      return;
    }

    this.completeStage(stage, "success", attempt.summary);
  }

  private writeLogBundle(stage: ReleaseStage): void {
    const body = Object.entries(this.deps.scenario.logs)
      .map(([file, content]) => `===== ${file} =====\n${content.trim()}`)
      .join("\n\n");
    const artifactId = `art_logs_${randomUUID()}`;
    const title = `${this.deps.scenario.version} 测试日志`;
    const info = this.deps.artifacts.write(this.deps.run.runId, artifactId, {
      mime: "text/plain",
      body,
    });

    this.deps.run.log.append("artifact.created", {
      artifactId,
      kind: "log_bundle",
      title,
      mime: info.mime,
      size: info.size,
      uri: info.uri,
      stageId: stage.id,
    });
    this.artifactsUsed.push({ artifactId, kind: "log_bundle", title });
  }

  private async analyzeFailure(stage: ReleaseStage): Promise<void> {
    if (!this.testFailed) {
      this.completeStage(stage, "skipped", "测试未失败，跳过 RCA");
      return;
    }

    const { rca, logs } = this.deps.scenario;
    const searchHits = searchLogs(logs, rca.runbookQuery, 6);
    this.emitTool(
      "search_logs",
      { query: rca.runbookQuery },
      formatLogHits(searchHits),
      8,
    );

    const evidence = findEvidence(logs, rca.evidence);
    const first = evidence[0];

    if (first) {
      this.emitTool(
        "get_log_context",
        { file: first.file, line: first.line, radius: 2 },
        formatLogHits(getLogContext(logs, first.file, first.line, 2)),
        6,
      );
    }

    const runbookHits = this.deps.kb.search(rca.runbookQuery, 4);
    const runbook = runbookHits[0];
    const runbookText =
      runbookHits.length > 0
        ? runbookHits
            .map(
              (hit, index) =>
                `[${index + 1}] sourceId=${hit.sourceId} | ${hit.locator}\n${hit.snippet}`,
            )
            .join("\n\n")
        : "知识库未命中相关 runbook。";

    this.emitTool(
      "search_kb",
      { query: rca.runbookQuery },
      runbookText,
      5,
    );

    const body: RcaArtifactBody = {
      incidentId: rca.incidentId,
      version: this.deps.scenario.version,
      rootCause: rca.rootCause,
      fix: rca.fix,
      confidence: rca.confidence,
      evidence,
      ...(runbook
        ? {
            runbook: {
              sourceId: runbook.sourceId,
              title: runbook.title,
              locator: runbook.locator,
            },
          }
        : {}),
      generatedAt: new Date().toISOString(),
    };
    const artifactId = `art_rca_${randomUUID()}`;
    const title = `${this.deps.scenario.version} 根因分析`;
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

    this.completeStage(
      stage,
      "success",
      `定位 ${rca.incidentId} 根因，命中 ${evidence.length} 条证据`,
    );
  }

  private emitTool(
    name: string,
    args: Record<string, unknown>,
    content: string,
    durationMs: number,
  ): void {
    const toolCallId = `tc_rca_${this.toolSeq}`;
    this.toolSeq += 1;
    const log = this.deps.run.log;

    log.append("tool.started", { toolCallId, name });
    log.append("tool.args.delta", {
      toolCallId,
      delta: JSON.stringify(args),
    });
    log.append("tool.ready", { toolCallId, args });
    log.append("tool.result", {
      toolCallId,
      status: "success",
      content,
      durationMs,
    });
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

  private executeRollback(stage: ReleaseStage): void {
    const targetTag = this.deps.targetTag ?? "unknown";
    const body = JSON.stringify(
      {
        version: this.deps.scenario.version,
        targetTag,
        steps: [
          `停止 ${this.deps.scenario.version} 的新流量`,
          `切回 ${targetTag} 镜像`,
          "保留向后兼容的数据库迁移",
          "验证健康检查与支付成功率",
        ],
        simulated: true,
      },
      null,
      2,
    );
    const artifactId = `art_rollback_${randomUUID()}`;
    const title = `${this.deps.scenario.version} 回滚计划`;
    const info = this.deps.artifacts.write(this.deps.run.runId, artifactId, {
      mime: "application/json",
      body,
    });

    this.deps.run.log.append("artifact.created", {
      artifactId,
      kind: "plan",
      title,
      mime: info.mime,
      size: info.size,
      uri: info.uri,
      stageId: stage.id,
    });
    this.artifactsUsed.push({ artifactId, kind: "plan", title });
    this.completeStage(stage, "success", `已切回 ${targetTag}（模拟）`);
  }

  private writeAudit(stage: ReleaseStage): void {
    const body: AuditArtifactBody = {
      version: this.deps.scenario.version,
      runId: this.deps.run.runId,
      mode: this.deps.mode,
      ...(this.deps.run.parentRunId
        ? { parentRunId: this.deps.run.parentRunId }
        : {}),
      ...(this.deps.targetTag ? { targetTag: this.deps.targetTag } : {}),
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
    const title =
      this.deps.mode === "rollback"
        ? `${this.deps.scenario.version} 回滚审计记录`
        : `${this.deps.scenario.version} 发版审计记录`;
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

export interface ReleaseRuntimeSource {
  snapshot(): RuntimeSelection;
  resolveConflictResolver(selection: RuntimeSelection): ConflictResolver;
}

export class ReleaseService {
  private readonly scenarios: ReleaseScenario[];

  constructor(
    private readonly deps: {
      registry: RunRegistry;
      scenarios: ReleaseScenario[];
      artifacts: ArtifactStore;
      approvals: ApprovalRegistry;
      runtime: ReleaseRuntimeSource;
      kb: KnowledgeBase;
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

  start(input: {
    scenarioId?: string;
    threadId?: string;
    sourceRunId?: string;
  }): ActiveRun {
    const scenario = input.scenarioId
      ? this.scenarios.find((candidate) => candidate.id === input.scenarioId)
      : this.scenarios[0];

    if (!scenario) {
      throw new ScenarioNotFoundError(input.scenarioId ?? "default");
    }

    const selection = this.deps.runtime.snapshot();
    const { run, signal } = this.deps.registry.begin({
      kind: "release",
      title: `${scenario.title} · ${scenario.service}`,
      threadId: input.threadId,
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      runtime: {
        mode: selection.mode,
        ...(selection.provider ? { provider: selection.provider } : {}),
        ...(selection.model ? { model: selection.model } : {}),
      },
    });

    void this.execute(run, scenario, signal, selection);

    return run;
  }

  startRollback(input: { parentRunId: string; scenarioId?: string }): ActiveRun {
    const scenario = input.scenarioId
      ? this.scenarios.find((candidate) => candidate.id === input.scenarioId)
      : this.scenarios[0];

    if (!scenario) {
      throw new ScenarioNotFoundError(input.scenarioId ?? "default");
    }

    const selection = this.deps.runtime.snapshot();
    const { run, signal } = this.deps.registry.begin({
      kind: "release",
      title: `回滚 ${scenario.version} → ${scenario.rollback.targetTag}`,
      parentRunId: input.parentRunId,
      runtime: {
        mode: selection.mode,
        ...(selection.provider ? { provider: selection.provider } : {}),
        ...(selection.model ? { model: selection.model } : {}),
      },
    });

    void this.executeRuntime(
      run,
      scenario,
      signal,
      scenario.rollback.stages,
      "rollback",
      selection,
      scenario.rollback.targetTag,
    );

    return run;
  }

  private async execute(
    run: ActiveRun,
    scenario: ReleaseScenario,
    signal: AbortSignal,
    selection: RuntimeSelection,
  ): Promise<void> {
    await this.executeRuntime(
      run,
      scenario,
      signal,
      scenario.stages,
      "release",
      selection,
    );
  }

  private async executeRuntime(
    run: ActiveRun,
    scenario: ReleaseScenario,
    signal: AbortSignal,
    stages: ReleaseScenario["stages"],
    mode: "release" | "rollback",
    selection: RuntimeSelection,
    targetTag?: string,
  ): Promise<void> {
    try {
      const runtime = new ReleaseRuntime({
        run,
        scenario,
        artifacts: this.deps.artifacts,
        approvals: this.deps.approvals,
        conflictResolver: this.deps.runtime.resolveConflictResolver(selection),
        kb: this.deps.kb,
        stages,
        mode,
        ...(targetTag ? { targetTag } : {}),
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
