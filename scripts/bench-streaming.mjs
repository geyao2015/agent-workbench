#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import { chromium } from "@playwright/test";

import { createRunState, reduce } from "../packages/protocol/dist/index.js";
import { writeStreamingFixture } from "./lib/streaming-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const fixturesRoot = resolve(root, "fixtures");
const datasetPath = resolve(root, "data/bench/streaming.jsonl");
const reportPath = resolve(root, "data/bench/results.json");
const baseURL = process.env.BENCH_BASE_URL ?? "http://localhost:5173";
const viewport = { width: 1280, height: 900 };

function readCases() {
  return readFileSync(datasetPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function serverReady() {
  try {
    const response = await fetch(`${baseURL}/api/runtime`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (await serverReady()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`服务在 120s 内未就绪：${baseURL}`);
}

async function ensureServer() {
  if (await serverReady()) {
    return null;
  }

  const child = spawn("pnpm", ["dev"], {
    cwd: root,
    env: { ...process.env, RUNTIME_MODE: "mock" },
    stdio: "inherit",
    detached: true,
  });

  await waitForServer();

  return child;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measureReducer(fixture) {
  const samples = [];

  for (let index = 0; index < 3; index += 1) {
    let state = createRunState({
      runId: fixture.runId,
      threadId: fixture.threadId,
      kind: "chat",
    });
    const startedAt = performance.now();

    for (const event of fixture.events) {
      state = reduce(state, event);
    }

    samples.push(performance.now() - startedAt);
  }

  return median(samples);
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const entries = [...document.querySelectorAll("[data-metric]")].map(
      (element) => [
        element.getAttribute("data-metric") ?? "",
        element.querySelector("dd")?.textContent?.trim() ?? "",
      ],
    );

    return Object.fromEntries(entries);
  });
}

async function measureBrowser(browser, { id, fixture }) {
  const page = await browser.newPage({ viewport });
  const startedAt = Date.now();

  try {
    await page.goto(
      `${baseURL}/#/chat?fixture=${fixture.scenario.name}&bench=1`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('[data-testid="chat-feed"]', {
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => {
        const feed = document.querySelector('[data-testid="chat-feed"]');
        return (
          feed?.getAttribute("data-streaming") === "false" &&
          document.querySelectorAll(".markdown-block").length > 0
        );
      },
      { timeout: 120_000 },
    );

    const totalMs = Date.now() - startedAt;
    await page.waitForTimeout(1_200);

    const metrics = await readMetrics(page);

    return { totalMs, metrics };
  } finally {
    await page.close();
  }
}

function parseMetric(value) {
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

async function main() {
  const cases = readCases();
  const server = await ensureServer();

  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL ?? "chrome",
  });

  try {
    const results = [];

    for (const item of cases) {
      const fixture = writeStreamingFixture({
        fixturesRoot,
        name: `bench-${item.id}`,
        blockCount: item.blocks,
        chunkSize: item.chunkSize,
        delayMs: item.delayMs,
      });

      // 等 fixture watcher 把新场景注册进 mock 运行时
      await new Promise((resolve) => setTimeout(resolve, 800));

      const reducerMs = measureReducer(fixture);
      const browserResult = await measureBrowser(browser, {
        id: item.id,
        fixture,
      });
      const metrics = browserResult.metrics;
      const closedMetric = String(metrics["闭合块渲染"] ?? "");
      const uniqueRenderedBlocks = parseMetric(closedMetric.split("/")[1] ?? "");

      results.push({
        id: item.id,
        description: item.description,
        blocks: fixture.blockCount,
        chunks: fixture.chunkCount,
        reducerMs: Number(reducerMs.toFixed(2)),
        totalMs: browserResult.totalMs,
        firstTokenMs: parseMetric(metrics["首 token"]),
        fps: parseMetric(metrics["帧率（最近）"]),
        renderedBlocks: parseMetric(metrics["块渲染"]),
        totalBlocks: parseMetric(metrics["总块数"]),
        uniqueRenderedBlocks,
        openBlockRenders: parseMetric(metrics["开放块渲染"]),
        textUpdates: parseMetric(metrics["文本增量"]),
        commitCount: parseMetric(metrics["提交次数"]),
        maxCommitMs: parseMetric(metrics["最大提交"]),
        heapMB: parseMetric(metrics["内存（JS Heap）"]),
        longFrames: parseMetric(metrics["长帧"]),
        rawMetrics: metrics,
      });

      console.log(
        `${item.id}: reducer ${results.at(-1).reducerMs}ms · ` +
          `${metrics["帧率（最近）"] ?? "-"} · ` +
          `${metrics["闭合块渲染"] ?? "-"} · ` +
          `首 token ${metrics["首 token"] ?? "-"}`,
      );
    }

    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        browser: await browser.version(),
        viewport,
        baseURL,
        runtimeMode: "mock",
      },
      dataset: "data/bench/streaming.jsonl",
      cases: results,
    };

    mkdirSync(resolve(root, "data/bench"), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`\nwrote ${reportPath}`);
  } finally {
    await browser.close();

    if (server) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // 服务已退出
      }
    }
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
