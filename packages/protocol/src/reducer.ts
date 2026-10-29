import { segmentMarkdownBlocks } from "./blocks.js";
import type { BlockKind } from "./blocks.js";
import { isKnownEventType } from "./events.js";
import type {
  AgentEvent,
  AgentEventEnvelope,
  ArtifactKind,
  Risk,
  RunKind,
} from "./events.js";

export type RunStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunState {
  runId: string;
  threadId: string;
  kind: RunKind;
  status: RunStatus;
  lastSeq: number;
  appliedEventIds: Set<string>;

  messages: Record<string, MessageState>;
  messageOrder: string[];

  blocks: Record<string, BlockState>;
  toolCalls: Record<string, ToolCallState>;
  toolCallOrder: string[];

  stages: Record<string, StageState>;
  stageOrder: string[];

  approvals: Record<string, ApprovalState>;
  artifacts: Record<string, ArtifactState>;

  errors: Array<{
    code: string;
    message: string;
    seq: number;
    retryable: boolean;
    fatal: boolean;
  }>;
}

export interface CitationState {
  id: string;
  sourceId: string;
  title?: string;
  locator?: string;
}

export interface ReasoningState {
  id: string;
  messageId: string;
  text: string;
  status: "streaming" | "completed";
  startedAtSeq: number;
}

export interface MessageState {
  id: string;
  role: "user" | "assistant";
  status: "streaming" | "completed" | "error";
  text: string;
  blockIds: string[];
  citations: CitationState[];
  reasoning: ReasoningState[];
  startedAtSeq: number;
}

export interface BlockState {
  id: string;
  messageId: string;
  index: number;
  raw: string;
  status: "open" | "closed";
  kind?: BlockKind;
}

export interface ToolCallState {
  id: string;
  name: string;
  argsText: string;
  args?: unknown;
  status:
    | "streaming"
    | "ready"
    | "running"
    | "success"
    | "error"
    | "awaiting_approval"
    | "rejected";
  result?: string;
  error?: { code: string; message: string };
  approvalId?: string;
  durationMs?: number;
  startedAtSeq: number;
}

export interface StageState {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  summary?: string;
  startedAtSeq: number;
}

export type ApprovalScope = "tool" | "stage";

export interface ApprovalState {
  id: string;
  scope?: ApprovalScope;
  toolCallId?: string;
  stageId?: string;
  title: string;
  description?: string;
  args: unknown;
  risk: Risk;
  status: "pending" | "approved" | "rejected" | "expired";
  note?: string;
}

export interface ArtifactState {
  id: string;
  kind: ArtifactKind;
  title: string;
  mime?: string;
  size?: number;
  uri?: string;
  stageId?: string;
  status: "created" | "ready" | "error";
}

export function createRunState(input: {
  runId: string;
  threadId: string;
  kind: RunKind;
}): RunState {
  return {
    runId: input.runId,
    threadId: input.threadId,
    kind: input.kind,
    status: "idle",
    lastSeq: 0,
    appliedEventIds: new Set(),
    messages: {},
    messageOrder: [],
    blocks: {},
    toolCalls: {},
    toolCallOrder: [],
    stages: {},
    stageOrder: [],
    approvals: {},
    artifacts: {},
    errors: [],
  };
}

function withEventMeta(state: RunState, event: { eventId: string; seq: number }): RunState {
  const appliedEventIds = new Set(state.appliedEventIds);
  appliedEventIds.add(event.eventId);

  return { ...state, lastSeq: event.seq, appliedEventIds };
}

function definedPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function appendTextDelta(
  state: RunState,
  messageId: string,
  delta: string,
  blockId?: string,
): RunState {
  const message = state.messages[messageId];

  if (!message) {
    return state;
  }

  if (blockId) {
    const existing = state.blocks[blockId];

    if (existing?.status === "closed") {
      return state;
    }

    const block: BlockState = existing ?? {
      id: blockId,
      messageId: message.id,
      index: message.blockIds.length,
      raw: "",
      status: "open",
    };
    const blocks = {
      ...state.blocks,
      [blockId]: { ...block, raw: block.raw + delta },
    };
    const blockIds = existing ? message.blockIds : [...message.blockIds, blockId];
    const messages = {
      ...state.messages,
      [message.id]: { ...message, text: message.text + delta, blockIds },
    };

    return { ...state, messages, blocks };
  }

  const previousBlockIds = message.blockIds;
  const lastBlockId = previousBlockIds.at(-1);
  const lastBlock = lastBlockId ? state.blocks[lastBlockId] : undefined;
  const hasOpenTail = lastBlock?.status === "open";
  const prefixBlockIds = hasOpenTail
    ? previousBlockIds.slice(0, -1)
    : previousBlockIds;
  const tailText = hasOpenTail ? lastBlock.raw : "";
  const text = message.text + delta;
  const segments = segmentMarkdownBlocks(
    message.id,
    tailText + delta,
    prefixBlockIds.length,
  );
  const blocks: Record<string, BlockState> = { ...state.blocks };

  if (hasOpenTail && lastBlockId) {
    delete blocks[lastBlockId];
  }

  for (const segment of segments) {
    blocks[segment.id] = {
      id: segment.id,
      messageId: message.id,
      index: segment.index,
      raw: segment.raw,
      status: segment.status,
      kind: segment.kind,
    };
  }

  const blockIds = [
    ...prefixBlockIds,
    ...segments.map((segment) => segment.id),
  ];
  const messages = {
    ...state.messages,
    [message.id]: {
      ...message,
      text,
      blockIds,
    },
  };

  return { ...state, messages, blocks };
}

function findReasoning(
  message: MessageState,
  blockId?: string,
): ReasoningState | undefined {
  if (blockId) {
    return message.reasoning.find((item) => item.id === blockId);
  }

  for (let index = message.reasoning.length - 1; index >= 0; index -= 1) {
    const item = message.reasoning[index];

    if (item?.status === "streaming") {
      return item;
    }
  }

  return undefined;
}

function appendError(
  state: RunState,
  code: string,
  message: string,
  seq: number,
  options: { retryable: boolean; fatal: boolean },
): RunState {
  return {
    ...state,
    errors: [...state.errors, { code, message, seq, ...options }],
  };
}

function applyKnownEvent(state: RunState, event: AgentEvent): RunState {
  switch (event.type) {
    case "run.started": {
      return { ...state, kind: event.payload.kind, status: "running" };
    }

    case "run.paused": {
      return {
        ...state,
        status: event.payload.reason === "approval" ? "waiting_approval" : "paused",
      };
    }

    case "run.resumed": {
      return { ...state, status: "running" };
    }

    case "run.completed": {
      const status =
        event.payload.status === "done"
          ? "completed"
          : event.payload.status === "cancelled"
            ? "cancelled"
            : "failed";

      return { ...state, status };
    }

    case "run.failed": {
      return appendError(
        { ...state, status: "failed" },
        event.payload.code,
        event.payload.message,
        event.seq,
        { retryable: event.payload.retryable, fatal: true },
      );
    }

    case "message.started": {
      const { messageId } = event.payload;
      const alreadyOrdered = state.messageOrder.includes(messageId);
      const messages = {
        ...state.messages,
        [messageId]: {
          id: messageId,
          role: event.payload.role,
          status: "streaming" as const,
          text: "",
          blockIds: [],
          citations: [],
          reasoning: [],
          startedAtSeq: event.seq,
        },
      };

      return {
        ...state,
        messages,
        messageOrder: alreadyOrdered ? state.messageOrder : [...state.messageOrder, messageId],
      };
    }

    case "text.delta": {
      return appendTextDelta(
        state,
        event.payload.messageId,
        event.payload.delta,
        event.payload.blockId,
      );
    }

    case "text.block.completed": {
      const { messageId, blockId } = event.payload;
      const message = state.messages[messageId];

      if (!message) {
        return state;
      }

      const existing = state.blocks[blockId];
      const block: BlockState = existing ?? {
        id: blockId,
        messageId,
        index: message.blockIds.length,
        raw: "",
        status: "closed",
      };
      const closedBlock: BlockState = { ...block, status: "closed" };
      const blocks: Record<string, BlockState> = {
        ...state.blocks,
        [blockId]: closedBlock,
      };
      const blockIds = existing ? message.blockIds : [...message.blockIds, blockId];
      const messages = { ...state.messages, [messageId]: { ...message, blockIds } };

      return { ...state, messages, blocks };
    }

    case "message.completed": {
      const message = state.messages[event.payload.messageId];

      if (!message) {
        return state;
      }

      const blocks = Object.fromEntries(
        Object.entries(state.blocks).map(([id, block]) => [
          id,
          block.messageId === message.id && block.status === "open"
            ? { ...block, status: "closed" as const }
            : block,
        ]),
      );
      const reasoning = message.reasoning.map((reasoningItem) =>
        reasoningItem.status === "streaming"
          ? { ...reasoningItem, status: "completed" as const }
          : reasoningItem,
      );

      return {
        ...state,
        blocks,
        messages: {
          ...state.messages,
          [message.id]: { ...message, status: "completed", reasoning },
        },
      };
    }

    case "citation.added": {
      const message = state.messages[event.payload.messageId];

      if (
        !message ||
        message.citations.some(
          (citation) => citation.id === event.payload.citationId,
        )
      ) {
        return state;
      }

      const citation: CitationState = {
        id: event.payload.citationId,
        sourceId: event.payload.sourceId,
        ...(event.payload.title ? { title: event.payload.title } : {}),
        ...(event.payload.locator ? { locator: event.payload.locator } : {}),
      };

      return {
        ...state,
        messages: {
          ...state.messages,
          [message.id]: {
            ...message,
            citations: [...message.citations, citation],
          },
        },
      };
    }

    case "tool.started": {
      const { toolCallId, name } = event.payload;
      const alreadyOrdered = state.toolCallOrder.includes(toolCallId);
      const toolCalls = {
        ...state.toolCalls,
        [toolCallId]: {
          id: toolCallId,
          name,
          argsText: "",
          status: "streaming" as const,
          startedAtSeq: event.seq,
        },
      };

      return {
        ...state,
        toolCalls,
        toolCallOrder: alreadyOrdered ? state.toolCallOrder : [...state.toolCallOrder, toolCallId],
      };
    }

    case "tool.args.delta": {
      const toolCall = state.toolCalls[event.payload.toolCallId];

      if (!toolCall) {
        return state;
      }

      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: {
            ...toolCall,
            argsText: toolCall.argsText + event.payload.delta,
          },
        },
      };
    }

    case "tool.ready": {
      const toolCall = state.toolCalls[event.payload.toolCallId];

      if (!toolCall) {
        return state;
      }

      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: { ...toolCall, args: event.payload.args, status: "ready" },
        },
      };
    }

    case "tool.result": {
      const toolCall = state.toolCalls[event.payload.toolCallId];

      if (!toolCall) {
        return state;
      }

      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [toolCall.id]: {
            ...toolCall,
            status: event.payload.status,
            result: event.payload.content,
            durationMs: event.payload.durationMs,
            error:
              event.payload.status === "error"
                ? { code: "tool_error", message: event.payload.content }
                : undefined,
          },
        },
      };
    }

    case "tool.approval_required": {
      const { toolCallId, approvalId, title, description, risk, args } = event.payload;
      const toolCall = state.toolCalls[toolCallId];
      const toolCalls = toolCall
        ? {
            ...state.toolCalls,
            [toolCallId]: { ...toolCall, status: "awaiting_approval" as const, approvalId },
          }
        : state.toolCalls;

      return {
        ...state,
        toolCalls,
        approvals: {
          ...state.approvals,
          [approvalId]: {
            id: approvalId,
            scope: "tool",
            toolCallId,
            title,
            description,
            args,
            risk,
            status: "pending",
          },
        },
      };
    }

    case "approval.required": {
      const { approvalId, scope, stageId, title, description, risk, args } =
        event.payload;

      return {
        ...state,
        approvals: {
          ...state.approvals,
          [approvalId]: {
            id: approvalId,
            scope,
            stageId,
            title,
            description,
            args,
            risk,
            status: "pending",
          },
        },
      };
    }

    case "approval.resolved": {
      const { approvalId, approved, note } = event.payload;
      const approval = state.approvals[approvalId];

      if (!approval) {
        return state;
      }

      return {
        ...state,
        approvals: {
          ...state.approvals,
          [approvalId]: {
            ...approval,
            status: approved ? "approved" : "rejected",
            note,
          },
        },
      };
    }

    case "tool.approval_resolved": {
      const { toolCallId, approvalId, approved, note } = event.payload;
      const approval = state.approvals[approvalId];
      const toolCall = state.toolCalls[toolCallId];
      const approvals = approval
        ? {
            ...state.approvals,
            [approvalId]: {
              ...approval,
              status: approved ? ("approved" as const) : ("rejected" as const),
              note,
            },
          }
        : state.approvals;
      const toolCalls = toolCall
        ? {
            ...state.toolCalls,
            [toolCallId]: {
              ...toolCall,
              status: approved ? ("running" as const) : ("rejected" as const),
            },
          }
        : state.toolCalls;

      return { ...state, approvals, toolCalls };
    }

    case "stage.started": {
      const { stageId, name } = event.payload;
      const alreadyOrdered = state.stageOrder.includes(stageId);
      const stages = {
        ...state.stages,
        [stageId]: {
          id: stageId,
          name,
          status: "running" as const,
          startedAtSeq: event.seq,
        },
      };

      return {
        ...state,
        stages,
        stageOrder: alreadyOrdered ? state.stageOrder : [...state.stageOrder, stageId],
      };
    }

    case "stage.completed": {
      const stage = state.stages[event.payload.stageId];

      if (!stage) {
        return state;
      }

      return {
        ...state,
        stages: {
          ...state.stages,
          [stage.id]: {
            ...stage,
            status: event.payload.status,
            summary: event.payload.summary,
          },
        },
      };
    }

    case "artifact.created": {
      const { artifactId, kind, title, mime, size, uri, stageId } =
        event.payload;

      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [artifactId]: {
            id: artifactId,
            kind,
            title,
            mime,
            size,
            uri,
            stageId,
            status: "ready",
          },
        },
      };
    }

    case "artifact.updated": {
      const artifact = state.artifacts[event.payload.artifactId];

      if (!artifact) {
        return state;
      }

      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [artifact.id]: {
            ...artifact,
            ...definedPatch(event.payload.patch ?? {}),
          },
        },
      };
    }

    case "error": {
      return appendError(
        state,
        event.payload.code,
        event.payload.message,
        event.seq,
        { retryable: event.payload.retryable, fatal: false },
      );
    }

    case "reasoning.started": {
      const message = state.messages[event.payload.messageId];

      if (!message) {
        return state;
      }

      const id =
        event.payload.blockId ?? `${message.id}:r${message.reasoning.length}`;

      if (message.reasoning.some((item) => item.id === id)) {
        return state;
      }

      return {
        ...state,
        messages: {
          ...state.messages,
          [message.id]: {
            ...message,
            reasoning: [
              ...message.reasoning,
              {
                id,
                messageId: message.id,
                text: "",
                status: "streaming",
                startedAtSeq: event.seq,
              },
            ],
          },
        },
      };
    }

    case "reasoning.delta": {
      const message = state.messages[event.payload.messageId];
      const target = message
        ? findReasoning(message, event.payload.blockId)
        : undefined;

      if (!message || !target) {
        return state;
      }

      return {
        ...state,
        messages: {
          ...state.messages,
          [message.id]: {
            ...message,
            reasoning: message.reasoning.map((item) =>
              item.id === target.id
                ? { ...item, text: item.text + event.payload.delta }
                : item,
            ),
          },
        },
      };
    }

    case "reasoning.completed": {
      const message = state.messages[event.payload.messageId];
      const target = message
        ? findReasoning(message, event.payload.blockId)
        : undefined;

      if (!message || !target) {
        return state;
      }

      return {
        ...state,
        messages: {
          ...state.messages,
          [message.id]: {
            ...message,
            reasoning: message.reasoning.map((item) =>
              item.id === target.id
                ? { ...item, status: "completed" as const }
                : item,
            ),
          },
        },
      };
    }

    default: {
      return state;
    }
  }
}

export function reduce(
  state: RunState,
  event: AgentEvent | AgentEventEnvelope,
): RunState {
  if (event.runId !== state.runId || event.threadId !== state.threadId) {
    return state;
  }

  if (event.seq <= state.lastSeq || state.appliedEventIds.has(event.eventId)) {
    return state;
  }

  const next = withEventMeta(state, event);

  if (!isKnownEventType(event.type)) {
    return next;
  }

  return applyKnownEvent(next, event as AgentEvent);
}
