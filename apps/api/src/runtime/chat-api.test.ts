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

function makeFixture(name = "fixture-chat"): FixtureDefinition {
  const event = (type: string, payload: unknown) => ({
    v: 1,
    eventId: "",
    seq: 0,
    runId: "run_fixture",
    threadId: "thread_fixture",
    ts: 0,
    type,
    payload,
  });

  return {
    scenario: {
      name,
      description: "测试 fixture",
      runKind: "chat",
      threadId: "thread_fixture",
      timing: { mode: "fast", defaultMs: 0 },
    },
    events: [
      event("run.started", { kind: "chat", title: "fixture" }),
      event("message.started", { messageId: "msg_a", role: "assistant" }),
      event("text.delta", { messageId: "msg_a", delta: "fixture answer" }),
      event("message.completed", { messageId: "msg_a", stopReason: "stop" }),
      event("run.completed", { status: "done" }),
    ],
  } as unknown as FixtureDefinition;
}

function makeApp(
  env: NodeJS.ProcessEnv = {},
  fixtureName = "fixture-chat",
) {
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
  const threads = new ThreadStore(dir);
  const mock = createMockRuntime(
    () => new Map([[fixtureName, makeFixture(fixtureName)]]),
    { store: threads },
  );
  const agentApi = new Hono();
  agentApi.post("/api/runs", (c) =>
    c.json({ runId: "run_agent", threadId: "thread_agent", kind: "chat" }),
  );
  agentApi.post("/api/runs/:runId/cancel", (c) =>
    c.json({ cancelled: true, owner: "agent" }),
  );
  const kbDoc = {
    id: "release-runbook",
    title: "发版 Runbook",
    content: "# 发版 Runbook\n\n按灰度批次推进。",
    metadata: {
      service: "checkout-service",
      type: "runbook",
      tags: ["release"],
    },
  };
  const app = createChatApi({
    controller,
    threads,
    kb: {
      list: () => [
        { id: kbDoc.id, title: kbDoc.title, metadata: kbDoc.metadata },
      ],
      get: (docId: string) => (docId === kbDoc.id ? kbDoc : undefined),
    } as unknown as KnowledgeBase,
    agentApi,
    mock,
    docs: 16,
    releases: 1,
  });

  return { app, controller, threads };
}

describe("知识库文档接口", () => {
  it("列表返回标题与元数据", async () => {
    const { app } = makeApp();
    const response = await app.request("/api/kb/docs");
    const data = (await response.json()) as {
      docs: Array<{ id: string; metadata?: { service?: string } }>;
    };

    expect(data.docs[0]?.id).toBe("release-runbook");
    expect(data.docs[0]?.metadata?.service).toBe("checkout-service");
  });

  it("按 id 返回全文，未知 id 返回 404", async () => {
    const { app } = makeApp();
    const response = await app.request("/api/kb/docs/release-runbook");

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      doc: { id: string; content: string };
    };

    expect(data.doc.id).toBe("release-runbook");
    expect(data.doc.content).toContain("灰度批次");

    const missing = await app.request("/api/kb/docs/unknown-doc");

    expect(missing.status).toBe(404);
  });
});

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

  it("mock run 完成后写入 ThreadStore", async () => {
    const { app, threads } = makeApp();
    const created = await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "你好" }),
      headers: { "content-type": "application/json" },
    });
    const run = (await created.json()) as { runId: string; threadId: string };
    const events = await app.request(`/api/runs/${run.runId}/events`);

    await events.text();

    const list = threads.list({ kind: "chat" });

    expect(list).toHaveLength(1);
    expect(list[0]?.threadId).toBe(run.threadId);
    expect(list[0]?.runCount).toBe(1);
    expect(list[0]?.messageCount).toBeGreaterThanOrEqual(2);
    expect(threads.historyMessages(run.threadId).length).toBeGreaterThan(0);
  });

  it("取消未结束的 mock run 也会落库", async () => {
    const { app, threads } = makeApp();
    const created = await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "取消测试" }),
      headers: { "content-type": "application/json" },
    });
    const run = (await created.json()) as { runId: string; threadId: string };

    await app.request(`/api/runs/${run.runId}/cancel`, { method: "POST" });

    const list = threads.list({ kind: "chat" });

    expect(list).toHaveLength(1);
    expect(list[0]?.threadId).toBe(run.threadId);
  });

  it("bench fixture 不落库", async () => {
    const { app, threads } = makeApp({}, "bench-200-blocks");
    const created = await app.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({ prompt: "压测", fixture: "bench-200-blocks" }),
      headers: { "content-type": "application/json" },
    });
    const run = (await created.json()) as { runId: string };
    const events = await app.request(`/api/runs/${run.runId}/events`);

    await events.text();

    expect(threads.list()).toHaveLength(0);
  });
});
