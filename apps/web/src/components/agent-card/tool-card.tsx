import { memo, useMemo, useState } from "react";

import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  ShieldAlert,
  Wrench,
  XCircle,
} from "lucide-react";

import {
  parsePartialJson,
  type ApprovalState,
  type Risk,
  type ToolCallState,
} from "@agent-workbench/protocol";

import { AgentCard, type CardTone } from "./agent-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TOOL_LABELS: Record<string, string> = {
  search_kb: "检索知识库",
  search_logs: "检索日志",
  get_log_context: "读取日志上下文",
  group_errors: "聚合错误",
  get_commit_diff: "读取提交差异",
  get_merge_conflicts: "检查合并冲突",
  apply_patch: "应用补丁",
};

const STATUS_META: Record<
  ToolCallState["status"],
  { label: string; tone: CardTone; badge: string; spinner?: boolean }
> = {
  streaming: { label: "接收参数", tone: "neutral", badge: "text-muted-foreground", spinner: true },
  ready: { label: "参数就绪", tone: "neutral", badge: "text-muted-foreground" },
  running: { label: "执行中", tone: "info", badge: "text-sky-700 dark:text-sky-300", spinner: true },
  success: { label: "完成", tone: "success", badge: "text-emerald-700 dark:text-emerald-300" },
  error: { label: "失败", tone: "danger", badge: "text-destructive" },
  awaiting_approval: { label: "待审批", tone: "warning", badge: "text-amber-700 dark:text-amber-300" },
  rejected: { label: "已拒绝", tone: "danger", badge: "text-destructive" },
};

const RISK_META: Record<Risk, { label: string; className: string }> = {
  low: {
    label: "低风险",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  medium: {
    label: "中风险",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  high: {
    label: "高风险",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const APPROVAL_STATUS_LABEL: Record<ApprovalState["status"], string> = {
  pending: "等待你的决定",
  approved: "已批准",
  rejected: "已拒绝",
  expired: "已过期",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replaceAll("_", " ");
}

function StatusBadge({ status }: { status: ToolCallState["status"] }) {
  const meta = STATUS_META[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        meta.badge,
      )}
    >
      {meta.spinner ? <Loader2 className="size-2.5 animate-spin" /> : null}
      {meta.label}
    </span>
  );
}

function StatusIcon({ status }: { status: ToolCallState["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />;
    case "error":
    case "rejected":
      return <XCircle className="text-destructive" />;
    case "awaiting_approval":
      return <ShieldAlert className="text-amber-600 dark:text-amber-400" />;
    case "streaming":
    case "running":
      return <Loader2 className="animate-spin" />;
    case "ready":
      return <CircleDashed />;
    default:
      return <Wrench />;
  }
}

interface ToolCallCardProps {
  toolCall: ToolCallState;
  approval?: ApprovalState;
  canResolve: boolean;
  resolving: boolean;
  onResolve: (approved: boolean) => void;
}

export const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  approval,
  canResolve,
  resolving,
  onResolve,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const meta = STATUS_META[toolCall.status];
  const argsPreview = useMemo(() => {
    if (toolCall.args !== undefined) {
      return { text: JSON.stringify(toolCall.args, null, 2), label: "参数" };
    }

    if (toolCall.argsText.length === 0) {
      return { text: null, label: "参数" };
    }

    const partial = parsePartialJson(toolCall.argsText);

    if (partial === undefined) {
      return { text: toolCall.argsText, label: "参数（流式接收中）" };
    }

    return {
      text: JSON.stringify(partial, null, 2),
      label: "参数（流式接收中 · 已解析部分）",
    };
  }, [toolCall.args, toolCall.argsText]);
  const hasDetails = Boolean(argsPreview.text || toolCall.result);
  const activeStatus =
    toolCall.status === "streaming" ||
    toolCall.status === "ready" ||
    toolCall.status === "running" ||
    toolCall.status === "awaiting_approval" ||
    toolCall.status === "error";
  const showBody = expanded ?? activeStatus;

  return (
    <div className="pl-11">
      <AgentCard
        icon={<StatusIcon status={toolCall.status} />}
        title={toolLabel(toolCall.name)}
        subtitle={
          <span className="font-mono">
            {toolCall.name}
            {toolCall.durationMs !== undefined ? ` · ${toolCall.durationMs}ms` : ""}
          </span>
        }
        status={<StatusBadge status={toolCall.status} />}
        tone={meta.tone}
        actions={
          hasDetails ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!showBody)}
              aria-expanded={showBody}
            >
              {showBody ? "收起" : "详情"}
              <ChevronDown
                className={cn("transition-transform", showBody && "rotate-180")}
              />
            </Button>
          ) : null
        }
        footer={
          approval ? (
            <ApprovalPanel
              approval={approval}
              canResolve={canResolve}
              resolving={resolving}
              onResolve={onResolve}
            />
          ) : undefined
        }
      >
        {showBody ? (
          <div className="space-y-2">
            {argsPreview.text ? (
              <div>
                <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
                  {argsPreview.label}
                </p>
                <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all">
                  {argsPreview.text}
                </pre>
              </div>
            ) : null}

            {toolCall.result ? (
              <div>
                <p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
                  结果
                </p>
                <pre
                  className={cn(
                    "max-h-52 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all",
                    toolCall.status === "error" && "text-destructive",
                  )}
                >
                  {toolCall.result}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </AgentCard>

      {!approval && toolCall.status === "awaiting_approval" ? (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          等待审批事件…
        </p>
      ) : null}
    </div>
  );
});

function ApprovalPanel({
  approval,
  canResolve,
  resolving,
  onResolve,
}: {
  approval: ApprovalState;
  canResolve: boolean;
  resolving: boolean;
  onResolve: (approved: boolean) => void;
}) {
  const risk = RISK_META[approval.risk];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{approval.title}</span>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            risk.className,
          )}
        >
          {risk.label}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {APPROVAL_STATUS_LABEL[approval.status]}
        </span>
      </div>

      {approval.description ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {approval.description}
        </p>
      ) : null}

      {approval.status === "pending" ? (
        canResolve ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onResolve(true)}
              disabled={resolving}
            >
              {resolving ? <Loader2 className="animate-spin" /> : null}
              批准执行
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onResolve(false)}
              disabled={resolving}
            >
              拒绝
            </Button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            运行已暂停，等待审批通道就绪。
          </p>
        )
      ) : approval.note ? (
        <p className="text-[11px] text-muted-foreground">备注：{approval.note}</p>
      ) : null}
    </div>
  );
}
