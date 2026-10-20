import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  delayForSeq,
  parseEventsJsonl,
  parseFixture,
  replayEvents,
  rewriteEventIds,
} from "../fixture";
import type { AgentEvent } from "../events";
import type { Timing } from "../fixture";

const fixturesRoot = fileURLToPath(new URL("../../../../fixtures", import.meta.url));
const scenarioJson = readFileSync(resolve(fixturesRoot, "chat-short/scenario.json"), "utf8");
const eventsJsonl = readFileSync(resolve(fixturesRoot, "chat-short/events.jsonl"), "utf8");

function eventLines(): Record<string, unknown>[] {
  return eventsJsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function collect(
  events: readonly AgentEvent[],
  timing: Timing,
  sleep?: (ms: number) => Promise<void>,
): Promise<AgentEvent[]> {
  const applied: AgentEvent[] = [];

  for await (const event of replayEvents(events, timing, { sleep })) {
    applied.push(event);
  }

  return applied;
}

describe("fixture parsing", () => {
  it("parses every fixture directory", () => {
    const names = readdirSync(fixturesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const scenario = readFileSync(resolve(fixturesRoot, name, "scenario.json"), "utf8");
      const events = readFileSync(resolve(fixturesRoot, name, "events.jsonl"), "utf8");

      expect(() => parseFixture(scenario, events), name).not.toThrow();
    }
  });

  it("keeps the streaming demo long enough to pause", () => {
    const scenario = readFileSync(
      resolve(fixturesRoot, "chat-release-notes/scenario.json"),
      "utf8",
    );
    const events = readFileSync(
      resolve(fixturesRoot, "chat-release-notes/events.jsonl"),
      "utf8",
    );
    const fixture = parseFixture(scenario, events);
    const totalMs = fixture.events.reduce(
      (sum, event) => sum + delayForSeq(fixture.scenario.timing, event.seq),
      0,
    );

    expect(totalMs).toBeGreaterThanOrEqual(4000);
  });

  it("parses the sample fixture", () => {
    const fixture = parseFixture(scenarioJson, eventsJsonl);

    expect(fixture.scenario.name).toBe("chat-short");
    expect(fixture.events).toHaveLength(8);
    expect(fixture.events[0]?.type).toBe("run.started");
    expect(fixture.events.at(-1)?.type).toBe("run.completed");
  });

  it("rejects non-contiguous seq values", () => {
    const lines = eventLines();
    lines[1] = { ...lines[1], seq: 5 };

    expect(() =>
      parseEventsJsonl(lines.map((line) => JSON.stringify(line)).join("\n")),
    ).toThrow(/seq/);
  });

  it("rejects duplicate event ids", () => {
    const lines = eventLines();
    lines[1] = { ...lines[1], eventId: "evt_short_001" };

    expect(() =>
      parseEventsJsonl(lines.map((line) => JSON.stringify(line)).join("\n")),
    ).toThrow(/eventId/);
  });

  it("rejects events that do not match the scenario", () => {
    const scenario = JSON.parse(scenarioJson) as Record<string, unknown>;
    scenario.runKind = "release";

    expect(() => parseFixture(JSON.stringify(scenario), eventsJsonl)).toThrow(/runKind/);
  });
});

describe("fixture replay", () => {
  const { events } = parseFixture(scenarioJson, eventsJsonl);

  it("replays all events in order without delay in fast mode", async () => {
    const applied = await collect(events, { mode: "fast", defaultMs: 1000 });

    expect(applied.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("uses bySeq overrides before the default delay", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const timing: Timing = {
      mode: "delays",
      defaultMs: 10,
      bySeq: { "1": 0, "2": 5 },
    };

    await collect(events, timing, sleep);

    expect(sleep).toHaveBeenCalledTimes(7);
    expect(sleep.mock.calls[0]?.[0]).toBe(5);
    expect(sleep.mock.calls[1]?.[0]).toBe(10);
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const iterator = replayEvents(events, { mode: "fast", defaultMs: 0 }, {
      signal: controller.signal,
      sleep: async () => {},
    });

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rewrites run and thread ids", () => {
    const rewritten = rewriteEventIds(events, {
      runId: "run_other",
      threadId: "thread_other",
    });

    expect(new Set(rewritten.map((event) => event.runId))).toEqual(new Set(["run_other"]));
    expect(new Set(rewritten.map((event) => event.threadId))).toEqual(
      new Set(["thread_other"]),
    );
  });
});
