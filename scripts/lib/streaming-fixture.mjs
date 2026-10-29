import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function blockFor(index) {
  if (index % 10 === 0) {
    return `### 节点组 ${Math.floor(index / 10) + 1}`;
  }

  if (index % 7 === 0) {
    return [
      `- 节点 ${index} 的检查项 A`,
      `- 节点 ${index} 的检查项 B`,
      `- 节点 ${index} 的检查项 C`,
    ].join("\n");
  }

  if (index % 11 === 0) {
    return ["```ts", `const node${index} = { id: ${index}, status: "ok" };`, "```"].join(
      "\n",
    );
  }

  if (index % 13 === 0) {
    return [
      "| 字段 | 值 |",
      "| --- | --- |",
      `| node | ${index} |`,
      "| status | ok |",
    ].join("\n");
  }

  if (index % 17 === 0) {
    return `> 节点 ${index} 的备注：用于大量文本节点渲染测试。`;
  }

  if (index % 19 === 0) {
    return [
      `1. 处理节点 ${index} 的第一步`,
      `2. 处理节点 ${index} 的第二步`,
      `3. 处理节点 ${index} 的第三步`,
    ].join("\n");
  }

  return `节点 ${index}：这是一段用于大量文本节点渲染测试的内容，包含中文描述和标识 node-${index}。`;
}

export function buildStreamingFixture({
  name,
  blockCount,
  chunkSize,
  delayMs = 15,
  threadId: threadIdOverride,
}) {
  const blocks = Array.from({ length: blockCount }, (_, index) =>
    blockFor(index),
  );
  const chunks = [];

  for (let index = 0; index < blocks.length; index += chunkSize) {
    chunks.push(`${blocks.slice(index, index + chunkSize).join("\n\n")}\n\n`);
  }

  const messageId = `msg_${name.replaceAll("-", "_")}`;
  const runId = `run_fixture_${name.replaceAll("-", "_")}`;
  const threadId =
    threadIdOverride ?? `thread_fixture_${name.replaceAll("-", "_")}`;
  const totalChars = chunks.join("").length;
  const events = [
    {
      type: "run.started",
      payload: { kind: "chat", title: `大量节点：${blockCount} 块` },
    },
    { type: "message.started", payload: { messageId, role: "assistant" } },
    ...chunks.map((delta) => ({
      type: "text.delta",
      payload: { messageId, delta },
    })),
    {
      type: "citation.added",
      payload: {
        messageId,
        citationId: `cit_${name.replaceAll("-", "_")}`,
        sourceId: "doc_engineering_wiki",
        title: "长内容渲染测试",
      },
    },
    {
      type: "text.block.completed",
      payload: { messageId, blockId: `${messageId}:b0` },
    },
    { type: "message.completed", payload: { messageId, stopReason: "stop" } },
    {
      type: "run.completed",
      payload: {
        status: "done",
        usage: { inputTokens: 12000, outputTokens: 8000 },
      },
    },
  ];

  return {
    scenario: {
      name,
      description: `大量文本节点：${blockCount} 个 Markdown 块，${chunks.length} 个增量`,
      runKind: "chat",
      threadId,
      timing: {
        mode: "delays",
        defaultMs: delayMs,
        bySeq: { "1": 0, "2": 0 },
      },
    },
    events: events.map((event, index) => ({
      v: 1,
      eventId: `evt_${name.replaceAll("-", "_")}_${String(index + 1).padStart(4, "0")}`,
      seq: index + 1,
      runId,
      threadId,
      ts: 0,
      ...event,
    })),
    runId,
    threadId,
    blockCount,
    chunkCount: chunks.length,
    totalChars,
  };
}

export function writeStreamingFixture({ fixturesRoot, ...options }) {
  const fixture = buildStreamingFixture(options);
  const directory = resolve(fixturesRoot, options.name);

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "scenario.json"),
    `${JSON.stringify(fixture.scenario, null, 2)}\n`,
  );
  writeFileSync(
    resolve(directory, "events.jsonl"),
    `${fixture.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );

  return fixture;
}
