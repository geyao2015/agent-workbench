import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChatAgent } from "../agent/graph.js";
import type { KnowledgeBase } from "../kb/index.js";
import { RunManager } from "./run-manager.js";
import { ThreadStore } from "./thread-store.js";

const tempDirs: string[] = [];

function makeManager() {
  const dir = mkdtempSync(join(tmpdir(), "aw-runs-"));
  tempDirs.push(dir);

  const agent = {
    hasCheckpoint: async () => true,
    graph: {
      stream: async (
        _input: unknown,
        options: { signal?: AbortSignal },
      ) =>
        (async function* () {
          const abortError = Object.assign(new Error("aborted"), {
            name: "AbortError",
          });

          if (options.signal?.aborted) {
            throw abortError;
          }

          await new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(abortError), {
              once: true,
            });
          });
        })(),
    },
  } as unknown as ChatAgent;
  const kb = { get: () => undefined } as unknown as KnowledgeBase;
  const store = new ThreadStore(dir);

  return {
    manager: new RunManager({ agent, kb, store }),
    store,
    dir,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RunManager", () => {
  it("同一会话只允许一个活跃 run，取消后写入 cancelled 快照", async () => {
    const { manager, store } = makeManager();
    const run = manager.createChatRun({
      prompt: "需要长时间运行的请求",
      threadId: "thread_busy",
    });

    expect(manager.hasActiveRun("thread_busy")).toBe(true);
    expect(manager.cancel(run.runId)).toBe(true);

    await waitFor(() => !manager.hasActiveRun("thread_busy"));
    await waitFor(() => store.page("thread_busy")?.runs.length === 1);

    const snapshot = store.page("thread_busy")?.runs[0];

    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.runId).toBe(run.runId);
  });
});
