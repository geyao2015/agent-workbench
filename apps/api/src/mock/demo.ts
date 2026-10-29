import { randomUUID } from "node:crypto";

import type { AgentEvent } from "@agent-workbench/protocol";

import type { FixtureDefinition } from "../fixtures.js";

const LONG_CONVERSATION_FIXTURE = "chat-large-nodes";
const LONG_CONVERSATION_TURNS = 100;

interface DemoRunPayload {
  runId: string;
  events: AgentEvent[];
}

export interface DemoThreadPayload {
  threadId: string;
  runs: DemoRunPayload[];
}

function buildDemoTurn(
  threadId: string,
  chunk: string,
  index: number,
  total: number,
): DemoRunPayload {
  const runId = `run_demo_${randomUUID()}`;
  const userMessageId = `msg_demo_user_${index + 1}`;
  const assistantMessageId = `msg_demo_assistant_${index + 1}`;
  const prompt = `继续展开第 ${index + 1} 组节点。`;
  const ts = Date.now() - (total - index) * 30_000;
  const events: AgentEvent[] = [
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "run.started",
      payload: { kind: "chat", title: prompt },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.started",
      payload: { messageId: userMessageId, role: "user" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.delta",
      payload: { messageId: userMessageId, delta: prompt },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.block.completed",
      payload: { messageId: userMessageId, blockId: `${userMessageId}:b0` },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.completed",
      payload: { messageId: userMessageId, stopReason: "stop" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.started",
      payload: { messageId: assistantMessageId, role: "assistant" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.delta",
      payload: { messageId: assistantMessageId, delta: chunk },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "citation.added",
      payload: {
        messageId: assistantMessageId,
        citationId: `cit_demo_${index + 1}`,
        sourceId: "doc_engineering_wiki",
        title: "长会话测试数据",
      },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "text.block.completed",
      payload: {
        messageId: assistantMessageId,
        blockId: `${assistantMessageId}:b0`,
      },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "message.completed",
      payload: { messageId: assistantMessageId, stopReason: "stop" },
    },
    {
      v: 1,
      eventId: "",
      seq: 0,
      runId,
      threadId,
      ts,
      type: "run.completed",
      payload: {
        status: "done",
        usage: { inputTokens: 300, outputTokens: 200 },
      },
    },
  ];

  return {
    runId,
    events: events.map((event, eventIndex) => ({
      ...event,
      eventId: `${runId}:${eventIndex + 1}`,
      seq: eventIndex + 1,
    })),
  };
}

export function createLongConversationDemo(
  fixtures: Map<string, FixtureDefinition>,
): DemoThreadPayload {
  const fixture = fixtures.get(LONG_CONVERSATION_FIXTURE);

  if (!fixture) {
    throw new Error(`缺少 fixture：${LONG_CONVERSATION_FIXTURE}`);
  }

  const chunks = fixture.events.flatMap((event) =>
    event.type === "text.delta" ? [event.payload.delta] : [],
  );

  if (chunks.length === 0) {
    throw new Error(`fixture 中没有可用的 text.delta：${LONG_CONVERSATION_FIXTURE}`);
  }

  const chunksPerTurn = Math.max(
    1,
    Math.ceil(chunks.length / LONG_CONVERSATION_TURNS),
  );
  const turns: string[] = [];

  for (let index = 0; index < chunks.length; index += chunksPerTurn) {
    turns.push(chunks.slice(index, index + chunksPerTurn).join(""));
  }

  const threadId = `thread_${randomUUID()}`;

  return {
    threadId,
    runs: turns.map((chunk, index) =>
      buildDemoTurn(threadId, chunk, index, turns.length),
    ),
  };
}
