import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  createRunState,
  reduce,
  toRunSnapshot,
  type AgentEvent,
  type RunHistoryPage,
  type RunKind,
  type RunSnapshot,
  type ThreadSummary,
} from "@agent-workbench/protocol";

import type { HistoryMessage } from "../agent/runner.js";

export interface StoredRun {
  runId: string;
  kind: RunKind;
  title: string;
  createdAt: number;
  events: AgentEvent[];
}

interface ThreadRecord {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  runs: StoredRun[];
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const HISTORY_RUNS = 6;

function safeFileName(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class ThreadStore {
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly snapshotCache = new WeakMap<StoredRun, RunSnapshot>();
  private readonly dir?: string;

  constructor(storeDir?: string) {
    this.dir = storeDir ? resolve(storeDir, "threads") : undefined;

    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
      this.load();
    }
  }

  ensure(threadId: string, title: string): ThreadRecord {
    const existing = this.threads.get(threadId);

    if (existing) {
      return existing;
    }

    const now = Date.now();
    const record: ThreadRecord = {
      threadId,
      title: title.slice(0, 40) || "新对话",
      createdAt: now,
      updatedAt: now,
      runs: [],
    };

    this.threads.set(threadId, record);

    return record;
  }

  saveRun(threadId: string, run: StoredRun): void {
    const thread =
      this.threads.get(threadId) ?? this.ensure(threadId, run.title);
    const index = thread.runs.findIndex((candidate) => candidate.runId === run.runId);

    if (index >= 0) {
      thread.runs[index] = run;
    } else {
      thread.runs.push(run);
    }

    thread.updatedAt = Math.max(thread.updatedAt, run.createdAt);
    this.persist(thread);
  }

  list(): ThreadSummary[] {
    return [...this.threads.values()]
      .map((thread) => {
        const snapshots = thread.runs.map((run) => this.snapshotOf(thread, run));
        const messageCount = snapshots.reduce(
          (count, snapshot) => count + snapshot.messageOrder.length,
          0,
        );
        const lastAssistant = snapshots
          .flatMap((snapshot) => snapshot.messageOrder.map((id) => snapshot.messages[id]))
          .reverse()
          .find((message) => message?.role === "assistant" && message.text.trim());

        return {
          threadId: thread.threadId,
          title: thread.title,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          runCount: thread.runs.length,
          messageCount,
          ...(lastAssistant
            ? { preview: lastAssistant.text.replace(/\s+/g, " ").slice(0, 60) }
            : {}),
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  page(
    threadId: string,
    cursor?: string,
    requestedLimit?: number,
  ): RunHistoryPage | undefined {
    const thread = this.threads.get(threadId);

    if (!thread) {
      return undefined;
    }

    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, requestedLimit ?? DEFAULT_PAGE_SIZE),
    );
    const runs = [...thread.runs].sort((left, right) => left.createdAt - right.createdAt);
    const parsedCursor = cursor ? Number.parseInt(cursor, 10) : Number.NaN;
    const end = Number.isFinite(parsedCursor)
      ? Math.min(runs.length, Math.max(0, parsedCursor))
      : runs.length;
    const start = Math.max(0, end - limit);

    return {
      threadId,
      runs: runs
        .slice(start, end)
        .map((run) => this.snapshotOf(thread, run)),
      nextCursor: start > 0 ? String(start) : null,
    };
  }

  historyMessages(threadId: string): HistoryMessage[] {
    const thread = this.threads.get(threadId);

    if (!thread) {
      return [];
    }

    return thread.runs
      .slice(-HISTORY_RUNS)
      .flatMap((run) => {
        const snapshot = this.snapshotOf(thread, run);

        return snapshot.messageOrder.flatMap((id) => {
          const message = snapshot.messages[id];

          return message && message.text.trim()
            ? [{ role: message.role, text: message.text }]
            : [];
        });
      })
      .slice(-12);
  }

  private snapshotOf(thread: ThreadRecord, run: StoredRun): RunSnapshot {
    const cached = this.snapshotCache.get(run);

    if (cached) {
      return cached;
    }

    let state = createRunState({
      runId: run.runId,
      threadId: thread.threadId,
      kind: run.kind,
    });

    for (const event of run.events) {
      state = reduce(state, event);
    }

    const snapshot = toRunSnapshot(state);
    this.snapshotCache.set(run, snapshot);

    return snapshot;
  }

  private persist(thread: ThreadRecord): void {
    if (!this.dir) {
      return;
    }

    const path = resolve(this.dir, `${safeFileName(thread.threadId)}.json`);
    const temporary = `${path}.tmp`;

    writeFileSync(temporary, JSON.stringify(thread), "utf8");
    renameSync(temporary, path);
  }

  private load(): void {
    if (!this.dir || !existsSync(this.dir)) {
      return;
    }

    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      try {
        const parsed = JSON.parse(
          readFileSync(resolve(this.dir, entry.name), "utf8"),
        ) as ThreadRecord;

        if (
          typeof parsed.threadId === "string" &&
          typeof parsed.title === "string" &&
          Array.isArray(parsed.runs)
        ) {
          this.threads.set(parsed.threadId, parsed);
        }
      } catch (cause) {
        console.warn(`跳过损坏的会话文件 ${entry.name}`, cause);
      }
    }
  }
}
