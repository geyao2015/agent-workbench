#!/usr/bin/env node
import { resolve } from "node:path";

import { writeStreamingFixture } from "./lib/streaming-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const fixturesRoot = resolve(root, "fixtures");

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

const fixture = writeStreamingFixture({
  fixturesRoot,
  name: "chat-large-nodes",
  blockCount,
  chunkSize,
  delayMs: 15,
  threadId: "thread_fixture",
});

console.log(
  `wrote chat-large-nodes: ${fixture.events.length} events, ${fixture.blockCount} blocks, ${fixture.chunkCount} chunks, ${fixture.totalChars} chars`,
);
