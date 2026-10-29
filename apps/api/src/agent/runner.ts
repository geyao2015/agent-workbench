import {
  AIMessage,
  HumanMessage,
  type AIMessageChunk,
  type BaseMessage,
  type ToolMessage,
} from "@langchain/core/messages";

import type { KnowledgeBase } from "../kb/index.js";
import type { RunLog } from "../runs/run-log.js";
import type { ChatAgent } from "./graph.js";
import {
  inspectUserPrompt,
  redactSecrets,
  StreamingRedactor,
} from "./guard.js";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

interface ToolStreamState {
  index: number;
  id: string;
  name: string;
  argsText: string;
  started: boolean;
  ready: boolean;
  argsUpdatedAt?: number;
  startedAt: number;
}

const MAX_CITATIONS = 6;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 4000;

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }

      return "";
    })
    .join("");
}

function reasoningFromMessage(message: AIMessageChunk): string {
  const reasoning = message.additional_kwargs?.reasoning_content;

  if (typeof reasoning === "string" && reasoning.length > 0) {
    return reasoning;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      const block = part as { type?: string; thinking?: string; reasoning?: string };

      if (block.type === "thinking" && typeof block.thinking === "string") {
        return block.thinking;
      }

      if (block.type === "reasoning" && typeof block.reasoning === "string") {
        return block.reasoning;
      }

      return "";
    })
    .join("");
}

function parseArgs(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class AgentRunner {
  private readonly toolStates = new Map<number, ToolStreamState>();
  private readonly toolStateById = new Map<string, ToolStreamState>();
  private readonly citations = new Map<string, { title: string; locator?: string }>();
  private readonly textRedactor = new StreamingRedactor();
  private readonly reasoningRedactor = new StreamingRedactor();
  private nextToolIndex = 0;
  private reasoningId: string | null = null;
  private reasoningCount = 0;
  private pendingInputTokens = 0;
  private pendingOutputTokens = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(
    private readonly agent: ChatAgent,
    private readonly log: RunLog,
    private readonly kb: KnowledgeBase,
    private readonly messageId: string,
  ) {}

  async run(input: {
    threadId: string;
    prompt: string;
    history: HistoryMessage[];
    signal: AbortSignal;
  }): Promise<void> {
    const hasCheckpoint = await this.agent.hasCheckpoint(input.threadId);
    const seed = hasCheckpoint ? [] : this.seedMessages(input.history);
    const messages: BaseMessage[] = [...seed, new HumanMessage(input.prompt)];

    try {
      const stream = await this.agent.graph.stream(
        { messages },
        {
          configurable: { thread_id: input.threadId },
          signal: input.signal,
          streamMode: "messages",
        },
      );

      for await (const output of stream) {
        const [message] = output as unknown as [BaseMessage, Record<string, unknown>];
        const type = message._getType();

        if (type === "ai") {
          this.handleAiMessage(message as AIMessageChunk);
        } else if (type === "tool") {
          this.handleToolMessage(message as ToolMessage);
        }
      }

      this.completeReasoning();
      this.flushText();
      this.commitUsage();
      this.emitCitations();
      this.log.append("message.completed", {
        messageId: this.messageId,
        stopReason: "stop",
      });
      this.log.append("run.completed", {
        status: "done",
        usage: {
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
        },
      });
    } catch (cause) {
      this.completeReasoning();
      this.flushText();

      if (input.signal.aborted || isAbortError(cause)) {
        this.log.append("message.completed", {
          messageId: this.messageId,
          stopReason: "cancelled",
        });
        this.log.append("run.completed", { status: "cancelled" });
        return;
      }

      this.log.append("message.completed", {
        messageId: this.messageId,
        stopReason: "error",
      });
      this.log.append("run.failed", {
        code: "model_error",
        message: cause instanceof Error ? cause.message : "模型调用失败",
        retryable: true,
      });
    }
  }

  private seedMessages(history: HistoryMessage[]): BaseMessage[] {
    return history
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) =>
        message.role === "user"
          ? new HumanMessage(message.text.slice(0, MAX_HISTORY_CHARS))
          : new AIMessage(message.text.slice(0, MAX_HISTORY_CHARS)),
      )
      .filter((message) => textFromContent(message.content).trim().length > 0)
      .filter(
        (message) =>
          message._getType() !== "human" ||
          !inspectUserPrompt(textFromContent(message.content)).blocked,
      );
  }

  private handleAiMessage(message: AIMessageChunk): void {
    const reasoning = reasoningFromMessage(message);

    if (reasoning) {
      this.appendReasoning(reasoning);
    }

    const text = textFromContent(message.content);

    if (text) {
      this.completeReasoning();

      const safe = this.textRedactor.push(text);

      if (safe) {
        this.log.append("text.delta", {
          messageId: this.messageId,
          delta: safe,
        });
      }
    }

    const toolCallChunks = message.tool_call_chunks ?? [];

    for (const chunk of toolCallChunks) {
      const index = chunk.index ?? this.nextToolIndex;
      const state = this.ensureToolState(index);
      this.nextToolIndex = Math.max(this.nextToolIndex, index + 1);

      if (chunk.id) {
        this.bindToolId(state, chunk.id);
      }

      if (chunk.name) {
        state.name = chunk.name;
      }

      this.startToolIfReady(state);

      if (typeof chunk.args === "string" && chunk.args.length > 0) {
        // 部分模型会先发一个空的 "{}" 占位，等真实参数到达后再解析
        if (!(chunk.args === "{}" && state.argsText.length === 0)) {
          state.argsText += chunk.args;
          state.argsUpdatedAt = Date.now();
          this.log.append("tool.args.delta", {
            toolCallId: state.id,
            delta: chunk.args,
          });
        }
      }
    }

    if (toolCallChunks.length === 0) {
      for (const call of message.tool_calls ?? []) {
        if (!call.id) {
          continue;
        }

        const state = this.findOrCreateToolState(call.id);

        if (call.name) {
          state.name = call.name;
        }

        this.startToolIfReady(state);

        if (state.argsText.length === 0 && call.args !== undefined) {
          state.argsText = JSON.stringify(call.args);
          state.argsUpdatedAt = Date.now();
          this.log.append("tool.args.delta", {
            toolCallId: state.id,
            delta: state.argsText,
          });
        }

        this.readyToolIfParsed(state);
      }
    }

    const usage = message.usage_metadata;

    if (usage) {
      this.pendingInputTokens = Math.max(this.pendingInputTokens, usage.input_tokens);
      this.pendingOutputTokens = Math.max(this.pendingOutputTokens, usage.output_tokens);
    }
  }

  private handleToolMessage(message: ToolMessage): void {
    this.completeReasoning();
    this.commitUsage();

    const callId = message.tool_call_id;
    const state = this.findOrCreateToolState(callId);

    if (!state.name && message.name) {
      state.name = message.name;
    }

    this.startToolIfReady(state);
    this.readyToolIfParsed(state, true);

    const content = redactSecrets(
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    );
    const finishedAt = Date.now();

    this.log.append("tool.result", {
      toolCallId: state.id,
      status: message.status === "error" ? "error" : "success",
      content,
      durationMs: Math.max(0, finishedAt - (state.argsUpdatedAt ?? state.startedAt)),
    });

    this.collectCitations(content);
  }

  private appendReasoning(delta: string): void {
    if (!this.reasoningId) {
      this.reasoningId = `${this.messageId}:r${this.reasoningCount}`;
      this.reasoningCount += 1;
      this.log.append("reasoning.started", {
        messageId: this.messageId,
        blockId: this.reasoningId,
      });
    }

    const safe = this.reasoningRedactor.push(delta);

    if (safe) {
      this.log.append("reasoning.delta", {
        messageId: this.messageId,
        delta: safe,
        blockId: this.reasoningId,
      });
    }
  }

  private completeReasoning(): void {
    if (!this.reasoningId) {
      return;
    }

    const tail = this.reasoningRedactor.flush();

    if (tail) {
      this.log.append("reasoning.delta", {
        messageId: this.messageId,
        delta: tail,
        blockId: this.reasoningId,
      });
    }

    this.log.append("reasoning.completed", {
      messageId: this.messageId,
      blockId: this.reasoningId,
    });
    this.reasoningId = null;
  }

  private flushText(): void {
    const tail = this.textRedactor.flush();

    if (!tail) {
      return;
    }

    this.log.append("text.delta", {
      messageId: this.messageId,
      delta: tail,
    });
  }

  private ensureToolState(index: number): ToolStreamState {
    const existing = this.toolStates.get(index);

    if (existing) {
      return existing;
    }

    const state: ToolStreamState = {
      index,
      id: `${this.log.runId}:tool:${index}`,
      name: "",
      argsText: "",
      started: false,
      ready: false,
      startedAt: Date.now(),
    };

    this.toolStates.set(index, state);
    this.toolStateById.set(state.id, state);

    return state;
  }

  private findOrCreateToolState(callId: string): ToolStreamState {
    const existing = this.toolStateById.get(callId);

    if (existing) {
      return existing;
    }

    const state = this.ensureToolState(this.nextToolIndex);
    this.nextToolIndex += 1;
    this.bindToolId(state, callId);

    return state;
  }

  private bindToolId(state: ToolStreamState, id: string): void {
    if (state.id === id) {
      return;
    }

    this.toolStateById.delete(state.id);
    state.id = id;
    this.toolStateById.set(id, state);
  }

  private startToolIfReady(state: ToolStreamState): void {
    if (state.started || !state.name) {
      return;
    }

    state.started = true;
    this.log.append("tool.started", {
      toolCallId: state.id,
      name: state.name,
    });
  }

  private readyToolIfParsed(state: ToolStreamState, final = false): void {
    if (state.ready || !state.started) {
      return;
    }

    const parsed = parseArgs(state.argsText);
    const args = parsed === undefined && final ? {} : parsed;

    if (args === undefined) {
      return;
    }

    state.ready = true;
    this.log.append("tool.ready", {
      toolCallId: state.id,
      args,
    });
  }

  private collectCitations(content: string): void {
    const pattern = /sourceId=([a-z0-9._-]+)(?:\s*\|\s*([^\n|]+))?/gi;

    for (const match of content.matchAll(pattern)) {
      const sourceId = match[1];

      if (!sourceId || this.citations.has(sourceId)) {
        continue;
      }

      const doc = this.kb.get(sourceId);
      const locator = match[2]?.trim();

      this.citations.set(sourceId, {
        title: doc?.title ?? sourceId,
        ...(locator && locator !== doc?.title ? { locator } : {}),
      });
    }
  }

  private emitCitations(): void {
    let index = 0;

    for (const [sourceId, citation] of this.citations) {
      if (index >= MAX_CITATIONS) {
        break;
      }

      this.log.append("citation.added", {
        messageId: this.messageId,
        citationId: `cit_${sourceId}`,
        sourceId,
        title: citation.title,
        ...(citation.locator ? { locator: citation.locator } : {}),
      });
      index += 1;
    }
  }

  private commitUsage(): void {
    this.inputTokens += this.pendingInputTokens;
    this.outputTokens += this.pendingOutputTokens;
    this.pendingInputTokens = 0;
    this.pendingOutputTokens = 0;
  }
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}
