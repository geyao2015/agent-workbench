import { useEffect, useRef, type FormEvent } from "react";

import { ArrowUp, Hourglass, Loader2, Pause, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const MAX_INPUT_HEIGHT = 160;

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = inputRef.current;

    if (!element || element.disabled) {
      return;
    }

    const active = document.activeElement;

    if (!active || active === document.body) {
      element.focus();
    }
  }, [isStreaming, isPaused, isWaitingApproval, isLoadingHistory]);

  useEffect(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.style.height = "auto";

    const nextHeight = Math.min(element.scrollHeight, MAX_INPUT_HEIGHT);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY =
      element.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, [input]);

  return (
    <div className="border-t bg-background/90 py-4 backdrop-blur">
      <form
        onSubmit={onSubmit}
        className="mx-auto w-full max-w-3xl px-4 md:px-8"
      >
        <div className="rounded-xl border bg-background transition-colors duration-150 focus-within:border-foreground/30">
          <div className="min-w-0 px-3 pt-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                ) {
                  return;
                }

                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
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
              aria-label="消息输入"
              className="scroll-slim block w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            {isLoadingHistory || isWaitingApproval || isPaused ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isLoadingHistory
                  ? "正在加载长会话历史事件"
                  : isWaitingApproval
                    ? "run 已暂停，审批后从事件日志恢复"
                    : `断点 seq ${pausedSeq} · 可继续或取消`}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 px-2 pt-3 pb-2">
            <div className="flex min-w-0 flex-1 items-center gap-1" />

            <div className="flex shrink-0 items-center gap-1">
              {isStreaming ? (
                <>
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
                    className="size-8"
                    onClick={onCancel}
                    disabled={isStopping}
                    aria-label="取消运行"
                  >
                    <X />
                  </Button>
                </>
              ) : isPaused ? (
                <>
                  <Button type="button" size="sm" onClick={onResume}>
                    <Play className="fill-current" />
                    继续
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={onCancel}
                    disabled={isStopping}
                    aria-label="取消运行"
                  >
                    {isStopping ? <Loader2 className="animate-spin" /> : <X />}
                  </Button>
                </>
              ) : isWaitingApproval ? (
                <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <Hourglass className="size-3.5" />
                  等待审批
                </div>
              ) : isLoadingHistory ? (
                <Button
                  type="button"
                  size="icon"
                  className="size-8"
                  disabled
                  aria-label="加载长会话"
                >
                  <Loader2 className="animate-spin" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="size-8"
                  disabled={!input.trim()}
                  aria-label="发送"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
