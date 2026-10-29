import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { KnowledgeBase } from "../kb/index.js";

export interface RetrievalCase {
  id: string;
  query: string;
  goldSourceIds: string[];
  answerable: boolean;
  tags: string[];
}

export interface RetrievalMetrics {
  total: number;
  answerable: number;
  unanswerable: number;
  recallAt1: number;
  recallAt4: number;
  mrr: number;
  abstained: number;
  abstainRate: number;
  failures: Array<{
    id: string;
    query: string;
    gold: string[];
    hits: Array<{ sourceId: string; score: number }>;
  }>;
}

export const DEFAULT_REFUSAL_SCORE = 4;

export function loadRetrievalCases(path: string): RetrievalCase[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line) as Partial<RetrievalCase>;

      if (
        typeof parsed.id !== "string" ||
        typeof parsed.query !== "string" ||
        !Array.isArray(parsed.goldSourceIds) ||
        typeof parsed.answerable !== "boolean"
      ) {
        throw new Error(`评测样本格式不合法：${line.slice(0, 80)}`);
      }

      return {
        id: parsed.id,
        query: parsed.query,
        goldSourceIds: parsed.goldSourceIds,
        answerable: parsed.answerable,
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      };
    });
}

export function evaluateRetrieval(
  kb: KnowledgeBase,
  cases: RetrievalCase[],
  refusalScore = DEFAULT_REFUSAL_SCORE,
): RetrievalMetrics {
  let recallAt1 = 0;
  let recallAt4 = 0;
  let reciprocalRank = 0;
  let answerable = 0;
  let unanswerable = 0;
  let abstained = 0;
  const failures: RetrievalMetrics["failures"] = [];

  for (const item of cases) {
    const hits = kb.search(item.query, 4);

    if (!item.answerable) {
      unanswerable += 1;

      if ((hits[0]?.score ?? 0) < refusalScore) {
        abstained += 1;
      }

      continue;
    }

    answerable += 1;
    const gold = new Set(item.goldSourceIds);
    const rank = hits.findIndex((hit) => gold.has(hit.sourceId));

    if (rank === 0) {
      recallAt1 += 1;
    }

    if (rank >= 0) {
      recallAt4 += 1;
      reciprocalRank += 1 / (rank + 1);
    } else {
      failures.push({
        id: item.id,
        query: item.query,
        gold: item.goldSourceIds,
        hits: hits.map((hit) => ({
          sourceId: hit.sourceId,
          score: hit.score,
        })),
      });
    }
  }

  return {
    total: cases.length,
    answerable,
    unanswerable,
    recallAt1: answerable > 0 ? recallAt1 / answerable : 0,
    recallAt4: answerable > 0 ? recallAt4 / answerable : 0,
    mrr: answerable > 0 ? reciprocalRank / answerable : 0,
    abstained,
    abstainRate: unanswerable > 0 ? abstained / unanswerable : 1,
    failures,
  };
}

function main() {
  const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
  const datasetPath = fileURLToPath(
    new URL("../../../../data/eval/retrieval.jsonl", import.meta.url),
  );
  const kb = KnowledgeBase.load(docsDir);
  const cases = loadRetrievalCases(datasetPath);
  const known = new Set(kb.list().map((doc) => doc.id));

  for (const item of cases) {
    for (const sourceId of item.goldSourceIds) {
      if (!known.has(sourceId)) {
        throw new Error(`${item.id} 的 goldSourceId 不存在：${sourceId}`);
      }
    }
  }

  const metrics = evaluateRetrieval(kb, cases);

  console.log("Retrieval evaluation");
  console.log(
    `cases=${metrics.total} answerable=${metrics.answerable} unanswerable=${metrics.unanswerable}`,
  );
  console.log(`Recall@1 ${(metrics.recallAt1 * 100).toFixed(1)}%`);
  console.log(`Recall@4 ${(metrics.recallAt4 * 100).toFixed(1)}%`);
  console.log(`MRR ${metrics.mrr.toFixed(3)}`);
  console.log(
    `Abstain@${DEFAULT_REFUSAL_SCORE} ${metrics.abstained}/${metrics.unanswerable} (${(metrics.abstainRate * 100).toFixed(0)}%)`,
  );

  for (const item of cases.filter((candidate) => !candidate.answerable)) {
    const hits = kb.search(item.query, 4);

    console.log(
      `\n[unanswerable ${item.id}] topScore=${(hits[0]?.score ?? 0).toFixed(3)} hits=${hits.map((hit) => `${hit.sourceId}:${hit.score}`).join(", ")}`,
    );
  }

  if (metrics.failures.length > 0) {
    console.log(`\nFailures (${metrics.failures.length})`);

    for (const failure of metrics.failures) {
      console.log(
        `- ${failure.id} ${failure.query} | gold=${failure.gold.join(",")} | hits=${failure.hits.map((hit) => `${hit.sourceId}:${hit.score}`).join(",")}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  main();
}
