import { randomUUID } from "node:crypto";

import type { RunKind } from "@agent-workbench/protocol";

import { inspectUserPrompt } from "../agent/guard.js";
import { AgentRunner, type HistoryMessage } from "../agent/runner.js";
import type { ChatAgent } from "../agent/graph.js";
import type { KnowledgeBase } from "../kb/index.js";
import { RunLog } from "./run-log.js";
import type { ThreadStore } from "./thread-store.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
  kind: RunKind;
  title: string;
  createdAt: number;
  log: RunLog;
}

export interface CreateChatRunInput {
  prompt: string;
  threadId?: string;
}

export interface RunManagerDeps {
  agent: ChatAgent;
  kb: KnowledgeBase;
  store: ThreadStore;
}

export class RunManager {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly messageIds = new Map<string, string>();
  private readonly activeThreads = new Map<string, string>();

  constructor(private readonly deps: RunManagerDeps) {}

  hasActiveRun(threadId: string): boolean {
    return this.activeThreads.has(threadId);
  }

  createChatRun(input: CreateChatRunInput): ActiveRun {
    const threadId = input.threadId ?? `thread_${randomUUID()}`;
    const runId = `run_${randomUUID()}`;
    const title = input.prompt.replace(/\s+/g, " ").slice(0, 40);
    const createdAt = Date.now();

    this.deps.store.ensure(threadId, title);

    const log = new RunLog({ runId, threadId, kind: "chat" });
    const userMessageId = `msg_user_${randomUUID()}`;
    const assistantMessageId = `msg_assistant_${randomUUID()}`;

    log.append("run.started", { kind: "chat", title });
    log.append("message.started", { messageId: userMessageId, role: "user" });
    log.append("text.delta", { messageId: userMessageId, delta: input.prompt });
    log.append("message.completed", {
      messageId: userMessageId,
      stopReason: "stop",
    });
    log.append("message.started", {
      messageId: assistantMessageId,
      role: "assistant",
    });

    const active: ActiveRun = {
      runId,
      threadId,
      kind: "chat",
      title,
      createdAt,
      log,
    };

    this.runs.set(runId, active);
    this.messageIds.set(runId, assistantMessageId);
    this.controllers.set(runId, new AbortController());
    this.activeThreads.set(threadId, runId);

    const history = this.deps.store.historyMessages(threadId);

    void this.execute(active, input.prompt, history);

    return active;
  }

  get(runId: string): ActiveRun | undefined {
    return this.runs.get(runId);
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);

    if (!controller || controller.signal.aborted) {
      return false;
    }

    controller.abort();

    return true;
  }

  private async execute(
    run: ActiveRun,
    prompt: string,
    history: HistoryMessage[],
  ): Promise<void> {
    const controller = this.controllers.get(run.runId);

    if (!controller) {
      return;
    }

    const messageId = this.messageIds.get(run.runId);

    if (!messageId) {
      return;
    }

    try {
      const decision = inspectUserPrompt(prompt);

      if (decision.blocked && decision.reply) {
        console.warn(`[guard] blocked ${decision.category} request`);

        run.log.append("text.delta", {
          messageId,
          delta: decision.reply,
        });
        run.log.append("message.completed", {
          messageId,
          stopReason: "stop",
        });
        run.log.append("run.completed", { status: "done" });
        return;
      }

      const runner = new AgentRunner(
        this.deps.agent,
        run.log,
        this.deps.kb,
        messageId,
      );

      await runner.run({
        threadId: run.threadId,
        prompt,
        history,
        signal: controller.signal,
      });
    } catch (cause) {
      const last = run.log.lastEvent;

      if (
        last?.type !== "run.completed" &&
        last?.type !== "run.failed" &&
        !run.log.isFinished
      ) {
        run.log.append("message.completed", {
          messageId,
          stopReason: "error",
        });
        run.log.append("run.failed", {
          code: "runtime_error",
          message: cause instanceof Error ? cause.message : "运行时异常",
          retryable: true,
        });
      }
    } finally {
      run.log.finish();
      this.controllers.delete(run.runId);
      this.activeThreads.delete(run.threadId);
      this.deps.store.saveRun(run.threadId, {
        runId: run.runId,
        kind: run.kind,
        title: run.title,
        createdAt: run.createdAt,
        events: [...run.log.snapshotEvents()],
      });
    }
  }
}
