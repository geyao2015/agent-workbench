import { useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  Loader2,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import {
  createRunState,
  fromRunSnapshot,
  reduce,
  type AgentEvent,
  type ApprovalState,
  type RunState,
  type Span,
} from "@agent-workbench/protocol";

import { AppHeader } from "@/components/app-header";
import { ApprovalPanel } from "@/components/approval-panel";
import { AgentCard } from "@/components/agent-card/agent-card";
import { AuditTable } from "@/components/release/audit-table";
import { DiffViewer } from "@/components/release/diff-viewer";
import { ReleaseEventLog } from "@/components/release/event-log";
import { LogsView } from "@/components/release/logs-view";
import { StageTimeline } from "@/components/release/stage-timeline";
import { TraceView } from "@/components/release/trace-view";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import {
  cancelReleaseRun,
  fetchReleaseArtifact,
  fetchReleaseEvents,
  fetchReleaseRuns,
  fetchReleaseSpans,
  resolveReleaseApproval,
  rollbackReleaseRun,
  streamReleaseRunEvents,
} from "@/transport/release";

type Tab = "overview" | "logs" | "diff" | "trace" | "events" | "audit";

const TAB_LABELS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs" },
  { id: "diff", label: "Diff" },
  { id: "trace", label: "Trace" },
  { id: "events", label: "Events" },
  { id: "audit", label: "Audit" },
];

const STATUS_LABEL: Record<RunState["status"], string> = {
  idle: "等待启动",
  running: "执行中",
  waiting_approval: "等待审批",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function isActive(state: RunState | null): boolean {
  return (
    state?.status === "running" ||
    state?.status === "waiting_approval" ||
    state?.status === "paused"
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function latestArtifact(
  state: RunState,
  predicate: (artifact: RunState["artifacts"][string]) => boolean,
) {
  return Object.values(state.artifacts).filter(predicate).at(-1);
}

export function ReleaseDetailView({
  threadId,
  runId,
}: {
  threadId?: string;
  runId?: string;
}) {
  const [state, setState] = useState<RunState | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [diffBody, setDiffBody] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [auditBody, setAuditBody] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [logBody, setLogBody] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [rcaBody, setRcaBody] = useState<string | null>(null);
  const [rcaLoading, setRcaLoading] = useState(false);
  const [spans, setSpans] = useState<Span[]>([]);
  const [spansLoading, setSpansLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const diffArtifactRef = useRef<string | null>(null);
  const auditArtifactRef = useRef<string | null>(null);
  const logArtifactRef = useRef<string | null>(null);
  const rcaArtifactRef = useRef<string | null>(null);
  const spansKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId) {
      setLoading(false);
      setError("缺少发版会话");
      return;
    }

    const controller = new AbortController();

    setState(null);
    setEvents([]);
    setError(null);
    setLoading(true);
    setDiffBody(null);
    setAuditBody(null);
    setLogBody(null);
    setRcaBody(null);
    setSpans([]);
    setDiffLoading(false);
    setAuditLoading(false);
    setLogLoading(false);
    setRcaLoading(false);
    setSpansLoading(false);
    diffArtifactRef.current = null;
    auditArtifactRef.current = null;
    logArtifactRef.current = null;
    rcaArtifactRef.current = null;
    spansKeyRef.current = null;

    void (async () => {
      try {
        const page = await fetchReleaseRuns(
          threadId,
          undefined,
          controller.signal,
        );
        const snapshot = runId
          ? page.runs.find((run) => run.runId === runId)
          : page.runs.at(-1);
        const activeRunId = snapshot?.runId ?? runId;

        if (!activeRunId) {
          if (!controller.signal.aborted) {
            setError("没有找到发版 run");
            setLoading(false);
          }

          return;
        }

        const log = await fetchReleaseEvents(
          activeRunId,
          controller.signal,
        ).catch(() => [] as AgentEvent[]);

        let base = snapshot
          ? fromRunSnapshot(snapshot)
          : createRunState({
              runId: activeRunId,
              threadId,
              kind: "release",
            });

        for (const event of log) {
          base = reduce(base, event);
        }

        if (controller.signal.aborted) {
          return;
        }

        setState(base);
        setEvents(log);
        setLoading(false);

        if (!isActive(base)) {
          return;
        }

        const lastEventId = log.at(-1)?.eventId;

        for await (const event of streamReleaseRunEvents(activeRunId, {
          signal: controller.signal,
          lastEventId,
        })) {
          if (controller.signal.aborted) {
            break;
          }

          setEvents((previous) =>
            previous.some((item) => item.eventId === event.eventId)
              ? previous
              : [...previous, event],
          );
          setState((previous) =>
            reduce(
              previous ??
                createRunState({
                  runId: event.runId,
                  threadId: event.threadId,
                  kind: "release",
                }),
              event,
            ),
          );
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "加载发版 run 失败",
          );
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [threadId, runId]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const artifact = latestArtifact(state, (item) => item.kind === "diff");

    if (!artifact?.uri || diffArtifactRef.current === artifact.id) {
      return;
    }

    diffArtifactRef.current = artifact.id;
    const controller = new AbortController();
    setDiffLoading(true);

    void fetchReleaseArtifact(artifact.uri, controller.signal)
      .then((content) => setDiffBody(content.body))
      .catch(() => setDiffBody(null))
      .finally(() => setDiffLoading(false));

    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const artifact = latestArtifact(
      state,
      (item) =>
        item.kind === "document" &&
        (item.stageId === "audit" || item.title.includes("审计")),
    );

    if (!artifact?.uri || auditArtifactRef.current === artifact.id) {
      return;
    }

    auditArtifactRef.current = artifact.id;
    const controller = new AbortController();
    setAuditLoading(true);

    void fetchReleaseArtifact(artifact.uri, controller.signal)
      .then((content) => setAuditBody(content.body))
      .catch(() => setAuditBody(null))
      .finally(() => setAuditLoading(false));

    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const artifact = latestArtifact(
      state,
      (item) => item.kind === "log_bundle",
    );

    if (!artifact?.uri || logArtifactRef.current === artifact.id) {
      return;
    }

    logArtifactRef.current = artifact.id;
    const controller = new AbortController();
    setLogLoading(true);

    void fetchReleaseArtifact(artifact.uri, controller.signal)
      .then((content) => setLogBody(content.body))
      .catch(() => setLogBody(null))
      .finally(() => setLogLoading(false));

    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const artifact = latestArtifact(
      state,
      (item) =>
        item.kind === "document" &&
        item.stageId === "rca",
    );

    if (!artifact?.uri || rcaArtifactRef.current === artifact.id) {
      return;
    }

    rcaArtifactRef.current = artifact.id;
    const controller = new AbortController();
    setRcaLoading(true);

    void fetchReleaseArtifact(artifact.uri, controller.signal)
      .then((content) => setRcaBody(content.body))
      .catch(() => setRcaBody(null))
      .finally(() => setRcaLoading(false));

    return () => controller.abort();
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const key = `${state.runId}:${state.status}`;

    if (spansKeyRef.current === key) {
      return;
    }

    spansKeyRef.current = key;
    const controller = new AbortController();
    setSpansLoading(true);

    void fetchReleaseSpans(state.runId, controller.signal)
      .then((nextSpans) => setSpans(nextSpans))
      .catch(() => setSpans([]))
      .finally(() => setSpansLoading(false));

    return () => controller.abort();
  }, [state]);

  const pendingApproval: ApprovalState | undefined = state
    ? Object.values(state.approvals).find(
        (approval) => approval.status === "pending" && approval.stageId,
      )
    : undefined;
  const active = isActive(state);
  const isRollbackRun =
    state?.stageOrder.some((stageId) => stageId.startsWith("rollback.")) ?? false;
  const canRollback = state?.status === "completed" && !isRollbackRun;
  const stageCount = state?.stageOrder.length ?? 0;
  const doneCount = state
    ? state.stageOrder.filter((stageId) => {
        const status = state.stages[stageId]?.status;

        return status === "success" || status === "error" || status === "skipped";
      }).length
    : 0;
  const failedCount = state
    ? state.stageOrder.filter(
        (stageId) => state.stages[stageId]?.status === "error",
      ).length
    : 0;
  const startedAt = events.find((event) => event.type === "run.started")?.ts;
  const endedAt =
    events.find(
      (event) =>
        event.type === "run.completed" || event.type === "run.failed",
    )?.ts ?? events.at(-1)?.ts;
  const durationMs =
    startedAt !== undefined && endedAt !== undefined
      ? Math.max(0, endedAt - startedAt)
      : 0;
  const approvalCount = state ? Object.keys(state.approvals).length : 0;
  const artifactCount = state ? Object.keys(state.artifacts).length : 0;

  async function resolveApproval(approved: boolean) {
    if (!pendingApproval || resolving) {
      return;
    }

    setResolving(true);
    setError(null);

    try {
      await resolveReleaseApproval(pendingApproval.id, { approved });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交审批失败");
    } finally {
      setResolving(false);
    }
  }

  async function cancelCurrentRun() {
    if (!state) {
      return;
    }

    try {
      await cancelReleaseRun(state.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取消失败");
    }
  }

  async function startRollback() {
    if (!state || rollingBack) {
      return;
    }

    setRollingBack(true);
    setError(null);

    try {
      const run = await rollbackReleaseRun(state.runId);

      navigate(`#/releases/${run.threadId}?run=${run.runId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建回滚失败");
      setRollingBack(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/20">
      <AppHeader
        subtitle={
          isRollbackRun
            ? "模拟发版环境 · 回滚执行"
            : "模拟发版环境 · 确定性阶段 + 人工审批"
        }
        activeView="releases"
        onNavigate={(view) =>
          navigate(view === "chat" ? "#/chat" : "#/releases")
        }
      >
        <Button variant="ghost" size="sm" onClick={() => navigate("#/releases")}>
          <ArrowLeft />
          <span className="sr-only lg:not-sr-only">列表</span>
        </Button>
        {canRollback ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void startRollback()}
            disabled={rollingBack}
          >
            {rollingBack ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            <span className="sr-only lg:not-sr-only">回滚</span>
          </Button>
        ) : null}
        {active ? (
          <Button variant="outline" size="sm" onClick={() => void cancelCurrentRun()}>
            <XCircle />
            <span className="sr-only lg:not-sr-only">取消</span>
          </Button>
        ) : null}
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 md:px-8">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载发版 run…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {state ? (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {STATUS_LABEL[state.status]}
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {state.runId.slice(-8)}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  阶段 {doneCount}/{stageCount}
                  {failedCount > 0 ? ` · 失败 ${failedCount}` : ""}
                  {startedAt !== undefined
                    ? ` · 耗时 ${formatDuration(durationMs)}`
                    : ""}
                  {" · "}审批 {approvalCount} · artifacts {artifactCount} · lastSeq{" "}
                  {state.lastSeq}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  state.status === "completed" &&
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  state.status === "failed" &&
                    "border-destructive/30 bg-destructive/10 text-destructive",
                  state.status === "cancelled" &&
                    "border-muted-foreground/30 bg-muted text-muted-foreground",
                  (state.status === "running" ||
                    state.status === "waiting_approval") &&
                    "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                )}
              >
                {state.status}
              </span>
            </section>
          ) : null}

          <div className="flex items-center gap-1 border-b">
            {TAB_LABELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "border-b-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors",
                  tab === item.id
                    ? "border-foreground text-foreground"
                    : "border-transparent hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {state && tab === "overview" ? (
            <div className="space-y-3">
              {pendingApproval ? (
                <AgentCard
                  icon={<ShieldAlert className="text-amber-600 dark:text-amber-400" />}
                  title="等待人工审批"
                  subtitle={`阶段 ${pendingApproval.stageId ?? "unknown"} · ${pendingApproval.risk}`}
                  tone="warning"
                >
                  <ApprovalPanel
                    approval={pendingApproval}
                    canResolve={state.status === "waiting_approval"}
                    resolving={resolving}
                    onResolve={(approved) => void resolveApproval(approved)}
                  />
                </AgentCard>
              ) : null}

              <StageTimeline state={state} />
            </div>
          ) : null}

          {tab === "logs" ? (
            <LogsView
              logBody={logBody}
              logLoading={logLoading}
              rcaBody={rcaBody}
              rcaLoading={rcaLoading}
            />
          ) : null}

          {tab === "diff" ? (
            <DiffViewer body={diffBody} loading={diffLoading} />
          ) : null}

          {tab === "trace" ? (
            <TraceView spans={spans} loading={spansLoading} />
          ) : null}

          {tab === "events" ? <ReleaseEventLog events={events} /> : null}

          {tab === "audit" ? (
            <AuditTable body={auditBody} loading={auditLoading} />
          ) : null}
          </div>
        </main>
        <div id="notes-root" className="contents" />
      </div>
    </div>
  );
}
