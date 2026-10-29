import { memo } from "react";

import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Loader2,
  Pause,
  Rocket,
  Sparkles,
} from "lucide-react";

import type { CitationState, RunState } from "@agent-workbench/protocol";

import { ReasoningCard } from "@/components/agent-card/reasoning-card";
import { ToolCallCard } from "@/components/agent-card/tool-card";
import { MarkdownBlock } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { ChatRow } from "@/lib/chat/chat-rows";
import { cn } from "@/lib/utils";

interface ChatRowViewProps {
  row: ChatRow;
  onResolveApproval: (
    runId: string,
    approvalId: string,
    approved: boolean,
  ) => void;
  onStartRelease: (runId: string, scenarioId: string) => void;
}

export function ChatRowView({
  row,
  onResolveApproval,
  onStartRelease,
}: ChatRowViewProps) {
  switch (row.kind) {
    case "reconnect":
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
          连接中断，正在重连（第 {row.attempt} 次）…
        </div>
      );

    case "error":
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          出错了：{row.message}
        </div>
      );

    case "user":
      return <UserMessage text={row.text} />;

    case "handoff":
      return (
        <HandoffCard
          title={row.title}
          service={row.service}
          version={row.version}
          reason={row.reason}
          onStart={() => onStartRelease(row.runId, row.scenarioId)}
        />
      );

    case "assistant-header":
      return (
        <AssistantHeader runStatus={row.runStatus} streaming={row.streaming} />
      );

    case "assistant-block":
      return (
        <div className="pl-11">
          <MarkdownBlock
            blockId={row.blockId}
            raw={row.raw}
            closed={row.closed}
            showCursor={row.showCursor}
          />
        </div>
      );

    case "tool":
      return (
        <ToolCallCard
          toolCall={row.toolCall}
          approval={row.approval}
          canResolve={row.canResolve}
          resolving={row.resolving}
          onResolve={(approved) => {
            if (row.approval) {
              onResolveApproval(row.runId, row.approval.id, approved);
            }
          }}
        />
      );

    case "reasoning":
      return <ReasoningCard text={row.text} streaming={row.streaming} />;

    case "assistant-thinking":
      return <div className="pl-11 text-sm text-muted-foreground">思考中…</div>;

    case "cursor":
      return (
        <div className="pl-11">
          <span className="inline-block h-4 w-1 animate-pulse rounded-full bg-foreground align-middle" />
        </div>
      );

    case "citations":
      return <CitationList citations={row.citations} />;

    case "paused":
      return (
        <div className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          已暂停在 seq {row.seq}，点击“继续”从断点恢复。
        </div>
      );

    case "run-error":
      return (
        <div
          className={cn(
            "rounded-xl border px-4 py-3",
            row.fatal
              ? "border-destructive/30 bg-destructive/10"
              : "border-amber-500/30 bg-amber-500/10",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              row.fatal
                ? "text-destructive"
                : "text-amber-700 dark:text-amber-300",
            )}
          >
            <AlertTriangle className="size-4" />
            {row.fatal ? "运行失败" : "局部错误"}
            {row.retryable ? (
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal">
                可重试
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {row.message}
          </p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
            {row.code}
          </p>
        </div>
      );

    case "pending":
      return <PendingAssistant />;

    case "loading":
      return (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载长会话…
        </div>
      );

    default:
      return null;
  }
}

function AssistantHeader({
  runStatus,
  streaming,
}: {
  runStatus: RunState["status"] | null;
  streaming: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        <Sparkles className="size-4" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Agent</span>
        {streaming ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            生成中
          </span>
        ) : runStatus === "paused" ? (
          <span className="flex items-center gap-1">
            <Pause className="size-3" />
            已暂停
          </span>
        ) : runStatus === "cancelled" ? (
          <span>已取消</span>
        ) : null}
      </div>
    </div>
  );
}

const HandoffCard = memo(function HandoffCard({
  title,
  service,
  version,
  reason,
  onStart,
}: {
  title: string;
  service: string;
  version: string;
  reason?: string;
  onStart: () => void;
}) {
  return (
    <div className="pl-11">
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
            <Rocket className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {service} · v{version}
            </p>
            {reason ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {reason}
              </p>
            ) : null}
          </div>
        </div>

        <Button className="mt-3 w-full" size="sm" onClick={onStart}>
          进入 Release 工作台
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
});

const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
        {text}
      </div>
    </div>
  );
});

const CitationList = memo(function CitationList({
  citations,
}: {
  citations: CitationState[];
}) {
  return (
    <details className="group pl-11 text-xs text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-0.5 pr-1 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <BookOpen className="size-3" />
        引用 {citations.length} 条
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
      </summary>

      <ol className="mt-2 space-y-1.5">
        {citations.map((citation, index) => (
          <li
            key={citation.id}
            className="flex gap-2 rounded-lg border bg-card px-2.5 py-2"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-muted font-mono text-[10px] text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-foreground">
                {citation.title ?? citation.sourceId}
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {citation.sourceId}
                {citation.locator ? ` · ${citation.locator}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
});

function PendingAssistant() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <div className="flex size-8 items-center justify-center rounded-lg border bg-background">
        <Loader2 className="size-4 animate-spin" />
      </div>
      正在创建 run…
    </div>
  );
}
