import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent, Scenario } from "@agent-workbench/protocol";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

export interface FixtureDefinition {
  scenario: Scenario;
  events: AgentEvent[];
}

function parseJsonl(text: string): AgentEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEvent);
}

export function loadFixtures(): Map<string, FixtureDefinition> {
  const fixtures = new Map<string, FixtureDefinition>();

  for (const entry of readdirSync(fixturesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = resolve(fixturesRoot, entry.name);
    const scenario = JSON.parse(
      readFileSync(resolve(directory, "scenario.json"), "utf8"),
    ) as Scenario;
    const events = parseJsonl(readFileSync(resolve(directory, "events.jsonl"), "utf8"));

    fixtures.set(scenario.name, { scenario, events });
  }

  return fixtures;
}
