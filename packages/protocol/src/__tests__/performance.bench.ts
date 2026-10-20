import { test } from "vitest";

import { segmentMarkdownBlocks } from "../blocks.js";
import type { AgentEvent } from "../events.js";
import { createRunState, reduce } from "../reducer.js";

function buildMarkdown(blockCount: number): string {
  return Array.from(
    { length: blockCount },
    (_, index) => `## Section ${index}\n\nParagraph ${index} with **bold** text.`,
  ).join("\n\n");
}

const largeText = buildMarkdown(2000);
const growingText = `${largeText}x`;

function makeEvent(seq: number, type: string, payload: unknown): AgentEvent {
  return {
    v: 1,
    eventId: `evt_bench_${seq}`,
    seq,
    runId: "run_bench",
    threadId: "thread_bench",
    ts: 0,
    type,
    payload,
  } as AgentEvent;
}

const events: AgentEvent[] = [
  makeEvent(1, "run.started", { kind: "chat" }),
  makeEvent(2, "message.started", { messageId: "msg_bench", role: "assistant" }),
  ...Array.from({ length: 200 }, (_, index) =>
    makeEvent(index + 3, "text.delta", {
      messageId: "msg_bench",
      delta: `## Section ${index}\n\nParagraph ${index}\n\n`,
    }),
  ),
];

const largeStreamEvents: AgentEvent[] = [
  makeEvent(1, "run.started", { kind: "chat" }),
  makeEvent(2, "message.started", { messageId: "msg_10k", role: "assistant" }),
  ...Array.from({ length: 500 }, (_, index) => {
    const start = index * 10;
    const delta = Array.from(
      { length: 10 },
      (_, offset) =>
        `## Section ${start + offset}\n\nParagraph ${start + offset} with **bold** text.\n\n`,
    ).join("");

    return makeEvent(index + 3, "text.delta", {
      messageId: "msg_10k",
      delta,
    });
  }),
];

test("block segmentation", async ({ bench }) => {
  await bench.compare(
    bench("2000 blocks, full text", () => {
      segmentMarkdownBlocks("msg_bench", largeText);
    }),
    bench("2000 blocks, one char appended", () => {
      segmentMarkdownBlocks("msg_bench", growingText);
    }),
  );
});

test("reducer streaming", async ({ bench }) => {
  await bench("200 deltas with block segmentation", () => {
    let state = createRunState({
      runId: "run_bench",
      threadId: "thread_bench",
      kind: "chat",
    });

    for (const event of events) {
      state = reduce(state, event);
    }
  }).run();

  await bench("500 deltas / 10k blocks", () => {
    let state = createRunState({
      runId: "run_bench",
      threadId: "thread_bench",
      kind: "chat",
    });

    for (const event of largeStreamEvents) {
      state = reduce(state, event);
    }
  }).run();
});
