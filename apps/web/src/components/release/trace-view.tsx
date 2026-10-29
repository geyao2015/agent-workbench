import { Loader2 } from "lucide-react";

import type { Span, SpanKind } from "@agent-workbench/protocol";

import { cn } from "@/lib/utils";

const KIND_META: Record<SpanKind, { label: string; className: string }> = {
  agent: {
    label: "agent",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  model: {
    label: "model",
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  tool: {
    label: "tool",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  retriever: {
    label: "retriever",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  stage: {
    label: "stage",
    className:
      "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  internal: {
    label: "internal",
    className:
      "border-muted-foreground/30 bg-muted/50 text-muted-foreground",
  },
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

export function TraceView({
  spans,
  loading,
}: {
  spans: Span[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取 Trace…
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        暂无 Span。运行完成后会从事件日志派生时间线。
      </p>
    );
  }

  const start = Math.min(...spans.map((span) => span.startTime));
  const end = Math.max(
    ...spans.map((span) => span.endTime ?? span.startTime),
  );
  const total = Math.max(1, end - start);
  const root = spans.find((span) => span.kind === "agent");
  const usage = root?.attributes.usage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        <span>Trace {spans[0]?.traceId.slice(-8)}</span>
        <span>{spans.length} spans</span>
        <span>总耗时 {formatDuration(total)}</span>
        {usage ? (
          <span>
            tokens {usage.inputTokens ?? 0} in / {usage.outputTokens ?? 0} out
          </span>
        ) : null}
        <span className="text-muted-foreground/70">
          由事件日志派生；模型调用细粒度 Span 待 runtime 埋点
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-[minmax(0,15rem)_1fr_4.5rem] border-b bg-muted/30 px-3 py-2 text-[10px] font-medium tracking-wide text-muted-foreground">
          <span>Span</span>
          <span>时间线</span>
          <span className="text-right">耗时</span>
        </div>

        <div className="divide-y">
          {spans.map((span) => {
            const spanStart = span.startTime - start;
            const duration = (span.endTime ?? end) - span.startTime;
            const left = (spanStart / total) * 100;
            const width = Math.max(1.5, (duration / total) * 100);
            const meta = KIND_META[span.kind];
            const isRoot = span.kind === "agent";

            return (
              <div
                key={span.spanId}
                className="grid grid-cols-[minmax(0,15rem)_1fr_4.5rem] items-center gap-3 px-3 py-2"
              >
                <div className={cn("min-w-0", !isRoot && "pl-3")}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded border px-1 py-0.5 text-[9px] font-medium",
                        meta.className,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span
                      className={cn(
                        "truncate font-mono text-[11px]",
                        isRoot && "font-semibold",
                      )}
                      title={span.name}
                    >
                      {span.name}
                    </span>
                  </div>
                </div>

                <div className="relative h-4 rounded bg-muted/40">
                  <div
                    className={cn(
                      "absolute top-0 h-4 rounded",
                      span.status === "error"
                        ? "bg-destructive/70"
                        : span.status === "running"
                          ? "bg-amber-500/60"
                          : isRoot
                            ? "bg-sky-500/60"
                            : "bg-foreground/20",
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${span.name} · ${formatDuration(duration)}`}
                  />
                </div>

                <span className="text-right font-mono text-[10px] text-muted-foreground">
                  {formatDuration(duration)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
