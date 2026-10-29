import type {
  ApprovalState,
  CitationState,
  RunState,
  ToolCallState,
} from "@agent-workbench/protocol";

export interface ChatRun {
  runId: string;
  state: RunState;
}

export type ChatRow =
  | { kind: "reconnect"; key: string; attempt: number }
  | { kind: "error"; key: string; message: string }
  | { kind: "user"; key: string; text: string }
  | {
      kind: "handoff";
      key: string;
      runId: string;
      scenarioId: string;
      title: string;
      service: string;
      version: string;
      reason?: string;
    }
  | {
      kind: "assistant-header";
      key: string;
      runStatus: RunState["status"] | null;
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
  | {
      kind: "reasoning";
      key: string;
      text: string;
      streaming: boolean;
    }
  | {
      kind: "tool";
      key: string;
      runId: string;
      toolCall: ToolCallState;
      approval?: ApprovalState;
      canResolve: boolean;
      resolving: boolean;
    }
  | { kind: "cursor"; key: string }
  | { kind: "citations"; key: string; citations: CitationState[] }
  | { kind: "paused"; key: string; seq: number }
  | {
      kind: "run-error";
      key: string;
      code: string;
      message: string;
      retryable: boolean;
      fatal: boolean;
    }
  | { kind: "pending"; key: string }
  | { kind: "loading"; key: string };

function parseHandoff(result: string | undefined) {
  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result) as {
      type?: unknown;
      scenarioId?: unknown;
      title?: unknown;
      service?: unknown;
      version?: unknown;
      reason?: unknown;
    };

    if (
      parsed.type !== "release_handoff" ||
      typeof parsed.scenarioId !== "string" ||
      typeof parsed.title !== "string" ||
      typeof parsed.service !== "string" ||
      typeof parsed.version !== "string"
    ) {
      return null;
    }

    return {
      scenarioId: parsed.scenarioId,
      title: parsed.title,
      service: parsed.service,
      version: parsed.version,
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return null;
  }
}

export function buildChatRows(input: {
  runs: ChatRun[];
  isStreaming: boolean;
  isPaused: boolean;
  error: string | null;
  reconnectAttempt: number;
  isLoadingHistory: boolean;
  resolvingApprovalId: string | null;
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
    const lastAssistantMessageId = [...run.state.messageOrder]
      .reverse()
      .find((messageId) => run.state.messages[messageId]?.role === "assistant");
    const timeline: Array<
      | { seq: number; kind: "message"; messageId: string }
      | { seq: number; kind: "tool"; toolCallId: string }
      | { seq: number; kind: "error"; index: number }
    > = [];

    for (const messageId of run.state.messageOrder) {
      const message = run.state.messages[messageId];

      if (message) {
        timeline.push({ seq: message.startedAtSeq, kind: "message", messageId });
      }
    }

    for (const toolCallId of run.state.toolCallOrder) {
      const toolCall = run.state.toolCalls[toolCallId];

      if (toolCall) {
        timeline.push({ seq: toolCall.startedAtSeq, kind: "tool", toolCallId });
      }
    }

    for (const [index, error] of run.state.errors.entries()) {
      timeline.push({ seq: error.seq, kind: "error", index });
    }

    timeline.sort((left, right) => left.seq - right.seq);

    for (const item of timeline) {
      if (item.kind === "tool") {
        const toolCall = run.state.toolCalls[item.toolCallId];

        if (!toolCall) {
          continue;
        }

        const handoff =
          toolCall.name === "prepare_release" &&
          toolCall.status === "success"
            ? parseHandoff(toolCall.result)
            : null;

        if (handoff) {
          rows.push({
            kind: "handoff",
            key: `${run.runId}:handoff:${toolCall.id}`,
            runId: run.runId,
            ...handoff,
          });
          continue;
        }

        const approval = toolCall.approvalId
          ? run.state.approvals[toolCall.approvalId]
          : undefined;

        rows.push({
          kind: "tool",
          key: `${run.runId}:tool:${toolCall.id}`,
          runId: run.runId,
          toolCall,
          approval,
          canResolve:
            approval?.status === "pending" &&
            run.state.status === "waiting_approval",
          resolving: approval ? input.resolvingApprovalId === approval.id : false,
        });
        continue;
      }

      if (item.kind === "error") {
        const error = run.state.errors[item.index];

        if (error) {
          rows.push({
            kind: "run-error",
            key: `${run.runId}:error:${error.seq}`,
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            fatal: error.fatal,
          });
        }

        continue;
      }

      const message = run.state.messages[item.messageId];

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
        runStatus:
          message.id === lastAssistantMessageId ? run.state.status : null,
        streaming,
      });

      if (
        message.blockIds.length === 0 &&
        message.reasoning.length === 0 &&
        streaming
      ) {
        rows.push({
          kind: "assistant-thinking",
          key: `${run.runId}:${message.id}:thinking`,
        });
      }

      for (const reasoning of message.reasoning) {
        if (reasoning.text.length === 0 && reasoning.status !== "streaming") {
          continue;
        }

        rows.push({
          kind: "reasoning",
          key: `${run.runId}:${reasoning.id}`,
          text: reasoning.text,
          streaming: reasoning.status === "streaming",
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
          citations: message.citations,
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
