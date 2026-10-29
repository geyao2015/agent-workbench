import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import type { ReleaseScenario } from "./types.js";

const stageKindSchema = z.enum([
  "preflight",
  "conflict_resolve",
  "diff_approval",
  "test",
  "release_notes",
  "dry_run_tag",
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

    scenarios.push({
      ...scenarioFile,
      files: repo.files,
      ciAttempts: ci.attempts,
      notesTemplate,
    });
  }

  return scenarios;
}
