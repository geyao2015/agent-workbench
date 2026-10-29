import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { z } from "zod";

import { findEvidence } from "./logs.js";
import type { ReleaseScenario } from "./types.js";

const stageKindSchema = z.enum([
  "preflight",
  "conflict_resolve",
  "diff_approval",
  "test",
  "rca",
  "fix_approval",
  "release_notes",
  "dry_run_tag",
  "rollback_preflight",
  "rollback_approval",
  "rollback_execute",
  "rollback_verify",
  "audit",
]);

const stageSchema = z.object({
  id: z.string().min(1),
  kind: stageKindSchema,
  name: z.string().min(1),
  summary: z.string().optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  description: z.string().optional(),
});

const scenarioFileSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  service: z.string().min(1),
  version: z.string().min(1),
  branch: z.string().min(1),
  tag: z.string().min(1),
  conflictContext: z.string().min(1),
  rca: z.object({
    incidentId: z.string().min(1),
    rootCause: z.string().min(1),
    fix: z.string().min(1),
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.array(z.string().min(1)).min(1),
    runbookQuery: z.string().min(1),
  }),
  rollback: z.object({
    targetTag: z.string().min(1),
    stages: z.array(stageSchema).min(1),
  }),
  stages: z.array(stageSchema).min(1),
});

const hunkSchema = z.object({
  id: z.string().min(1),
  base: z.string(),
  ours: z.string(),
  theirs: z.string(),
  recommended: z.string(),
  rationale: z.string(),
});

const repoFileSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      hunks: z.array(hunkSchema).min(1),
    }),
  ),
});

const ciFileSchema = z.object({
  attempts: z.record(
    z.string(),
    z.object({
      status: z.enum(["success", "error"]),
      summary: z.string(),
      durationMs: z.number().nonnegative().optional(),
      logFile: z.string().optional(),
    }),
  ),
});

export function loadReleaseScenarios(rootDir: string): ReleaseScenario[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const scenarios: ReleaseScenario[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = resolve(rootDir, entry.name);
    const scenarioPath = resolve(directory, "scenario.json");

    if (!existsSync(scenarioPath)) {
      continue;
    }

    const scenarioFile = scenarioFileSchema.parse(
      JSON.parse(readFileSync(scenarioPath, "utf8")),
    );
    const repo = repoFileSchema.parse(
      JSON.parse(readFileSync(resolve(directory, "repo.json"), "utf8")),
    );
    const ci = ciFileSchema.parse(
      JSON.parse(readFileSync(resolve(directory, "ci.json"), "utf8")),
    );
    const notesTemplate = readFileSync(
      resolve(directory, "notes-template.md"),
      "utf8",
    );
    const logsDir = resolve(directory, "logs");
    const logs: Record<string, string> = {};

    if (existsSync(logsDir)) {
      for (const logEntry of readdirSync(logsDir, { withFileTypes: true })) {
        if (logEntry.isFile()) {
          logs[basename(logEntry.name)] = readFileSync(
            resolve(logsDir, logEntry.name),
            "utf8",
          );
        }
      }
    }

    findEvidence(logs, scenarioFile.rca.evidence);

    scenarios.push({
      ...scenarioFile,
      files: repo.files,
      ciAttempts: ci.attempts,
      logs,
      notesTemplate,
    });
  }

  return scenarios;
}
