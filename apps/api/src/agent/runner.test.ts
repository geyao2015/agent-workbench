import {
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  createRunState,
  reduce,
  type AgentEvent,
  type RunState,
} from "@agent-workbench/protocol";
import { describe, expect, it } from "vitest";

import type { KnowledgeBase } from "../kb/index.js";
import { RunLog } from "../runs/run-log.js";
import type { ChatAgent } from "./graph.js";
import { AgentRunner } from "./runner.js";

const toolResult = [
  "查询“1.2.0 发版”命中 1 段文档：",
  "",
  "[1] sourceId=release-1-2-0-checklist | 1.2.0 发版清单 > 发版前检查 | score=2.1",
  "确认迁移已在 staging 执行，并验证回滚脚本。",
].join("\n");

function fakeAgent(chunks: BaseMessage[]): ChatAgent {
  return {
    hasCheckpoint: async () => true,
    graph: {
      stream: async () =>
        (async function* () {
          for (const chunk of chunks) {
            yield [chunk, {}];
          }
        })(),
    },
  } as unknown as ChatAgent;
}

describe("AgentRunner", () => {
  it("把模型流映射为文本、推理、工具、引用与用量事件", async () => {
    const log = new RunLog({
      runId: "run_test",
      threadId: "thread_test",
      kind: "chat",
    });

    log.append("run.started", { kind: "chat" });
    log.append("message.started", { messageId: "msg_a", role: "assistant" });

    const chunks: BaseMessage[] = [
      new AIMessageChunk({
        content: "",
        additional_kwargs: { reasoning_content: "先查发版清单。" },
        tool_call_chunks: [
          {
            name: "search_kb",
            args: '{"query":',
            id: "call_1",
            index: 0,
            type: "tool_call_chunk",
          },
        ],
        usage_metadata: {
          input_tokens: 100,
          output_tokens: 10,
          total_tokens: 110,
        },
      }),
      new AIMessageChunk({
        content: "",
        tool_call_chunks: [
          {
            args: '"1.2.0 发版"}',
            id: "call_1",
            index: 0,
            type: "tool_call_chunk",
          },
        ],
      }),
      new ToolMessage({
        content: toolResult,
        tool_call_id: "call_1",
        name: "search_kb",
        status: "success",
      }),
      new AIMessageChunk({
        content: "根据发版清单，1.2.0 需要先执行数据库迁移并灰度发布。",
        usage_metadata: {
          input_tokens: 150,
          output_tokens: 30,
          total_tokens: 180,
        },
      }),
    ];

    const kb = {
      get: (sourceId: string) =>
        sourceId === "release-1-2-0-checklist"
          ? {
              id: sourceId,
              title: "1.2.0 发版清单",
              content: "发版内容",
            }
          : undefined,
    } as unknown as KnowledgeBase;

    const runner = new AgentRunner(fakeAgent(chunks), log, kb, "msg_a");

    await runner.run({
      threadId: "thread_test",
      prompt: "1.2.0 发版有哪些注意事项？",
      history: [],
      signal: new AbortController().signal,
    });

    const events = [...log.snapshotEvents()];
    const types = events.map((event) => event.type);

    expect(types).toContain("reasoning.started");
    expect(types).toContain("reasoning.delta");
    expect(types).toContain("reasoning.completed");
    expect(types.filter((type) => type === "tool.args.delta")).toHaveLength(2);
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.ready");
    expect(types).toContain("tool.result");
    expect(types).toContain("citation.added");
    expect(types).toContain("run.completed");

    const completed = events.find((event) => event.type === "run.completed");

    expect(completed?.type === "run.completed" && completed.payload.usage).toEqual({
      inputTokens: 250,
      outputTokens: 40,
    });

    const citation = events.find((event) => event.type === "citation.added");

    expect(
      citation?.type === "citation.added" && citation.payload.sourceId,
    ).toBe("release-1-2-0-checklist");

    let state: RunState = createRunState({
      runId: "run_test",
      threadId: "thread_test",
      kind: "chat",
    });

    for (const event of events as AgentEvent[]) {
      state = reduce(state, event);
    }

    expect(state.status).toBe("completed");
    expect(state.toolCalls["call_1"]?.status).toBe("success");
    expect(state.messages["msg_a"]?.text).toContain("数据库迁移");
    expect(state.messages["msg_a"]?.citations[0]?.sourceId).toBe(
      "release-1-2-0-checklist",
    );
  });

  it("取消时以 cancelled 终态结束", async () => {
    const log = new RunLog({
      runId: "run_cancel",
      threadId: "thread_cancel",
      kind: "chat",
    });

    log.append("run.started", { kind: "chat" });
    log.append("message.started", { messageId: "msg_c", role: "assistant" });

    const controller = new AbortController();
    const agent = {
      hasCheckpoint: async () => true,
      graph: {
        stream: async () =>
          (async function* () {
            controller.abort();
            throw Object.assign(new Error("aborted"), { name: "AbortError" });
          })(),
      },
    } as unknown as ChatAgent;
    const kb = { get: () => undefined } as unknown as KnowledgeBase;
    const runner = new AgentRunner(agent, log, kb, "msg_c");

    await runner.run({
      threadId: "thread_cancel",
      prompt: "取消测试",
      history: [],
      signal: controller.signal,
    });

    const last = log.snapshotEvents().at(-1);

    expect(last?.type).toBe("run.completed");
    expect(last?.type === "run.completed" && last.payload.status).toBe("cancelled");
  });

  it("没有 checkpointer 时用历史消息做种子", async () => {
    const log = new RunLog({
      runId: "run_seed",
      threadId: "thread_seed",
      kind: "chat",
    });

    log.append("run.started", { kind: "chat" });
    log.append("message.started", { messageId: "msg_s", role: "assistant" });

    let received: BaseMessage[] = [];
    const agent = {
      hasCheckpoint: async () => false,
      graph: {
        stream: async (input: { messages: BaseMessage[] }) => {
          received = input.messages;

          return (async function* () {
            yield [new AIMessageChunk({ content: "好的" }), {}];
          })();
        },
      },
    } as unknown as ChatAgent;
    const kb = { get: () => undefined } as unknown as KnowledgeBase;
    const runner = new AgentRunner(agent, log, kb, "msg_s");

    await runner.run({
      threadId: "thread_seed",
      prompt: "继续",
      history: [
        { role: "user", text: "上一轮问题" },
        { role: "assistant", text: "上一轮回答" },
      ],
      signal: new AbortController().signal,
    });

    expect(received).toHaveLength(3);
    expect(received[0]).toBeInstanceOf(HumanMessage);
  });
});
