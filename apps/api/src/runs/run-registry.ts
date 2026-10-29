import { randomUUID } from "node:crypto";

import type { RunKind } from "@agent-workbench/protocol";

import { RunLog } from "./run-log.js";
import type { ThreadStore } from "./thread-store.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
  kind: RunKind;
  title: string;
  createdAt: number;
  parentRunId?: string;
  sourceRunId?: string;
  log: RunLog;
}

export class ThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`thread ${threadId} 已有进行中的 run`);
    this.name = "ThreadBusyError";
  }
}

export class RunRegistry {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeThreads = new Map<string, string>();

  constructor(private readonly store: ThreadStore) {}

  begin(input: {
    kind: RunKind;
    title: string;
    threadId?: string;
    parentRunId?: string;
    sourceRunId?: string;
  }): { run: ActiveRun; signal: AbortSignal } {
    const threadId = input.threadId ?? `thread_${randomUUID()}`;

    if (this.activeThreads.has(threadId)) {
      throw new ThreadBusyError(threadId);
    }

    const runId = `run_${randomUUID()}`;
    const title = input.title.replace(/\s+/g, " ").slice(0, 60);
    const createdAt = Date.now();

    this.store.ensure(threadId, title, input.kind);

    const log = new RunLog({ runId, threadId, kind: input.kind });
    log.append("run.started", {
      kind: input.kind,
      title,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    });

    const controller = new AbortController();
    const run: ActiveRun = {
      runId,
      threadId,
      kind: input.kind,
      title,
      createdAt,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
      log,
    };

    this.runs.set(runId, run);
    this.controllers.set(runId, controller);
    this.activeThreads.set(threadId, runId);

    return { run, signal: controller.signal };
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

  hasActiveRun(threadId: string): boolean {
    return this.activeThreads.has(threadId);
  }

  finish(run: ActiveRun): void {
    run.log.finish();
    this.controllers.delete(run.runId);

    if (this.activeThreads.get(run.threadId) === run.runId) {
      this.activeThreads.delete(run.threadId);
    }
  }

  persist(run: ActiveRun): void {
    this.store.saveRun(run.threadId, {
      runId: run.runId,
      kind: run.kind,
      title: run.title,
      createdAt: run.createdAt,
      events: [...run.log.snapshotEvents()],
    });
  }
}
