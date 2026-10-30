import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatAgent } from "../agent/graph.js";
import { loadRuntimeConfig } from "../config.js";
import type { FixtureDefinition } from "../fixtures.js";
import type { KnowledgeBase } from "../kb/index.js";
import { createMockRuntime } from "../mock/runtime.js";
import { DeterministicConflictResolver } from "../release/conflict.js";
import { ThreadStore } from "../runs/thread-store.js";
import { createChatApi } from "./chat-api.js";
import { RuntimeController } from "./controller.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture(): FixtureDefinition {
  const runStarted = {
    v: 1,
    eventId: "evt_1",
    seq: 1,
    runId: "run_fixture",
    threadId: "thread_fixture",
    ts: 0,
    type: "run.started",
    payload: { kind: "chat", title: "fixture" },
  };

  return {
    scenario: {
      name: "fixture-chat",
      description: "测试 fixture",
      runKind: "chat",
      threadId: "thread_fixture",
      timing: { mode: "fast", defaultMs: 0 },
    },
    events: [runStarted],
  } as unknown as FixtureDefinition;
}

function makeApp(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aw-chat-api-"));
  tempDirs.push(dir);

  const config = loadRuntimeConfig({
    RUNTIME_MODE: "mock",
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "glm-5.2",
    ...env,
  });
  const controller = new RuntimeController(config, {
    createAgent: () => ({}) as unknown as ChatAgent,
    createConflictResolver: () => new DeterministicConflictResolver(),
  });
  const mock = createMockRuntime(() => new Map([["fixture-chat", makeFixture()]]));
  const agentApi = new Hono();
  agentApi.post("/api/runs", (c) =>
    c.json({ runId: "run_agent", threadId: "thread_agent", kind: "chat" }),
  );
  agentApi.post("/api/runs/:runId/cancel", (c) =>
    c.json({ cancelled: true, owner: "agent" }),
  );
  const app = createChatApi({
    controller,
    threads: new ThreadStore(dir),
    kb: { list: () => [] } as unknown as KnowledgeBase,
    agentApi,
    mock,
    docs: 16,
    releases: 1,
  });

  return { app, controller };
}

describe("chat api 运行时分发", () => {
  it("runtime 信息包含模式、模型列表与可用性", async () => {
    const { app } = makeApp();
    const response = await app.request("/api/runtime");
    const data = (await response.json()) as {
      mode: string;
      agentAvailable: boolean;
      models: Array<{ id: string; available: boolean }>;
      docs: number;
    };

    expect(data.mode).toBe("mock");
    expect(data.agentAvailable).toBe(true);
    expect(data.models[0]?.available).toBe(true);
    expect(data.docs).toBe(16);
  });

  it("按当前模式分发新 run，切换后旧 run 仍归原运行时", async () => {
    const { app } = makeApp();

    const mockResponse = await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "你好" }),
      headers: { "content-type": "application/json" },
    });
    const mockRun = (await mockResponse.json()) as {
      runId: string;
      fixture?: string;
    };

    expect(mockRun.runId).toMatch(/^run_/);
    expect(mockRun.fixture).toBe("fixture-chat");

    const switchResponse = await app.request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ mode: "agent" }),
      headers: { "content-type": "application/json" },
    });
    expect(switchResponse.status).toBe(200);

    const agentResponse = await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "你好" }),
      headers: { "content-type": "application/json" },
    });
    expect(((await agentResponse.json()) as { runId: string }).runId).toBe(
      "run_agent",
    );

    const backResponse = await app.request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ mode: "mock" }),
      headers: { "content-type": "application/json" },
    });
    expect(backResponse.status).toBe(200);

    const cancelResponse = await app.request(
      `/api/runs/${mockRun.runId}/cancel`,
      { method: "POST" },
    );
    const cancelled = (await cancelResponse.json()) as {
      cancelled: boolean;
      owner?: string;
    };

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.owner).toBeUndefined();
  });

  it("无 Key 时切换 agent 返回 409，非法模式返回 400", async () => {
    const { app } = makeApp({ OPENAI_API_KEY: "" });

    const unavailable = await app.request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ mode: "agent" }),
      headers: { "content-type": "application/json" },
    });
    expect(unavailable.status).toBe(409);

    const invalid = await app.request("/api/runtime", {
      method: "POST",
      body: JSON.stringify({ mode: "other" }),
      headers: { "content-type": "application/json" },
    });
    expect(invalid.status).toBe(400);
  });
});
