import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { KnowledgeBase } from "../kb/index.js";
import { findEvidence, searchLogs } from "../release/logs.js";

export interface RcaCase {
  id: string;
  incidentId: string;
  logFile: string;
  query: string;
  evidence: string[];
  runbookSourceId: string;
}

export interface RcaMetrics {
  total: number;
  evidenceLocated: number;
  evidenceSearchHit: number;
  runbookAt1: number;
  runbookAt4: number;
  failures: Array<{ id: string; reason: string }>;
}

export function loadRcaCases(path: string): RcaCase[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RcaCase);
}

export function evaluateRca(
  kb: KnowledgeBase,
  cases: RcaCase[],
  logsDir: string,
): RcaMetrics {
  let evidenceLocated = 0;
  let evidenceSearchHit = 0;
  let runbookAt1 = 0;
  let runbookAt4 = 0;
  const failures: RcaMetrics["failures"] = [];

  for (const item of cases) {
    const logs = {
      [item.logFile]: readFileSync(resolve(logsDir, item.logFile), "utf8"),
    };

    try {
      findEvidence(logs, item.evidence);
      evidenceLocated += 1;
    } catch (cause) {
      failures.push({
        id: item.id,
        reason: cause instanceof Error ? cause.message : "evidence missing",
      });
    }

    const searchHits = searchLogs(logs, item.query, 8).map((hit) => hit.text);
    const allEvidenceInSearch = item.evidence.every((needle) =>
      searchHits.some((line) => line.includes(needle)),
    );

    if (allEvidenceInSearch) {
      evidenceSearchHit += 1;
    } else {
      failures.push({ id: item.id, reason: "evidence not in search results" });
    }

    const runbookHits = kb.search(item.query, 4);
    const rank = runbookHits.findIndex(
      (hit) => hit.sourceId === item.runbookSourceId,
    );

    if (rank === 0) {
      runbookAt1 += 1;
    }

    if (rank >= 0) {
      runbookAt4 += 1;
    } else {
      failures.push({ id: item.id, reason: "runbook not in top 4" });
    }
  }

  const total = cases.length;

  return {
    total,
    evidenceLocated: total > 0 ? evidenceLocated / total : 0,
    evidenceSearchHit: total > 0 ? evidenceSearchHit / total : 0,
    runbookAt1: total > 0 ? runbookAt1 / total : 0,
    runbookAt4: total > 0 ? runbookAt4 / total : 0,
    failures,
  };
}

function main() {
  const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
  const evalDir = fileURLToPath(new URL("../../../../data/eval", import.meta.url));
  const cases = loadRcaCases(resolve(evalDir, "rca.jsonl"));
  const kb = KnowledgeBase.load(docsDir);
  const metrics = evaluateRca(kb, cases, resolve(evalDir, "logs"));

  console.log("RCA evaluation");
  console.log(`cases=${metrics.total}`);
  console.log(`evidence locate ${(metrics.evidenceLocated * 100).toFixed(1)}%`);
  console.log(
    `evidence search ${(metrics.evidenceSearchHit * 100).toFixed(1)}%`,
  );
  console.log(`runbook@1 ${(metrics.runbookAt1 * 100).toFixed(1)}%`);
  console.log(`runbook@4 ${(metrics.runbookAt4 * 100).toFixed(1)}%`);

  if (metrics.failures.length > 0) {
    console.log("\nFailures");

    for (const failure of metrics.failures) {
      console.log(`- ${failure.id}: ${failure.reason}`);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  main();
}
