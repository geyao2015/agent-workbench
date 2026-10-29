import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KnowledgeBase } from "../kb/index.js";
import { evaluateRca, loadRcaCases } from "./rca.js";

const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
const evalDir = fileURLToPath(new URL("../../../../data/eval", import.meta.url));

describe("RCA evaluation", () => {
  const kb = KnowledgeBase.load(docsDir);
  const cases = loadRcaCases(resolve(evalDir, "rca.jsonl"));
  const metrics = evaluateRca(kb, cases, resolve(evalDir, "logs"));

  it("包含 10 个事故案例并覆盖证据与 runbook", () => {
    expect(cases).toHaveLength(10);
    expect(metrics.evidenceLocated).toBe(1);
    expect(metrics.evidenceSearchHit).toBe(1);
    expect(metrics.runbookAt4).toBeGreaterThanOrEqual(0.9);
    expect(metrics.failures).toEqual([]);
  });
});
