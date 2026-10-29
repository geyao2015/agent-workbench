import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Activity, Gauge, RotateCcw } from "lucide-react";

import {
  createRunState,
  fromRunSnapshot,
  reduce,
  type AgentEvent,
  type RunState,
  type ThreadSummary,
} from "@agent-workbench/protocol";

import { AppHeader } from "@/components/app-header";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatFeed } from "@/components/chat/chat-feed";
import { EmptyState } from "@/components/chat/empty-state";
import { ThreadSidebar } from "@/components/chat/thread-sidebar";
import { EventInspector } from "@/components/devtools/event-inspector";
import { PerformancePanel } from "@/components/devtools/performance-panel";
import { Button } from "@/components/ui/button";
import { buildChatRows, type ChatRun } from "@/lib/chat/chat-rows";
import { useChatQueue } from "@/lib/chat/use-chat-queue";
import { navigate } from "@/lib/hash-router";
import { useSidePanel } from "@/lib/side-panel-state";
import {
  quickPromptsFor,
  type QuickPrompt,
} from "@/lib/chat/quick-prompts";
import {
  recordFirstToken,
  recordTextUpdate,
  resetRenderStats,
} from "@/lib/render-stats";
import { createReleaseRun } from "@/transport/release";
import {
  cancelRun,
  fetchLongConversation,
  fetchRuntimeInfo,
  fetchThreadRuns,
  fetchThreads,
  pauseRun,
  resolveApproval as resolveApprovalRequest,
  startChatRun,
  streamRunEvents,
  type RuntimeInfo,
} from "@/transport/sse";

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

export function ChatView() {
  const [input, setInput] = useState("");
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activePanel, togglePanel, closePanel } = useSidePanel();
  const [isStopping, setIsStopping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(
    null,
  );
  const [followVersion, setFollowVersion] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const runStartedAtRef = useRef<number | null>(null);
  const firstTokenSeenRef = useRef(false);
  const userMessageIdsRef = useRef<Set<string>>(new Set());
  const handoffStartingRef = useRef(false);
  const autoRunRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();

      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void fetchRuntimeInfo(controller.signal)
      .then((info) => {
        if (!controller.signal.aborted) {
          setRuntime(info);
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (runtime?.mode !== "agent") {
      return;
    }

    const controller = new AbortController();
    void refreshThreads(controller.signal);

    return () => controller.abort();
  }, [runtime]);

  useEffect(() => {
    if (runtime?.mode !== "mock" || autoRunRef.current) {
      return;
    }

    const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const fixture = params.get("fixture");

    if (!fixture) {
      return;
    }

    autoRunRef.current = true;
    resetRenderStats();

    if (params.get("bench") === "1") {
      togglePanel("performance");
    }

    void startRun(fixture, "流式渲染基准");
  }, [runtime]);

  async function refreshThreads(signal?: AbortSignal) {
    setIsLoadingThreads(true);

    try {
      setThreads(
        (await fetchThreads(signal)).filter((thread) => thread.kind === "chat"),
      );
    } catch {
      // mock 模式下没有会话接口，忽略即可
    } finally {
      if (!signal?.aborted) {
        setIsLoadingThreads(false);
      }
    }
  }

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
    runId: string,
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
      if (!isAbortError(cause) && abortRef.current === controller) {
        setError(cause instanceof Error ? cause.message : "请求失败");
        finalizeRun(runId, "failed");
      }
    } finally {
      finishRun(controller);

      if (!controller.signal.aborted) {
        void refreshThreads();
      }
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
      setActiveThreadId(run.threadId);
      void refreshThreads();
      await consumeEvents(controller, run.runId, run.events);
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
    setIsLoadingEarlier(false);
    setActiveThreadId(null);
    setHistoryCursor(null);
    setReconnectAttempt(0);
    clearQueue();

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

  async function openThread(threadId: string) {
    if (threadId === activeThreadId && runs.length > 0) {
      return;
    }

    const currentRunId = runIdRef.current;

    if (currentRunId && isStreaming) {
      void cancelRun(currentRunId).catch(() => {});
    }

    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = null;
    threadIdRef.current = threadId;
    lastEventIdRef.current = null;
    runStartedAtRef.current = null;
    firstTokenSeenRef.current = false;
    userMessageIdsRef.current = new Set();
    clearStopTimer();

    setActiveThreadId(threadId);
    setInput("");
    setRuns([]);
    setEvents([]);
    setError(null);
    setIsStreaming(false);
    setIsStopping(false);
    setIsLoadingHistory(true);
    setIsLoadingEarlier(false);
    setHistoryCursor(null);
    setReconnectAttempt(0);
    clearQueue();

    try {
      const page = await fetchThreadRuns(threadId, undefined, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setRuns(
        page.runs.map((snapshot) => ({
          runId: snapshot.runId,
          state: fromRunSnapshot(snapshot),
        })),
      );
      setHistoryCursor(page.nextCursor);
      setFollowVersion((value) => value + 1);
    } catch (cause) {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "加载会话失败");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoadingHistory(false);
      }
    }
  }

  async function loadEarlierRuns() {
    if (!activeThreadId || !historyCursor || isLoadingEarlier) {
      return;
    }

    setIsLoadingEarlier(true);

    try {
      const page = await fetchThreadRuns(activeThreadId, historyCursor);
      const older = page.runs.map((snapshot) => ({
        runId: snapshot.runId,
        state: fromRunSnapshot(snapshot),
      }));

      setRuns((previous) => {
        const known = new Set(previous.map((run) => run.runId));

        return [...older.filter((run) => !known.has(run.runId)), ...previous];
      });
      setHistoryCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载更早的会话失败");
    } finally {
      setIsLoadingEarlier(false);
    }
  }

  async function startReleaseFromHandoff(runId: string, scenarioId: string) {
    if (handoffStartingRef.current) {
      return;
    }

    handoffStartingRef.current = true;

    try {
      const run = await createReleaseRun(scenarioId, undefined, runId);

      navigate(`#/releases/${run.threadId}?run=${run.runId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建发版失败");
    } finally {
      handoffStartingRef.current = false;
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

  function resumeRunFromCursor(runId: string) {
    const lastEventId = lastEventIdRef.current;

    if (!lastEventId) {
      return;
    }

    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsStreaming(true);
    setIsStopping(false);
    setReconnectAttempt(0);
    setFollowVersion((value) => value + 1);

    void consumeEvents(
      controller,
      runId,
      streamRunEvents(runId, {
        signal: controller.signal,
        lastEventId,
        onRetry: setReconnectAttempt,
      }),
    );
  }

  function resumeCurrentRun() {
    const runId = runIdRef.current;
    const lastEventId = lastEventIdRef.current;

    if (!runId || !lastEventId || isStreaming) {
      return;
    }

    resumeRunFromCursor(runId);
  }

  function cancelCurrentRun() {
    const runId = runIdRef.current;
    clearQueue();

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
          runId,
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

  async function resolveToolApproval(
    runId: string,
    approvalId: string,
    approved: boolean,
  ) {
    if (resolvingApprovalId) {
      return;
    }

    setResolvingApprovalId(approvalId);
    setError(null);

    try {
      await resolveApprovalRequest(runId, approvalId, { approved });

      if (runIdRef.current === runId) {
        resumeRunFromCursor(runId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交审批失败");
    } finally {
      setResolvingApprovalId(null);
    }
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
    setIsLoadingEarlier(false);
    setActiveThreadId(null);
    setHistoryCursor(null);
    setReconnectAttempt(0);
    clearQueue();
  }

  const activeRun = runs.at(-1)?.state ?? null;
  const isPaused = activeRun?.status === "paused";
  const isWaitingApproval = activeRun?.status === "waiting_approval";

  const { queued, enqueueMessage, removeQueued, clearQueue } = useChatQueue({
    isStreaming,
    isPaused,
    isWaitingApproval,
    isLoadingHistory,
    onSend: (text) => {
      void startRun(undefined, text);
    },
  });

  const chatRows = useMemo(
    () =>
      buildChatRows({
        runs,
        isStreaming,
        isPaused,
        error,
        reconnectAttempt,
        isLoadingHistory,
        resolvingApprovalId,
      }),
    [
      runs,
      isStreaming,
      isPaused,
      error,
      reconnectAttempt,
      isLoadingHistory,
      resolvingApprovalId,
    ],
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
  const runtimeLabel =
    runtime === null
      ? "连接运行时…"
      : runtime.mode === "agent"
        ? `实时 Agent · ${runtime.provider ?? "模型"}/${runtime.model ?? ""} · 知识库 ${runtime.docs ?? 0} 篇`
        : "Mock 模式 · 本地 fixture 回放，不调用模型";
  const prompts = quickPromptsFor(runtime?.mode);
  const eventCountLabel =
    events.length > 999
      ? `${Math.min(9, Math.floor(events.length / 1000))}k+`
      : String(events.length);
  const emptyDescription =
    runtime?.mode === "agent"
      ? "检索本地工程知识库，LangGraph 工具循环，回答带引用来源。"
      : "事件从本地 fixture 逐条流式回放，并实时投影到聊天界面。";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || isPaused || isWaitingApproval || isLoadingHistory) {
      return;
    }

    setInput("");

    if (isStreaming) {
      enqueueMessage(text);
      return;
    }

    void startRun(undefined, text);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/20">
      <AppHeader
        subtitle={runtimeLabel}
        activeView="chat"
        onNavigate={(view) =>
          navigate(view === "chat" ? "#/chat" : "#/releases")
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => togglePanel("events")}
          aria-pressed={activePanel === "events"}
        >
          <Activity />
          <span className="sr-only lg:not-sr-only">事件</span>
          <span
            className="inline-block w-[3ch] shrink-0 text-right font-mono tabular-nums"
            title={String(events.length)}
          >
            {eventCountLabel}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={() => togglePanel("performance")}
          aria-pressed={activePanel === "performance"}
        >
          <Gauge />
          <span className="hidden lg:inline">性能</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetConversation}
          disabled={!hasConversation}
        >
          <RotateCcw />
          <span className="sr-only lg:not-sr-only">新对话</span>
        </Button>
      </AppHeader>

      <div className="relative flex min-h-0 flex-1">
        {runtime?.mode === "agent" ? (
          <ThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            loading={isLoadingThreads}
            onSelect={(threadId) => void openThread(threadId)}
            onNew={resetConversation}
          />
        ) : null}

        <main className="flex min-h-0 flex-1 flex-col">
          {historyCursor ? (
            <div className="flex justify-center border-b bg-background/80 px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadEarlierRuns()}
                disabled={isLoadingEarlier}
              >
                {isLoadingEarlier ? "加载中…" : "加载更早的对话"}
              </Button>
            </div>
          ) : null}

          {chatRows.length > 0 ? (
            <ChatFeed
              rows={chatRows}
              version={events.length}
              followVersion={followVersion}
              streaming={isStreaming}
              onResolveApproval={resolveToolApproval}
              onStartRelease={startReleaseFromHandoff}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable_both-edges]">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-8">
                <EmptyState
                  prompts={prompts}
                  description={emptyDescription}
                  onPick={handleQuickPick}
                />
              </div>
            </div>
          )}

          <ChatComposer
            input={input}
            queued={queued}
            pausedSeq={activeRun?.lastSeq ?? 0}
            isStreaming={isStreaming}
            isPaused={isPaused}
            isWaitingApproval={isWaitingApproval}
            isLoadingHistory={isLoadingHistory}
            isStopping={isStopping}
            onSubmit={handleSubmit}
            onInputChange={setInput}
            onRemoveQueued={removeQueued}
            onPause={pauseCurrentRun}
            onResume={resumeCurrentRun}
            onCancel={cancelCurrentRun}
          />
        </main>

        {activePanel === "events" ? (
          <EventInspector
            events={events}
            state={activeRun}
            onClose={closePanel}
          />
        ) : null}

        {activePanel === "performance" ? (
          <PerformancePanel
            active={isStreaming || runs.length > 0}
            totalBlocks={totalBlocks}
          />
        ) : null}

        <div id="notes-root" className="contents" />
      </div>
    </div>
  );
}

