import {
  CheckCircle2,
  Circle,
  Loader2,
  SkipForward,
  XCircle,
} from "lucide-react";

import type { RunState, StageState } from "@agent-workbench/protocol";

import { AgentCard, type CardTone } from "@/components/agent-card/agent-card";
import { cn } from "@/lib/utils";

const STAGE_META: Record<
  StageState["status"],
  { label: string; tone: CardTone; badge: string }
> = {
  pending: { label: "等待", tone: "neutral", badge: "text-muted-foreground" },
  running: {
    label: "执行中",
    tone: "info",
    badge: "text-sky-700 dark:text-sky-300",
  },
  success: {
    label: "完成",
    tone: "success",
    badge: "text-emerald-700 dark:text-emerald-300",
  },
  error: { label: "失败", tone: "danger", badge: "text-destructive" },
  skipped: {
    label: "跳过",
    tone: "warning",
    badge: "text-amber-700 dark:text-amber-300",
  },
};

function StageIcon({ status }: { status: StageState["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="animate-spin" />;
    case "success":
      return <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />;
    case "error":
      return <XCircle className="text-destructive" />;
    case "skipped":
      return <SkipForward className="text-amber-600 dark:text-amber-400" />;
    default:
      return <Circle />;
  }
}

export function StageTimeline({ state }: { state: RunState }) {
  if (state.stageOrder.length === 0) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        等待阶段开始…
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {state.stageOrder.map((stageId, index) => {
        const stage = state.stages[stageId];

        if (!stage) {
          return null;
        }

        const meta = STAGE_META[stage.status];

        return (
          <li key={stageId}>
            <AgentCard
              icon={<StageIcon status={stage.status} />}
              title={stage.name}
              subtitle={`${index + 1}. ${stage.id}`}
              status={
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                    meta.badge,
                  )}
                >
                  {stage.status === "running" ? (
                    <Loader2 className="size-2.5 animate-spin" />
                  ) : null}
                  {meta.label}
                </span>
              }
              tone={meta.tone}
            >
              <p className="text-xs leading-5 text-muted-foreground">
                {stage.summary ?? "等待执行结果"}
              </p>
            </AgentCard>
          </li>
        );
      })}
    </ol>
  );
}
