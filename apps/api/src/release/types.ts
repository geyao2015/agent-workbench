import type { Risk } from "@agent-workbench/protocol";

export type ReleaseStageKind =
  | "preflight"
  | "conflict_resolve"
  | "diff_approval"
  | "test"
  | "rca"
  | "fix_approval"
  | "release_notes"
  | "dry_run_tag"
  | "rollback_preflight"
  | "rollback_approval"
  | "rollback_execute"
  | "rollback_verify"
  | "audit";

export interface ReleaseStage {
  id: string;
  kind: ReleaseStageKind;
  name: string;
  summary?: string;
  risk?: Risk;
  description?: string;
}

export interface ReleaseHunk {
  id: string;
  base: string;
  ours: string;
  theirs: string;
  recommended: string;
  rationale: string;
}

export interface ReleaseFile {
  path: string;
  hunks: ReleaseHunk[];
}

export interface CiAttempt {
  status: "success" | "error";
  summary: string;
  durationMs?: number;
  logFile?: string;
}

export interface ReleaseRcaConfig {
  incidentId: string;
  rootCause: string;
  fix: string;
  confidence: "low" | "medium" | "high";
  evidence: string[];
  runbookQuery: string;
}

export interface LogHit {
  file: string;
  line: number;
  text: string;
}

export interface RcaArtifactBody {
  incidentId: string;
  version: string;
  rootCause: string;
  fix: string;
  confidence: "low" | "medium" | "high";
  evidence: LogHit[];
  runbook?: {
    sourceId: string;
    title: string;
    locator: string;
  };
  generatedAt: string;
}

export interface ReleaseScenario {
  id: string;
  title: string;
  service: string;
  version: string;
  branch: string;
  tag: string;
  conflictContext: string;
  stages: ReleaseStage[];
  files: ReleaseFile[];
  ciAttempts: Record<string, CiAttempt>;
  logs: Record<string, string>;
  rca: ReleaseRcaConfig;
  rollback: {
    targetTag: string;
    stages: ReleaseStage[];
  };
  notesTemplate: string;
}

export interface ResolvedHunk extends ReleaseHunk {
  resolved: string;
}

export interface ResolvedFile {
  path: string;
  hunks: ResolvedHunk[];
}

export type ConflictResolutionMode = "deterministic" | "llm" | "fallback";

export interface ConflictResolution {
  files: ResolvedFile[];
  mode: ConflictResolutionMode;
  fallbackReason?: string;
  latencyMs?: number;
}

export interface DiffArtifactBody {
  unified: string;
  files: ResolvedFile[];
  resolution?: {
    mode: ConflictResolutionMode;
    fallbackReason?: string;
    latencyMs?: number;
  };
}

export interface AuditArtifactBody {
  version: string;
  runId: string;
  mode?: "release" | "rollback";
  parentRunId?: string;
  targetTag?: string;
  stages: Array<{
    id: string;
    name: string;
    status: string;
    summary?: string;
  }>;
  approvals: Array<{
    approvalId: string;
    stageId: string;
    approved: boolean;
    note?: string;
  }>;
  artifacts: Array<{
    artifactId: string;
    kind: string;
    title: string;
  }>;
  completedAt: string;
}
