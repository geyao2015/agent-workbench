import type { ReactNode } from "react";

import { Loader2 } from "lucide-react";

interface AuditBody {
  version: string;
  runId: string;
  mode?: "release" | "rollback";
  parentRunId?: string;
  targetTag?: string;
  stages: Array<{ id: string; name: string; status: string; summary?: string }>;
  approvals: Array<{
    approvalId: string;
    stageId: string;
    approved: boolean;
    note?: string;
  }>;
  artifacts: Array<{ artifactId: string; kind: string; title: string }>;
  completedAt: string;
}

function parseAudit(body: string): AuditBody | null {
  try {
    const parsed = JSON.parse(body) as AuditBody;

    if (Array.isArray(parsed.stages) && Array.isArray(parsed.approvals)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-3 py-2.5 text-sm font-medium">{title}</header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function AuditTable({
  body,
  loading,
}: {
  body: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取审计记录…
      </div>
    );
  }

  if (!body) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        审计阶段完成后会生成记录。
      </p>
    );
  }

  const audit = parseAudit(body);

  if (!audit) {
    return (
      <pre className="overflow-auto rounded-xl border bg-card p-4 text-xs">
        {body}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {audit.mode === "rollback" ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          回滚审计
          {audit.targetTag ? ` · 目标 ${audit.targetTag}` : ""}
          {audit.parentRunId
            ? ` · parent ${audit.parentRunId.slice(-8)}`
            : ""}
        </div>
      ) : null}

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-lg border bg-card px-3 py-2">
          版本 <span className="ml-1 font-medium text-foreground">{audit.version}</span>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2">
          阶段 <span className="ml-1 font-medium text-foreground">{audit.stages.length}</span>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2">
          审批 <span className="ml-1 font-medium text-foreground">{audit.approvals.length}</span>
        </div>
      </div>

      <Section title="阶段记录">
        <div className="space-y-1.5">
          {audit.stages.map((stage) => (
            <div
              key={stage.id}
              className="flex items-start justify-between gap-3 rounded-md bg-muted/30 px-2.5 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium">{stage.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {stage.summary ?? stage.id}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {stage.status}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="人工审批">
        {audit.approvals.length === 0 ? (
          <p className="text-xs text-muted-foreground">没有审批记录。</p>
        ) : (
          <div className="space-y-1.5">
            {audit.approvals.map((approval) => (
              <div
                key={approval.approvalId}
                className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2.5 py-2 text-xs"
              >
                <span className="font-mono text-[11px]">{approval.stageId}</span>
                <span
                  className={
                    approval.approved
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-destructive"
                  }
                >
                  {approval.approved ? "已批准" : "已拒绝"}
                  {approval.note ? ` · ${approval.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Artifacts">
        <div className="space-y-1.5">
          {audit.artifacts.map((artifact) => (
            <div
              key={artifact.artifactId}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2.5 py-2 text-xs"
            >
              <span className="truncate">{artifact.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {artifact.kind}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
