import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createChatAgent } from "../agent/graph.js";
import { AgentRunner } from "../agent/runner.js";
import { loadRuntimeConfig, resolveModelConfig } from "../config.js";
import { KnowledgeBase } from "../kb/index.js";
import { loadReleaseScenarios } from "../release/scenario.js";
import { RunLog } from "../runs/run-log.js";

export interface AnswerCase {
  id: string;
  query: string;
  goldSourceIds: string[];
  goldPoints: string[];
  answerable: boolean;
}

export interface AnswerObservation {
  answer: string;
  citations: string[];
  tools: string[];
}

export interface AnswerMetrics {
  total: number;
  citationRecall: number;
  citationPrecision: number;
  keyPointCoverage: number;
  refusalAccuracy: number;
  failures: Array<{ id: string; reason: string }>;
}

export function loadAnswerCases(path: string): AnswerCase[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AnswerCase);
}

export function isRefusal(text: string): boolean {
  return /(无法|不能|没有找到|资料不足|未找到|抱歉|not able|cannot|insufficient)/i.test(
    text,
  );
}

export function evaluateAnswer(
  cases: AnswerCase[],
  observations: Record<string, AnswerObservation>,
): AnswerMetrics {
  let citationRecall = 0;
  let citationPrecision = 0;
  let keyPointCoverage = 0;
  let refusalCorrect = 0;
  const failures: AnswerMetrics["failures"] = [];

  for (const item of cases) {
    const observation = observations[item.id] ?? {
      answer: "",
      citations: [],
      tools: [],
    };
    const cited = new Set(observation.citations);
    const gold = new Set(item.goldSourceIds);

    if (item.answerable) {
      const matchedSources = [...cited].filter((sourceId) => gold.has(sourceId));
      citationRecall += gold.size > 0 ? matchedSources.length / gold.size : 1;
      citationPrecision += cited.size > 0 ? matchedSources.length / cited.size : 0;

      const points = item.goldPoints.filter((point) =>
        observation.answer.includes(point),
      );
      keyPointCoverage +=
        item.goldPoints.length > 0 ? points.length / item.goldPoints.length : 1;

      const answered = observation.answer.trim().length > 0;
      const refused = isRefusal(observation.answer);

      if (answered && !refused) {
        refusalCorrect += 1;
      } else {
        failures.push({ id: item.id, reason: "answerable question was refused" });
      }

      if (points.length < item.goldPoints.length) {
        failures.push({
          id: item.id,
          reason: `missing points: ${item.goldPoints.filter((point) => !points.includes(point)).join(",")}`,
        });
      }

      if (gold.size > 0 && matchedSources.length === 0) {
        failures.push({ id: item.id, reason: "no citation matched gold" });
      }
    } else {
      if (isRefusal(observation.answer)) {
        refusalCorrect += 1;
      } else {
        failures.push({ id: item.id, reason: "unanswerable question not refused" });
      }
    }
  }

  const total = cases.length;
  const answerable = cases.filter((item) => item.answerable).length || 1;

  return {
    total,
    citationRecall: citationRecall / answerable,
    citationPrecision: citationPrecision / answerable,
    keyPointCoverage: keyPointCoverage / answerable,
    refusalAccuracy: total > 0 ? refusalCorrect / total : 0,
    failures,
  };
}

async function main() {
  const config = loadRuntimeConfig();
  const model = resolveModelConfig(config);

  if (!model) {
    console.log(
      "Answer evaluation skipped: configure ANTHROPIC_API_KEY or OPENAI_API_KEY.",
    );
    return;
  }

  const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
  const evalDir = fileURLToPath(new URL("../../../../data/eval", import.meta.url));
  const cases = loadAnswerCases(`${evalDir}/answer.jsonl`);
  const kb = KnowledgeBase.load(docsDir);
  const scenarios = loadReleaseScenarios(
    fileURLToPath(new URL("../../../../data/releases", import.meta.url)),
  );
  const agent = createChatAgent(model, kb, scenarios);
  const observations: Record<string, AnswerObservation> = {};

  for (const item of cases) {
    const runId = `run_eval_${item.id}_${randomUUID()}`;
    const log = new RunLog({ runId, threadId: `thread_eval_${item.id}`, kind: "chat" });
    log.append("run.started", { kind: "chat", title: item.query });
    log.append("message.started", { messageId: `${runId}:a`, role: "assistant" });
    const runner = new AgentRunner(agent, log, kb, `${runId}:a`);

    try {
      await runner.run({
        threadId: `thread_eval_${item.id}`,
        prompt: item.query,
        history: [],
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      // 评测继续，空观察会进入失败列表
    }

    const events = log.snapshotEvents();
    const answer = events
      .flatMap((event) => (event.type === "text.delta" ? [event.payload.delta] : []))
      .join("");
    const citations = events.flatMap((event) =>
      event.type === "citation.added" ? [event.payload.sourceId] : [],
    );
    const tools = events.flatMap((event) =>
      event.type === "tool.started" ? [event.payload.name] : [],
    );

    observations[item.id] = { answer, citations, tools };
    console.log(
      `${item.id} tools=${tools.join(",") || "-"} citations=${citations.join(",") || "-"}`,
    );
  }

  const metrics = evaluateAnswer(cases, observations);

  console.log("\nAnswer evaluation");
  console.log(`cases=${metrics.total}`);
  console.log(`citation recall ${(metrics.citationRecall * 100).toFixed(1)}%`);
  console.log(
    `citation precision ${(metrics.citationPrecision * 100).toFixed(1)}%`,
  );
  console.log(
    `key point coverage ${(metrics.keyPointCoverage * 100).toFixed(1)}%`,
  );
  console.log(
    `refusal accuracy ${(metrics.refusalAccuracy * 100).toFixed(1)}%`,
  );

  if (metrics.failures.length > 0) {
    console.log("\nFailures");

    for (const failure of metrics.failures) {
      console.log(`- ${failure.id}: ${failure.reason}`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  void main();
}
