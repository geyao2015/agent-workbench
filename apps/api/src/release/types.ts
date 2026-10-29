import type { Risk } from "@agent-workbench/protocol";

export type ReleaseStageKind =
  | "preflight"
  | "conflict_resolve"
  | "diff_approval"
  | "test"
  | "release_notes"
  | "dry_run_tag"
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
}

export interface ReleaseScenario {
  id: string;
  title: string;
  service: string;
  version: string;
  branch: string;
  tag: string;
  stages: ReleaseStage[];
  files: ReleaseFile[];
  ciAttempts: Record<string, CiAttempt>;
  notesTemplate: string;
}

export interface ResolvedHunk extends ReleaseHunk {
  resolved: string;
}

export interface ResolvedFile {
  path: string;
  hunks: ResolvedHunk[];
}

export interface DiffArtifactBody {
  unified: string;
  files: ResolvedFile[];
}

export interface AuditArtifactBody {
  version: string;
  runId: string;
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
