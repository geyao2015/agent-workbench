import { z } from "zod";

import { agentEventSchema, runKindSchema } from "./events.js";
import type { AgentEvent } from "./events.js";

export const timingSchema = z.object({
  mode: z.enum(["delays", "fast"]),
  defaultMs: z.number().nonnegative().default(0),
  bySeq: z.record(z.string(), z.number().nonnegative()).optional(),
});
export type Timing = z.infer<typeof timingSchema>;

export const scenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  runKind: runKindSchema,
  threadId: z.string().min(1),
  timing: timingSchema,
});
export type Scenario = z.infer<typeof scenarioSchema>;

export interface Fixture {
  scenario: Scenario;
  events: AgentEvent[];
}

export class ProtocolParseError extends Error {
  readonly line?: number;

  constructor(message: string, options: { line?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ProtocolParseError";
    this.line = options.line;
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parseScenario(json: string): Scenario {
  let input: unknown;

  try {
    input = JSON.parse(json);
  } catch (cause) {
    throw new ProtocolParseError("scenario.json 不是合法 JSON", { cause });
  }

  const result = scenarioSchema.safeParse(input);

  if (!result.success) {
    throw new ProtocolParseError(`scenario.json 不符合格式：${formatIssues(result.error)}`);
  }

  return result.data;
}

export function parseEventsJsonl(text: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  const seenEventIds = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    let input: unknown;

    try {
      input = JSON.parse(line);
    } catch (cause) {
      throw new ProtocolParseError(`events.jsonl 第 ${index + 1} 行不是合法 JSON`, {
        line: index + 1,
        cause,
      });
    }

    const result = agentEventSchema.safeParse(input);

    if (!result.success) {
      throw new ProtocolParseError(
        `events.jsonl 第 ${index + 1} 行不符合 AgentEvent v1：${formatIssues(result.error)}`,
        { line: index + 1 },
      );
    }

    const event = result.data;
    const previous = events.at(-1);

    if (seenEventIds.has(event.eventId)) {
      throw new ProtocolParseError(`重复的 eventId：${event.eventId}`, { line: index + 1 });
    }

    if (!previous && event.seq !== 1) {
      throw new ProtocolParseError(`首个事件的 seq 必须为 1，实际为 ${event.seq}`, {
        line: index + 1,
      });
    }

    if (previous && event.seq !== previous.seq + 1) {
      throw new ProtocolParseError(
        `seq 必须连续递增：${previous.seq} 之后应为 ${previous.seq + 1}，实际为 ${event.seq}`,
        { line: index + 1 },
      );
    }

    if (previous && (event.runId !== previous.runId || event.threadId !== previous.threadId)) {
      throw new ProtocolParseError("同一 fixture 内 runId / threadId 必须一致", {
        line: index + 1,
      });
    }

    seenEventIds.add(event.eventId);
    events.push(event);
  }

  if (events.length === 0) {
    throw new ProtocolParseError("events.jsonl 为空");
  }

  return events;
}

export function parseFixture(scenarioJson: string, eventsJsonl: string): Fixture {
  const scenario = parseScenario(scenarioJson);
  const events = parseEventsJsonl(eventsJsonl);
  const first = events[0];

  if (!first || first.type !== "run.started") {
    throw new ProtocolParseError("fixture 的第一个事件必须是 run.started");
  }

  if (first.threadId !== scenario.threadId) {
    throw new ProtocolParseError("scenario.threadId 与事件 threadId 不一致");
  }

  if (first.payload.kind !== scenario.runKind) {
    throw new ProtocolParseError("scenario.runKind 与 run.started.kind 不一致");
  }

  return { scenario, events };
}

export function rewriteEventIds(
  events: readonly AgentEvent[],
  ids: { runId?: string; threadId?: string },
): AgentEvent[] {
  return events.map((event) => ({
    ...event,
    runId: ids.runId ?? event.runId,
    threadId: ids.threadId ?? event.threadId,
  }));
}

export function delayForSeq(timing: Timing, seq: number): number {
  if (timing.mode === "fast") {
    return 0;
  }

  return timing.bySeq?.[String(seq)] ?? timing.defaultMs;
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface ReplayOptions {
  signal?: AbortSignal;
  sleep?: Sleep;
}

function abortError(): Error {
  const error = new Error("fixture 回放已取消");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export async function* replayEvents(
  events: readonly AgentEvent[],
  timing: Timing,
  options: ReplayOptions = {},
): AsyncGenerator<AgentEvent, void, void> {
  const sleep = options.sleep ?? defaultSleep;

  for (const event of events) {
    throwIfAborted(options.signal);

    const delay = delayForSeq(timing, event.seq);

    if (delay > 0) {
      await sleep(delay, options.signal);
    }

    throwIfAborted(options.signal);
    yield event;
  }
}

