import { Loader2 } from "lucide-react";

import type { ApprovalState, Risk } from "@agent-workbench/protocol";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RISK_META: Record<Risk, { label: string; className: string }> = {
  low: {
    label: "低风险",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  medium: {
    label: "中风险",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
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

export function ApprovalPanel({
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
