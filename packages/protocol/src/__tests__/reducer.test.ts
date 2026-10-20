import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { AgentEvent, AgentEventEnvelope } from "../events";
import { parseFixture } from "../fixture";
import { createRunState, reduce } from "../reducer";

const scenarioJson = readFileSync(
  fileURLToPath(new URL("../../../../fixtures/chat-short/scenario.json", import.meta.url)),
  "utf8",
);
const eventsJsonl = readFileSync(
  fileURLToPath(new URL("../../../../fixtures/chat-short/events.jsonl", import.meta.url)),
  "utf8",
);

const { events } = parseFixture(scenarioJson, eventsJsonl);
const releaseEventsJsonl = readFileSync(
  fileURLToPath(
    new URL("../../../../fixtures/chat-release-notes/events.jsonl", import.meta.url),
  ),
  "utf8",
);
const releaseScenarioJson = readFileSync(
  fileURLToPath(
    new URL("../../../../fixtures/chat-release-notes/scenario.json", import.meta.url),
  ),
  "utf8",
);
const blocksEventsJsonl = readFileSync(
  fileURLToPath(new URL("../../../../fixtures/chat-blocks/events.jsonl", import.meta.url)),
  "utf8",
);
const blocksScenarioJson = readFileSync(
  fileURLToPath(new URL("../../../../fixtures/chat-blocks/scenario.json", import.meta.url)),
  "utf8",
);

function makeEvent(
  seq: number,
  type: string,
  payload: unknown,
  overrides: { eventId?: string; runId?: string; threadId?: string } = {},
): AgentEvent {
  return {
    v: 1,
    eventId: overrides.eventId ?? `evt_${seq}`,
    seq,
    runId: overrides.runId ?? "run_test",
    threadId: overrides.threadId ?? "thread_test",
    ts: seq,
    type,
    payload,
  } as AgentEvent;
}

function applyAll(state = createRunState({ runId: "run_fixture_short", threadId: "thread_fixture", kind: "chat" })) {
  return events.reduce(reduce, state);
}

describe("reducer", () => {
  it("projects the sample fixture into run, message and block state", () => {
    const state = applyAll();

    expect(state.status).toBe("completed");
    expect(state.lastSeq).toBe(8);

    const message = state.messages["msg_short_001"];
    expect(message?.status).toBe("completed");
    expect(message?.text).toBe(
      "1.2.0 发版前需要确认两件事：合并冲突已解决，以及回归测试通过。",
    );
    expect(message?.citations).toEqual(["cit_short_001"]);

    const block = state.blocks["msg_short_001:b0"];
    expect(block?.raw).toBe(message?.text);
    expect(block?.status).toBe("closed");
  });

  it("is idempotent for duplicate events", () => {
    const state = applyAll();
    const lastEvent = events.at(-1);

    expect(lastEvent).toBeDefined();
    expect(reduce(state, lastEvent!)).toBe(state);
    expect(reduce(state, events[3]!)).toBe(state);
  });

  it("ignores events older than lastSeq", () => {
    const initial = createRunState({
      runId: "run_fixture_short",
      threadId: "thread_fixture",
      kind: "chat",
    });
    const state = reduce(initial, events[1]!);

    expect(state.lastSeq).toBe(2);
    expect(reduce(state, events[0]!)).toBe(state);
  });

  it("projects user messages from event log", () => {
    const state = [
      makeEvent(1, "run.started", { kind: "chat" }),
      makeEvent(2, "message.started", { messageId: "msg_user", role: "user" }),
      makeEvent(3, "text.delta", {
        messageId: "msg_user",
        delta: "发版前要确认什么？",
      }),
      makeEvent(4, "message.completed", { messageId: "msg_user", stopReason: "stop" }),
    ].reduce(
      reduce,
      createRunState({ runId: "run_test", threadId: "thread_test", kind: "chat" }),
    );

    expect(state.messageOrder).toEqual(["msg_user"]);
    expect(state.messages["msg_user"]?.role).toBe("user");
    expect(state.messages["msg_user"]?.text).toBe("发版前要确认什么？");
    expect(state.messages["msg_user"]?.status).toBe("completed");
  });

  it("tracks user pause and resume states", () => {
    const initial = createRunState({
      runId: "run_test",
      threadId: "thread_test",
      kind: "chat",
    });
    const running = reduce(initial, makeEvent(1, "run.started", { kind: "chat" }));
    const paused = reduce(running, makeEvent(2, "run.paused", { reason: "user" }));
    const resumed = reduce(paused, makeEvent(3, "run.resumed", { fromSeq: 2 }));

    expect(running.status).toBe("running");
    expect(paused.status).toBe("paused");
    expect(resumed.status).toBe("running");
    expect(resumed.lastSeq).toBe(3);
  });

  it("ignores events from another run", () => {
    const state = createRunState({
      runId: "run_fixture_short",
      threadId: "thread_fixture",
      kind: "chat",
    });
    const foreign = { ...events[0]!, runId: "run_other" };

    expect(reduce(state, foreign)).toBe(state);
  });

  it("ignores unknown event types but advances seq", () => {
    const state = reduce(
      createRunState({ runId: "run_test", threadId: "thread_test", kind: "chat" }),
      makeEvent(1, "run.started", { kind: "chat" }),
    );
    const unknown: AgentEventEnvelope = {
      v: 1,
      eventId: "evt_future",
      seq: 2,
      runId: "run_test",
      threadId: "thread_test",
      ts: 2,
      type: "future.event",
      payload: { anything: true },
    };

    const next = reduce(state, unknown);

    expect(next.status).toBe("running");
    expect(next.lastSeq).toBe(2);
    expect(next.appliedEventIds.has("evt_future")).toBe(true);
  });

  it("tracks tool approval and rejection", () => {
    const toolCallId = "tool_1";
    const approvalId = "approval_1";
    const state = [
      makeEvent(1, "run.started", { kind: "release" }),
      makeEvent(2, "tool.started", { toolCallId, name: "merge_conflict" }),
      makeEvent(3, "tool.args.delta", { toolCallId, delta: '{"file":' }),
      makeEvent(4, "tool.ready", { toolCallId, args: { file: "a.ts" } }),
      makeEvent(5, "tool.approval_required", {
        toolCallId,
        approvalId,
        title: "应用合并方案",
        risk: "high",
        args: { file: "a.ts" },
      }),
      makeEvent(6, "tool.approval_resolved", {
        toolCallId,
        approvalId,
        approved: false,
        note: "方案不可接受",
      }),
    ].reduce(
      reduce,
      createRunState({ runId: "run_test", threadId: "thread_test", kind: "release" }),
    );

    expect(state.toolCalls[toolCallId]?.argsText).toBe('{"file":');
    expect(state.toolCalls[toolCallId]?.status).toBe("rejected");
    expect(state.approvals[approvalId]?.status).toBe("rejected");
    expect(state.approvals[approvalId]?.note).toBe("方案不可接受");
  });

  it("tracks stages, artifacts and recoverable errors", () => {
    const state = [
      makeEvent(1, "run.started", { kind: "release" }),
      makeEvent(2, "stage.started", { stageId: "preflight", name: "前置检查" }),
      makeEvent(3, "artifact.created", {
        artifactId: "art_1",
        kind: "diff",
        title: "冲突 diff",
      }),
      makeEvent(4, "artifact.updated", {
        artifactId: "art_1",
        patch: { title: "冲突 diff（已审阅）" },
      }),
      makeEvent(5, "stage.completed", {
        stageId: "preflight",
        status: "success",
        summary: "通过",
      }),
      makeEvent(6, "error", {
        code: "retrieval_failed",
        message: "知识库检索失败",
        retryable: true,
      }),
      makeEvent(7, "run.completed", { status: "done" }),
    ].reduce(
      reduce,
      createRunState({ runId: "run_test", threadId: "thread_test", kind: "release" }),
    );

    expect(state.stageOrder).toEqual(["preflight"]);
    expect(state.stages["preflight"]?.status).toBe("success");
    expect(state.artifacts["art_1"]?.title).toBe("冲突 diff（已审阅）");
    expect(state.artifacts["art_1"]?.status).toBe("ready");
    expect(state.errors).toEqual([
      { code: "retrieval_failed", message: "知识库检索失败", seq: 6 },
    ]);
    expect(state.status).toBe("completed");
  });

  it("segments streaming Markdown into stable blocks", () => {
    const initial = createRunState({
      runId: "run_test",
      threadId: "thread_test",
      kind: "chat",
    });
    const started = [
      makeEvent(1, "run.started", { kind: "chat" }),
      makeEvent(2, "message.started", { messageId: "msg_1", role: "assistant" }),
      makeEvent(3, "text.delta", { messageId: "msg_1", delta: "## Title\n\nhello" }),
    ].reduce(reduce, initial);

    expect(started.messages["msg_1"]?.blockIds).toEqual(["msg_1:b0", "msg_1:b1"]);
    expect(started.blocks["msg_1:b0"]?.kind).toBe("heading");
    expect(started.blocks["msg_1:b0"]?.status).toBe("closed");
    expect(started.blocks["msg_1:b1"]?.raw).toBe("hello");

    const grown = reduce(
      started,
      makeEvent(4, "text.delta", { messageId: "msg_1", delta: " world" }),
    );

    expect(grown.blocks["msg_1:b0"]?.raw).toBe("## Title");
    expect(grown.blocks["msg_1:b1"]?.raw).toBe("hello world");
    expect(grown.blocks["msg_1:b1"]?.status).toBe("open");

    const completed = reduce(
      grown,
      makeEvent(5, "message.completed", { messageId: "msg_1", stopReason: "stop" }),
    );

    expect(completed.blocks["msg_1:b1"]?.status).toBe("closed");
    expect(completed.messages["msg_1"]?.status).toBe("completed");
  });

  it("segments the release fixture into closed Markdown blocks", () => {
    const release = parseFixture(releaseScenarioJson, releaseEventsJsonl);
    const first = release.events[0]!;
    const state = release.events.reduce(
      reduce,
      createRunState({
        runId: first.runId,
        threadId: first.threadId,
        kind: "chat",
      }),
    );
    const message = state.messages["msg_release_001"];
    const blockIds = message?.blockIds ?? [];
    const kinds = blockIds.map((id) => state.blocks[id]?.kind);

    expect(blockIds.length).toBeGreaterThan(5);
    expect(blockIds.every((id) => state.blocks[id]?.status === "closed")).toBe(true);
    expect(kinds).toContain("heading");
    expect(kinds).toContain("list");
    expect(kinds).toContain("blockquote");
  });

  it("covers all supported block kinds in the blocks fixture", () => {
    const fixture = parseFixture(blocksScenarioJson, blocksEventsJsonl);
    const first = fixture.events[0]!;
    const state = fixture.events.reduce(
      reduce,
      createRunState({
        runId: first.runId,
        threadId: first.threadId,
        kind: "chat",
      }),
    );
    const message = state.messages["msg_chat_blocks"];
    const kinds = new Set(
      (message?.blockIds ?? []).map((id) => state.blocks[id]?.kind),
    );

    expect(kinds).toEqual(
      new Set(["heading", "paragraph", "list", "code", "table", "blockquote"]),
    );
    expect(
      (message?.blockIds ?? []).every(
        (id) => state.blocks[id]?.status === "closed",
      ),
    ).toBe(true);
  });

  it("does not mutate a closed block", () => {
    const state = [
      makeEvent(1, "run.started", { kind: "chat" }),
      makeEvent(2, "message.started", { messageId: "msg_1", role: "assistant" }),
      makeEvent(3, "text.delta", { messageId: "msg_1", delta: "hello" }),
      makeEvent(4, "text.block.completed", { messageId: "msg_1", blockId: "msg_1:b0" }),
      makeEvent(5, "text.delta", {
        messageId: "msg_1",
        delta: " ignored",
        blockId: "msg_1:b0",
      }),
    ].reduce(
      reduce,
      createRunState({ runId: "run_test", threadId: "thread_test", kind: "chat" }),
    );

    expect(state.messages["msg_1"]?.text).toBe("hello");
    expect(state.blocks["msg_1:b0"]?.raw).toBe("hello");
  });
});
