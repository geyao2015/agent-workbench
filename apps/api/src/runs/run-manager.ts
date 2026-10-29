import { randomUUID } from "node:crypto";

import { inspectUserPrompt } from "../agent/guard.js";
import { AgentRunner, type HistoryMessage } from "../agent/runner.js";
import type { ChatAgent } from "../agent/graph.js";
import type { KnowledgeBase } from "../kb/index.js";
import type { ActiveRun, RunRegistry } from "./run-registry.js";
import type { ThreadStore } from "./thread-store.js";

export interface CreateChatRunInput {
  prompt: string;
  threadId?: string;
}

export interface RunManagerDeps {
  agent: ChatAgent;
  kb: KnowledgeBase;
  store: ThreadStore;
  registry: RunRegistry;
}

export class RunManager {
  private readonly messageIds = new Map<string, string>();

  constructor(private readonly deps: RunManagerDeps) {}

  hasActiveRun(threadId: string): boolean {
    return this.deps.registry.hasActiveRun(threadId);
  }

  createChatRun(input: CreateChatRunInput): ActiveRun {
    const title = input.prompt.replace(/\s+/g, " ").slice(0, 40);
    const { run, signal } = this.deps.registry.begin({
      kind: "chat",
      title,
      threadId: input.threadId,
    });
    const userMessageId = `msg_user_${randomUUID()}`;
    const assistantMessageId = `msg_assistant_${randomUUID()}`;

    run.log.append("message.started", {
      messageId: userMessageId,
      role: "user",
    });
    run.log.append("text.delta", {
      messageId: userMessageId,
      delta: input.prompt,
    });
    run.log.append("message.completed", {
      messageId: userMessageId,
      stopReason: "stop",
    });

    this.messageIds.set(run.runId, assistantMessageId);

    const history = this.deps.store.historyMessages(run.threadId);

    void this.execute(run, input.prompt, history, signal);

    return run;
  }

  get(runId: string): ActiveRun | undefined {
    return this.deps.registry.get(runId);
  }

  cancel(runId: string): boolean {
    return this.deps.registry.cancel(runId);
  }

  private async execute(
    run: ActiveRun,
    prompt: string,
    history: HistoryMessage[],
    signal: AbortSignal,
  ): Promise<void> {
    const messageId = this.messageIds.get(run.runId);

    if (!messageId) {
      return;
    }

    try {
      const decision = inspectUserPrompt(prompt);

      if (decision.blocked && decision.reply) {
        console.warn(`[guard] blocked ${decision.category} request`);

        if (decision.category) {
          run.log.append("guard.blocked", {
            category: decision.category,
          });
        }

        run.log.append("message.started", {
          messageId,
          role: "assistant",
        });
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

      run.log.append("message.started", {
        messageId,
        role: "assistant",
      });

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
        signal,
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
      this.messageIds.delete(run.runId);
      this.deps.registry.finish(run);
      this.deps.registry.persist(run);
    }
  }
}
