import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  Activity,
  ArrowUp,
  BookOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

import {
  createRunState,
  reduce,
  type AgentEvent,
  type MessageState,
  type RunState,
} from "@agent-workbench/protocol";

import { EventInspector } from "@/components/event-inspector";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  cancelRun,
  pauseRun,
  startChatRun,
  streamRunEvents,
} from "@/transport/sse";

const QUICK_PROMPTS = [
  {
    fixture: "chat-release-notes",
    label: "1.2.0 发版注意事项",
    prompt: "1.2.0 发版有哪些注意事项？",
  },
  {
    fixture: "chat-short",
    label: "快速发版确认",
    prompt: "发版前需要确认什么？",
  },
];

interface ChatRun {
  runId: string;
  state: RunState;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function finalizeLocalRun(
  state: RunState,
  reason: "cancelled" | "failed",
): RunState {
  const messages = Object.fromEntries(
    Object.entries(state.messages).map(([id, message]) => [
      id,
      message.status === "streaming"
        ? {
            ...message,
            status: reason === "cancelled" ? ("completed" as const) : ("error" as const),
          }
        : message,
    ]),
  );

  return { ...state, status: reason, messages };
}

export default function App() {
  const [input, setInput] = useState("");
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();

      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  function clearStopTimer() {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }

  function finishRun(controller: AbortController) {
    if (abortRef.current !== controller) {
      return;
    }

    abortRef.current = null;
    setIsStreaming(false);
    setIsStopping(false);
    setReconnectAttempt(0);
    clearStopTimer();
  }

  function updateRun(runId: string, updater: (state: RunState) => RunState) {
    setRuns((previous) =>
      previous.map((run) =>
        run.runId === runId ? { runId: run.runId, state: updater(run.state) } : run,
      ),
    );
  }

  function finalizeRun(runId: string, reason: "cancelled" | "failed") {
    updateRun(runId, (state) => finalizeLocalRun(state, reason));
  }

  async function consumeEvents(
    controller: AbortController,
    stream: AsyncGenerator<AgentEvent, void, void>,
  ) {
    try {
      for await (const event of stream) {
        if (controller.signal.aborted) {
          break;
        }

        lastEventIdRef.current = event.eventId;
        setReconnectAttempt(0);
        setEvents((previous) => [...previous, event]);
        setRuns((previous) => {
          const index = previous.findIndex((run) => run.runId === event.runId);

          if (index === -1) {
            const base = createRunState({
              runId: event.runId,
              threadId: event.threadId,
              kind: "chat",
            });

            return [...previous, { runId: event.runId, state: reduce(base, event) }];
          }

          return previous.map((run, runIndex) =>
            runIndex === index
              ? { runId: run.runId, state: reduce(run.state, event) }
              : run,
          );
        });
      }
    } catch (cause) {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "请求失败");

        if (runIdRef.current) {
          finalizeRun(runIdRef.current, "failed");
        }
      }
    } finally {
      finishRun(controller);
    }
  }

  async function startRun(fixture: string | undefined, text: string) {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    lastEventIdRef.current = null;
    clearStopTimer();

    setError(null);
    setIsStreaming(true);
    setIsStopping(false);
    setReconnectAttempt(0);

    try {
      const run = await startChatRun(
        {
          prompt: text,
          fixture,
          threadId: threadIdRef.current ?? undefined,
        },
        {
          signal: controller.signal,
          onRetry: setReconnectAttempt,
        },
      );
      runIdRef.current = run.runId;
      threadIdRef.current = run.threadId;
      await consumeEvents(controller, run.events);
    } catch (cause) {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "请求失败");
      }

      finishRun(controller);
    }
  }

  function pauseCurrentRun() {
    const runId = runIdRef.current;

    if (!runId || isStopping) {
      return;
    }

    setIsStopping(true);
    clearStopTimer();
    stopTimerRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      setIsStreaming(false);
      setIsStopping(false);
      updateRun(runId, (state) => ({ ...state, status: "paused" }));
      stopTimerRef.current = null;
    }, 2000);

    void pauseRun(runId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "暂停失败");
      setIsStopping(false);
      clearStopTimer();
    });
  }

  function resumeCurrentRun() {
    const runId = runIdRef.current;
    const lastEventId = lastEventIdRef.current;

    if (!runId || !lastEventId || isStreaming) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsStreaming(true);
    setIsStopping(false);
    setReconnectAttempt(0);

    void consumeEvents(
      controller,
      streamRunEvents(runId, {
        signal: controller.signal,
        lastEventId,
        onRetry: setReconnectAttempt,
      }),
    );
  }

  function cancelCurrentRun() {
    const runId = runIdRef.current;

    if (!runId || isStopping) {
      return;
    }

    setIsStopping(true);

    void (async () => {
      try {
        await cancelRun(runId);

        if (abortRef.current) {
          return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setIsStreaming(true);

        await consumeEvents(
          controller,
          streamRunEvents(runId, {
            signal: controller.signal,
            lastEventId: lastEventIdRef.current ?? undefined,
            onRetry: setReconnectAttempt,
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "取消失败");
        abortRef.current?.abort();
        abortRef.current = null;
        setIsStreaming(false);
        setIsStopping(false);
        finalizeRun(runId, "cancelled");
      }
    })();
  }

  function resetConversation() {
    const runId = runIdRef.current;

    if (runId) {
      void cancelRun(runId).catch(() => {});
    }

    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current = null;
    threadIdRef.current = null;
    lastEventIdRef.current = null;
    clearStopTimer();

    setInput("");
    setRuns([]);
    setEvents([]);
    setError(null);
    setIsStreaming(false);
    setIsStopping(false);
    setReconnectAttempt(0);
  }

  const activeRun = runs.at(-1)?.state ?? null;
  const isPaused = activeRun?.status === "paused";
  const hasConversation = runs.length > 0 || isStreaming || error !== null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || isStreaming || isPaused) {
      return;
    }

    setInput("");
    void startRun(undefined, text);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/20">
      <header className="flex items-center justify-between gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">Agent Workbench</h1>
              <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                Chat · M0
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              本地 fixture 回放 · 不调用模型
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInspector((value) => !value)}
          >
            <Activity />
            <span className="hidden sm:inline">事件</span>
            {events.length}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetConversation}
            disabled={!hasConversation}
          >
            <RotateCcw />
            <span className="hidden sm:inline">新对话</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
              {!hasConversation ? (
                <EmptyState
                  onPick={(item) => {
                    void startRun(item.fixture, item.prompt);
                  }}
                />
              ) : (
                <>
                  {reconnectAttempt > 0 && isStreaming ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
                      连接中断，正在重连（第 {reconnectAttempt} 次）…
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      出错了：{error}
                    </div>
                  ) : null}

                  {runs.length > 0 ? (
                    runs.map((run) =>
                      run.state.messageOrder.map((messageId) => {
                        const message = run.state.messages[messageId];

                        if (!message) {
                          return null;
                        }

                        return message.role === "user" ? (
                          <UserMessage
                            key={`${run.runId}:${message.id}`}
                            text={message.text}
                          />
                        ) : (
                          <AssistantMessage
                            key={`${run.runId}:${message.id}`}
                            message={message}
                            runStatus={run.state.status}
                          />
                        );
                      }),
                    )
                  ) : isStreaming ? (
                    <PendingAssistant />
                  ) : null}

                  {isPaused ? (
                    <div className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                      已暂停在 seq {activeRun?.lastSeq}，点击“继续”从断点恢复。
                    </div>
                  ) : null}

                  <div ref={bottomRef} />
                </>
              )}
            </div>
          </div>

          <div className="border-t bg-background/90 p-4 backdrop-blur md:px-8">
            <form
              onSubmit={handleSubmit}
              className="mx-auto flex w-full max-w-3xl items-end gap-2"
            >
              <div className="flex-1 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={isStreaming || isPaused}
                  placeholder={
                    isPaused
                      ? "已暂停，点击继续生成或开始新对话"
                      : "问一个工程问题，例如 1.2.0 发版有哪些注意事项？"
                  }
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {isPaused
                    ? `断点 seq ${activeRun?.lastSeq ?? 0} · 可继续或取消`
                    : "Mock 模式 · 回答来自本地 fixture"}
                </p>
              </div>

              {isStreaming ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={pauseCurrentRun}
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
                    onClick={cancelCurrentRun}
                    disabled={isStopping}
                    aria-label="取消运行"
                  >
                    <X />
                  </Button>
                </div>
              ) : isPaused ? (
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" onClick={resumeCurrentRun}>
                    <Play className="fill-current" />
                    继续
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={cancelCurrentRun}
                    disabled={isStopping}
                    aria-label="取消运行"
                  >
                    {isStopping ? <Loader2 className="animate-spin" /> : <X />}
                  </Button>
                </div>
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
        </main>

        {showInspector ? (
          <EventInspector
            events={events}
            state={activeRun}
            onClose={() => setShowInspector(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
}: {
  onPick: (item: (typeof QUICK_PROMPTS)[number]) => void;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm">
        <Sparkles className="size-6 text-muted-foreground" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">从一个工程问题开始</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          事件从本地 fixture 逐条流式回放，并实时投影到聊天界面。
        </p>
      </div>

      <div className="grid w-full gap-3 sm:grid-cols-2">
        {QUICK_PROMPTS.map((item) => (
          <button
            key={item.fixture}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent"
          >
            <p className="text-sm font-medium">{item.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.prompt}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  runStatus,
}: {
  message: MessageState;
  runStatus: RunState["status"];
}) {
  const streaming = message.status === "streaming" && runStatus === "running";

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        <Sparkles className="size-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
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

        <div className="text-sm">
          {message.text ? (
            <Markdown>{message.text + (streaming ? " ▍" : "")}</Markdown>
          ) : (
            <span className="text-muted-foreground">思考中…</span>
          )}
        </div>

        {message.citations.length > 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="size-3" />
            引用 {message.citations.length} 条
          </div>
        ) : null}
      </div>
    </div>
  );
}

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
