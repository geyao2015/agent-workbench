import type { FormEvent } from "react";

import { ArrowUp, Hourglass, Loader2, Pause, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  input: string;
  pausedSeq: number;
  isStreaming: boolean;
  isPaused: boolean;
  isWaitingApproval: boolean;
  isLoadingHistory: boolean;
  isStopping: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInputChange: (value: string) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export function ChatComposer({
  input,
  pausedSeq,
  isStreaming,
  isPaused,
  isWaitingApproval,
  isLoadingHistory,
  isStopping,
  onSubmit,
  onInputChange,
  onPause,
  onResume,
  onCancel,
}: ChatComposerProps) {
  return (
    <div className="border-t bg-background/90 p-4 backdrop-blur md:px-8">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-3xl items-end gap-2"
      >
        <div className="flex-1 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
          <input
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            disabled={
              isStreaming || isPaused || isWaitingApproval || isLoadingHistory
            }
            placeholder={
              isLoadingHistory
                ? "正在加载长会话…"
                : isWaitingApproval
                  ? "等待审批：请在工具卡片中批准或拒绝"
                  : isPaused
                    ? "已暂停，点击继续生成或开始新对话"
                    : "问一个工程问题，例如 1.2.0 发版有哪些注意事项？"
            }
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isLoadingHistory
              ? "正在加载长会话历史事件"
              : isWaitingApproval
                ? "run 已暂停，审批后从事件日志恢复"
                : isPaused
                  ? `断点 seq ${pausedSeq} · 可继续或取消`
                  : "Mock 模式 · 回答来自本地 fixture"}
          </p>
        </div>

        {isStreaming ? (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPause}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Pause className="fill-current" />
              )}
              {isStopping ? "暂停中" : "暂停"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancel}
              disabled={isStopping}
              aria-label="取消运行"
            >
              <X />
            </Button>
          </div>
        ) : isPaused ? (
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" onClick={onResume}>
              <Play className="fill-current" />
              继续
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCancel}
              disabled={isStopping}
              aria-label="取消运行"
            >
              {isStopping ? <Loader2 className="animate-spin" /> : <X />}
            </Button>
          </div>
        ) : isWaitingApproval ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <Hourglass className="size-3.5" />
            等待审批
          </div>
        ) : isLoadingHistory ? (
          <Button type="button" size="icon" disabled aria-label="加载长会话">
            <Loader2 className="animate-spin" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim()}
            aria-label="发送"
          >
            <ArrowUp />
          </Button>
        )}
      </form>
    </div>
  );
}
