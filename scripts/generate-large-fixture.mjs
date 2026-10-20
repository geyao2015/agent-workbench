#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixturesRoot = resolve(root, "fixtures", "chat-large-nodes");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((argument) => argument.replace(/^--/, "").split("="))
    .filter(([key, value]) => key && value !== undefined)
    .map(([key, value]) => [key, Number(value)]),
);

const blockCount =
  Number.isFinite(args.blocks) && args.blocks > 0 ? args.blocks : 10000;
const chunkSize =
  Number.isFinite(args.chunk) && args.chunk > 0 ? args.chunk : 20;

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

const blocks = Array.from({ length: blockCount }, (_, index) => blockFor(index));
const chunks = [];

for (let index = 0; index < blocks.length; index += chunkSize) {
  chunks.push(`${blocks.slice(index, index + chunkSize).join("\n\n")}\n\n`);
}

const messageId = "msg_chat_large_nodes";
const runId = "run_fixture_chat_large_nodes";
const threadId = "thread_fixture";
const totalChars = chunks.join("").length;

const events = [
  { type: "run.started", payload: { kind: "chat", title: `大量节点：${blockCount} 块` } },
  { type: "message.started", payload: { messageId, role: "assistant" } },
  ...chunks.map((delta) => ({ type: "text.delta", payload: { messageId, delta } })),
  {
    type: "citation.added",
    payload: {
      messageId,
      citationId: "cit_chat_large_nodes",
      sourceId: "doc_engineering_wiki",
      title: "长内容渲染测试",
    },
  },
  { type: "text.block.completed", payload: { messageId, blockId: `${messageId}:b0` } },
  { type: "message.completed", payload: { messageId, stopReason: "stop" } },
  {
    type: "run.completed",
    payload: { status: "done", usage: { inputTokens: 12000, outputTokens: 8000 } },
  },
];

const lines = events.map((event, index) =>
  JSON.stringify({
    v: 1,
    eventId: `evt_chat_large_nodes_${String(index + 1).padStart(4, "0")}`,
    seq: index + 1,
    runId,
    threadId,
    ts: 0,
    ...event,
  }),
);

mkdirSync(fixturesRoot, { recursive: true });
writeFileSync(
  resolve(fixturesRoot, "scenario.json"),
  `${JSON.stringify(
    {
      name: "chat-large-nodes",
      description: `大量文本节点：${blockCount} 个 Markdown 块，${chunks.length} 个增量`,
      runKind: "chat",
      threadId,
      timing: {
        mode: "delays",
        defaultMs: 15,
        bySeq: { "1": 0, "2": 0 },
      },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(resolve(fixturesRoot, "events.jsonl"), `${lines.join("\n")}\n`);

console.log(
  `wrote chat-large-nodes: ${events.length} events, ${blockCount} blocks, ${chunks.length} chunks, ${totalChars} chars`,
);
