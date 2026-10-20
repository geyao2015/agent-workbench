import {
  memo,
  Profiler,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import {
  Activity,
  ArrowUp,
  BookOpen,
  Gauge,
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
  type RunState,
} from "@agent-workbench/protocol";

import { EventInspector } from "@/components/event-inspector";
import { MarkdownBlock } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  getRenderStats,
  recordCommit,
  recordFirstToken,
  recordFps,
  recordTextUpdate,
  resetRenderStats,
  subscribeRenderStats,
} from "@/lib/render-stats";
import { cn } from "@/lib/utils";
import {
  cancelRun,
  fetchLongConversation,
  pauseRun,
  startChatRun,
  streamRunEvents,
} from "@/transport/sse";

type QuickPrompt =
  | {
      kind: "run";
      fixture: string;
      label: string;
      prompt: string;
      description: string;
    }
  | {
      kind: "history";
      label: string;
      description: string;
    };

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    kind: "run",
    fixture: "chat-general",
    label: "一般对话",
    prompt: "你在 Agent Workbench 里能做什么？",
    description: "多轮聊天、历史保留、事件记录",
  },
  {
    kind: "run",
    fixture: "chat-blocks",
    label: "模块渲染",
    prompt: "展示一下 Markdown 块渲染能力。",
    description: "标题、列表、代码块、表格、引用",
  },
  {
    kind: "history",
    label: "长会话",
    description: "100 轮 / 10000 块历史",
  },
  {
    kind: "run",
    fixture: "chat-large-nodes",
    label: "超长返回",
    prompt: "一次返回大量文本节点。",
    description: "单条 10000 块 / 500 增量",
  },
];

interface ChatRun {
  runId: string;
  state: RunState;
}

type ChatRow =
  | { kind: "reconnect"; key: string; attempt: number }
  | { kind: "error"; key: string; message: string }
  | { kind: "user"; key: string; text: string }
  | {
      kind: "assistant-header";
      key: string;
      runStatus: RunState["status"];
      streaming: boolean;
    }
  | {
      kind: "assistant-block";
      key: string;
      blockId: string;
      raw: string;
      closed: boolean;
      showCursor: boolean;
    }
  | { kind: "assistant-thinking"; key: string }
  | { kind: "cursor"; key: string }
  | { kind: "citations"; key: string; count: number }
  | { kind: "paused"; key: string; seq: number }
  | { kind: "pending"; key: string }
  | { kind: "loading"; key: string };

function buildChatRows(input: {
  runs: ChatRun[];
  isStreaming: boolean;
  isPaused: boolean;
  error: string | null;
  reconnectAttempt: number;
  isLoadingHistory: boolean;
}): ChatRow[] {
  const rows: ChatRow[] = [];

  if (input.isLoadingHistory) {
    rows.push({ kind: "loading", key: "loading" });
  }

  if (input.reconnectAttempt > 0 && input.isStreaming) {
    rows.push({
      kind: "reconnect",
      key: "reconnect",
      attempt: input.reconnectAttempt,
    });
  }

  if (input.error) {
    rows.push({ kind: "error", key: "error", message: input.error });
  }

  for (const run of input.runs) {
    for (const messageId of run.state.messageOrder) {
      const message = run.state.messages[messageId];

      if (!message) {
        continue;
      }

      if (message.role === "user") {
        rows.push({
          kind: "user",
          key: `${run.runId}:${message.id}`,
          text: message.text,
        });
        continue;
      }

      const streaming =
        message.status === "streaming" && run.state.status === "running";
      const lastBlockId = message.blockIds.at(-1);
      const lastBlock = lastBlockId ? run.state.blocks[lastBlockId] : undefined;

      rows.push({
        kind: "assistant-header",
        key: `${run.runId}:${message.id}:header`,
        runStatus: run.state.status,
        streaming,
      });

      if (message.blockIds.length === 0 && streaming) {
        rows.push({
          kind: "assistant-thinking",
          key: `${run.runId}:${message.id}:thinking`,
        });
      }

      for (const blockId of message.blockIds) {
        const block = run.state.blocks[blockId];

        if (!block) {
          continue;
        }

        rows.push({
          kind: "assistant-block",
          key: `${run.runId}:${blockId}`,
          blockId: block.id,
          raw: block.raw,
          closed: block.status === "closed",
          showCursor:
            streaming && block.id === lastBlockId && block.status === "open",
        });
      }

      if (streaming && lastBlock?.status === "closed") {
        rows.push({
          kind: "cursor",
          key: `${run.runId}:${message.id}:cursor`,
        });
      }

      if (message.citations.length > 0) {
        rows.push({
          kind: "citations",
          key: `${run.runId}:${message.id}:citations`,
          count: message.citations.length,
        });
      }
    }
  }

  const activeRun = input.runs.at(-1)?.state;

  if (input.isPaused && activeRun) {
    rows.push({ kind: "paused", key: "paused", seq: activeRun.lastSeq });
  }

  if (input.isStreaming && input.runs.length === 0) {
    rows.push({ kind: "pending", key: "pending" });
  }

  return rows;
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
  const [showPerformance, setShowPerformance] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [followVersion, setFollowVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const firstTokenSeenRef = useRef(false);
  const userMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();

      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

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

        if (event.type === "message.started" && event.payload.role === "user") {
          userMessageIdsRef.current.add(event.payload.messageId);
        }

        if (event.type === "text.delta") {
          recordTextUpdate();

          if (
            !firstTokenSeenRef.current &&
            !userMessageIdsRef.current.has(event.payload.messageId) &&
            runStartedAtRef.current !== null
          ) {
            firstTokenSeenRef.current = true;
            recordFirstToken(performance.now() - runStartedAtRef.current);
          }
        }

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
    runStartedAtRef.current = performance.now();
    firstTokenSeenRef.current = false;
    userMessageIdsRef.current = new Set();
    clearStopTimer();

    setError(null);
    setIsStreaming(true);
    setIsStopping(false);
    setIsLoadingHistory(false);
    setReconnectAttempt(0);
    setFollowVersion((value) => value + 1);

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

  async function loadLongConversation() {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    threadIdRef.current = null;
    lastEventIdRef.current = null;
    runStartedAtRef.current = null;
    firstTokenSeenRef.current = false;
    userMessageIdsRef.current = new Set();
    clearStopTimer();
    resetRenderStats();

    setInput("");
    setRuns([]);
    setEvents([]);
    setError(null);
    setIsStreaming(false);
    setIsStopping(false);
    setIsLoadingHistory(true);
    setReconnectAttempt(0);

    try {
      const demo = await fetchLongConversation(controller.signal);
      const nextRuns: ChatRun[] = [];
      const allEvents: AgentEvent[] = [];

      for (const run of demo.runs) {
        let state: RunState | null = null;

        for (const event of run.events) {
          allEvents.push(event);

          if (event.type === "text.delta") {
            recordTextUpdate();
          }

          state = state
            ? reduce(state, event)
            : reduce(
                createRunState({
                  runId: event.runId,
                  threadId: event.threadId,
                  kind: "chat",
                }),
                event,
              );
        }

        if (state) {
          nextRuns.push({ runId: run.runId, state });
        }
      }

      if (controller.signal.aborted) {
        return;
      }

      threadIdRef.current = demo.threadId;
      lastEventIdRef.current = allEvents.at(-1)?.eventId ?? null;
      setRuns(nextRuns);
      setEvents(allEvents);
      setFollowVersion((value) => value + 1);
    } catch (cause) {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "加载长会话失败");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoadingHistory(false);
      }
    }
  }

  function handleQuickPick(item: QuickPrompt) {
    if (item.kind === "history") {
      void loadLongConversation();
      return;
    }

    void startRun(item.fixture, item.prompt);
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
    setFollowVersion((value) => value + 1);

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
    runStartedAtRef.current = null;
    firstTokenSeenRef.current = false;
    userMessageIdsRef.current = new Set();
    clearStopTimer();
    resetRenderStats();

    setInput("");
    setRuns([]);
    setEvents([]);
    setError(null);
    setIsStreaming(false);
    setIsStopping(false);
    setIsLoadingHistory(false);
    setReconnectAttempt(0);
  }

  const activeRun = runs.at(-1)?.state ?? null;
  const isPaused = activeRun?.status === "paused";
  const chatRows = useMemo(
    () =>
      buildChatRows({
        runs,
        isStreaming,
        isPaused,
        error,
        reconnectAttempt,
        isLoadingHistory,
      }),
    [runs, isStreaming, isPaused, error, reconnectAttempt, isLoadingHistory],
  );
  const totalBlocks = useMemo(
    () =>
      chatRows.reduce(
        (count, row) => (row.kind === "assistant-block" ? count + 1 : count),
        0,
      ),
    [chatRows],
  );
  const hasConversation = chatRows.length > 0;

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
            variant="outline"
            size="sm"
            onClick={() => setShowPerformance((value) => !value)}
          >
            <Gauge />
            <span className="hidden sm:inline">性能</span>
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
          {chatRows.length > 0 ? (
            <ChatFeed
              rows={chatRows}
              version={events.length}
              followVersion={followVersion}
              streaming={isStreaming}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
                <EmptyState onPick={handleQuickPick} />
              </div>
            </div>
          )}

          <div className="border-t bg-background/90 p-4 backdrop-blur md:px-8">
            <form
              onSubmit={handleSubmit}
              className="mx-auto flex w-full max-w-3xl items-end gap-2"
            >
              <div className="flex-1 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/40">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={isStreaming || isPaused || isLoadingHistory}
                  placeholder={
                    isLoadingHistory
                      ? "正在加载长会话…"
                      : isPaused
                        ? "已暂停，点击继续生成或开始新对话"
                        : "问一个工程问题，例如 1.2.0 发版有哪些注意事项？"
                  }
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {isLoadingHistory
                    ? "正在加载长会话历史事件"
                    : isPaused
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
              ) : isLoadingHistory ? (
                <Button
                  type="button"
                  size="icon"
                  disabled
                  aria-label="加载长会话"
                >
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
        </main>

        {showInspector ? (
          <EventInspector
            events={events}
            state={activeRun}
            onClose={() => setShowInspector(false)}
          />
        ) : null}
      </div>

      {showPerformance ? (
        <PerformancePanel
          active={isStreaming || runs.length > 0}
          totalBlocks={totalBlocks}
          onClose={() => setShowPerformance(false)}
        />
      ) : null}
    </div>
  );
}

function handleProfilerRender(
  _id: string,
  _phase: string,
  actualDuration: number,
) {
  recordCommit(actualDuration);
}

const ChatFeed = memo(function ChatFeed({
  rows,
  version,
  followVersion,
  streaming,
}: {
  rows: ChatRow[];
  version: number;
  followVersion: number;
  streaming: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "assistant-block" ? 72 : 48,
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [followVersion]);

  useEffect(() => {
    if (!stickToBottomRef.current || rows.length === 0) {
      return;
    }

    autoScrollingRef.current = true;
    let frames = 0;
    let frameId = 0;

    const tick = () => {
      const element = scrollRef.current;

      if (!element || !stickToBottomRef.current) {
        autoScrollingRef.current = false;
        return;
      }

      lastScrollTopRef.current = element.scrollTop;
      element.scrollTop = element.scrollHeight;
      frames += 1;

      const distance =
        element.scrollHeight - element.scrollTop - element.clientHeight;

      if (frames < 60 && distance > 2) {
        frameId = requestAnimationFrame(tick);
      } else {
        lastScrollTopRef.current = element.scrollTop;
        autoScrollingRef.current = false;
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      autoScrollingRef.current = false;
    };
  }, [rows.length, version]);

  function handleScroll() {
    if (streaming || autoScrollingRef.current) {
      return;
    }

    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const current = element.scrollTop;
    const previous = lastScrollTopRef.current;
    lastScrollTopRef.current = current;

    if (current < previous - 2) {
      stickToBottomRef.current = false;
      return;
    }

    if (element.scrollHeight - current - element.clientHeight < 120) {
      stickToBottomRef.current = true;
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onWheel={() => {
        stickToBottomRef.current = false;
      }}
      onTouchMove={() => {
        stickToBottomRef.current = false;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <Profiler id="chat-feed" onRender={handleProfilerRender}>
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];

            if (!row) {
              return null;
            }

            return (
              <div
                key={row.key}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div
                  className={cn(
                    "mx-auto w-full max-w-3xl px-4 md:px-8",
                    row.kind === "assistant-block" ? "py-1" : "py-2",
                    virtualItem.index === 0 && "pt-8",
                    virtualItem.index === rows.length - 1 && "pb-8",
                  )}
                >
                  <ChatRowView row={row} />
                </div>
              </div>
            );
          })}
        </div>
      </Profiler>
    </div>
  );
});

function ChatRowView({ row }: { row: ChatRow }) {
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

    case "assistant-thinking":
      return <div className="pl-11 text-sm text-muted-foreground">思考中…</div>;

    case "cursor":
      return (
        <div className="pl-11">
          <span className="inline-block h-4 w-1 animate-pulse rounded-full bg-foreground align-middle" />
        </div>
      );

    case "citations":
      return (
        <div className="flex items-center gap-1.5 pl-11 text-xs text-muted-foreground">
          <BookOpen className="size-3" />
          引用 {row.count} 条
        </div>
      );

    case "paused":
      return (
        <div className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          已暂停在 seq {row.seq}，点击“继续”从断点恢复。
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
  runStatus: RunState["status"];
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

function EmptyState({ onPick }: { onPick: (item: QuickPrompt) => void }) {
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
            key={item.kind === "run" ? item.fixture : item.label}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent"
          >
            <p className="text-sm font-medium">{item.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
        {text}
      </div>
    </div>
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

function useFps(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const loop = (now: number) => {
      frames += 1;
      const elapsed = now - last;

      if (elapsed >= 500) {
        recordFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        last = now;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [active]);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

function PerformancePanel({
  active,
  totalBlocks,
  onClose,
}: {
  active: boolean;
  totalBlocks: number;
  onClose: () => void;
}) {
  const stats = useSyncExternalStore(subscribeRenderStats, getRenderStats);

  useFps(active);

  return (
    <aside className="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">渲染性能</p>
          <p className="text-xs text-muted-foreground">当前对话累计</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="关闭性能面板"
        >
          <X />
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="块渲染" value={String(stats.blockRenders)} />
        <Metric
          label="闭合块渲染"
          value={`${stats.closedBlockRenders} / ${stats.uniqueBlocks} 块`}
        />
        <Metric label="开放块渲染" value={String(stats.openBlockRenders)} />
        <Metric label="总块数" value={String(totalBlocks)} />
        <Metric label="文本增量" value={String(stats.textUpdates)} />
        <Metric
          label="首 token"
          value={stats.firstTokenMs === null ? "—" : `${stats.firstTokenMs}ms`}
        />
        <Metric
          label="帧率（最近）"
          value={
            stats.fps > 0 ? `${stats.fps}fps` : active ? "测量中…" : "—"
          }
        />
        <Metric label="最近提交" value={`${stats.lastCommitMs}ms`} />
        <Metric label="最大提交" value={`${stats.maxCommitMs}ms`} />
      </dl>

      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-[10px] leading-4 text-muted-foreground">
          开发模式 StrictMode 会重复计数，生产构建更准确。
        </p>
        <Button variant="outline" size="sm" onClick={resetRenderStats}>
          重置
        </Button>
      </div>
    </aside>
  );
}
