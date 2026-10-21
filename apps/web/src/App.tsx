import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  createRunState,
  reduce,
  type AgentEvent,
  type RunState,
} from "@agent-workbench/protocol";

import { AppHeader } from "@/components/app-header";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatFeed } from "@/components/chat/chat-feed";
import { EmptyState } from "@/components/chat/empty-state";
import { EventInspector } from "@/components/devtools/event-inspector";
import { PerformancePanel } from "@/components/devtools/performance-panel";
import { buildChatRows, type ChatRun } from "@/lib/chat/chat-rows";
import type { QuickPrompt } from "@/lib/chat/quick-prompts";
import {
  recordFirstToken,
  recordTextUpdate,
  resetRenderStats,
} from "@/lib/render-stats";
import {
  cancelRun,
  fetchLongConversation,
  pauseRun,
  resolveApproval as resolveApprovalRequest,
  startChatRun,
  streamRunEvents,
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
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(
    null,
  );
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
    setReconnectAttempt(0);
  }

  const activeRun = runs.at(-1)?.state ?? null;
  const isPaused = activeRun?.status === "paused";
  const isWaitingApproval = activeRun?.status === "waiting_approval";
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || isStreaming || isPaused || isWaitingApproval) {
      return;
    }

    setInput("");
    void startRun(undefined, text);
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/20">
      <AppHeader
        eventCount={events.length}
        hasConversation={hasConversation}
        onToggleInspector={() => setShowInspector((value) => !value)}
        onTogglePerformance={() => setShowPerformance((value) => !value)}
        onReset={resetConversation}
      />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col">
          {chatRows.length > 0 ? (
            <ChatFeed
              rows={chatRows}
              version={events.length}
              followVersion={followVersion}
              streaming={isStreaming}
              onResolveApproval={resolveToolApproval}
            />
          ) : (
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-8">
                <EmptyState onPick={handleQuickPick} />
              </div>
            </div>
          )}

          <ChatComposer
            input={input}
            pausedSeq={activeRun?.lastSeq ?? 0}
            isStreaming={isStreaming}
            isPaused={isPaused}
            isWaitingApproval={isWaitingApproval}
            isLoadingHistory={isLoadingHistory}
            isStopping={isStopping}
            onSubmit={handleSubmit}
            onInputChange={setInput}
            onPause={pauseCurrentRun}
            onResume={resumeCurrentRun}
            onCancel={cancelCurrentRun}
          />
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

