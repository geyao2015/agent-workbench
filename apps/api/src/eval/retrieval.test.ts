import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KnowledgeBase } from "../kb/index.js";
import {
  DEFAULT_REFUSAL_SCORE,
  evaluateRetrieval,
  loadRetrievalCases,
} from "./retrieval.js";

const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
const datasetPath = fileURLToPath(
  new URL("../../../../data/eval/retrieval.jsonl", import.meta.url),
);

describe("retrieval evaluation", () => {
  const kb = KnowledgeBase.load(docsDir);
  const cases = loadRetrievalCases(datasetPath);

  it("评测集引用真实文档，且包含可回答与不可回答样本", () => {
    const known = new Set(kb.list().map((doc) => doc.id));

    expect(cases).toHaveLength(50);
    expect(cases.some((item) => item.answerable)).toBe(true);
    expect(cases.some((item) => !item.answerable)).toBe(true);

    for (const item of cases) {
      for (const sourceId of item.goldSourceIds) {
        expect(known.has(sourceId), `${item.id}: ${sourceId}`).toBe(true);
      }
    }
  });

  it("检索基线达到约定阈值", () => {
    const metrics = evaluateRetrieval(kb, cases, DEFAULT_REFUSAL_SCORE);

    expect(metrics.recallAt1).toBeGreaterThanOrEqual(0.8);
    expect(metrics.recallAt4).toBeGreaterThanOrEqual(0.95);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.85);
    expect(metrics.abstainRate).toBe(1);
    expect(metrics.failures).toEqual([]);
  });
});
