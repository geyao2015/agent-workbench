import { parseAgentEvent } from "@agent-workbench/protocol";
import type { AgentEvent, RunKind } from "@agent-workbench/protocol";

interface CreateRunResponse {
  runId: string;
  threadId: string;
  fixture: string;
  kind: RunKind;
}

export interface StartChatRunOptions {
  signal?: AbortSignal;
  onRetry?: (attempt: number) => void;
  lastEventId?: string;
}

export interface StartedRun {
  runId: string;
  threadId: string;
  kind: RunKind;
  events: AsyncGenerator<AgentEvent, void, void>;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 300;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function startChatRun(
  fixture: string,
  options: StartChatRunOptions = {},
): Promise<StartedRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `创建 run 失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  const created = (await response.json()) as CreateRunResponse;

  return {
    runId: created.runId,
    threadId: created.threadId,
    kind: created.kind,
    events: streamRunEvents(created.runId, options),
  };
}

export async function cancelRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `取消 run 失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }
}

export async function pauseRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/pause`, {
    method: "POST",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `暂停 run 失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }
}

function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

function abortError(): Error {
  const error = new Error("请求已取消");
  error.name = "AbortError";
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

function parseSseData(frame: string): string | null {
  const data: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  return data.length > 0 ? data.join("\n") : null;
}

function decodeFrame(frame: string): AgentEvent | null {
  const data = parseSseData(frame);

  if (!data) {
    return null;
  }

  let input: unknown;

  try {
    input = JSON.parse(data);
  } catch (cause) {
    throw new Error("SSE 事件不是合法 JSON", { cause });
  }

  try {
    return parseAgentEvent(input);
  } catch (cause) {
    throw new Error("SSE 事件不符合 AgentEvent v1", { cause });
  }
}

async function* openEventStream(
  runId: string,
  lastEventId: string | undefined,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent, void, void> {
  const headers: Record<string, string> = { accept: "text/event-stream" };

  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, {
    headers,
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `订阅事件失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");

      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const event = decodeFrame(frame);

        if (event) {
          yield event;
        }

        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();

    for (const frame of buffer.split("\n\n")) {
      if (!frame.trim()) {
        continue;
      }

      const event = decodeFrame(frame);

      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamRunEvents(
  runId: string,
  options: StartChatRunOptions = {},
): AsyncGenerator<AgentEvent, void, void> {
  let lastEventId = options.lastEventId;
  let attempt = 0;

  while (true) {
    let stopped = false;

    try {
      for await (const event of openEventStream(runId, lastEventId, options.signal)) {
        lastEventId = event.eventId;
        attempt = 0;

        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.paused"
        ) {
          stopped = true;
        }

        yield event;
      }
    } catch (cause) {
      if (options.signal?.aborted || isAbortError(cause)) {
        throw cause;
      }

      if (cause instanceof HttpError && cause.status === 404) {
        throw cause;
      }

      if (attempt >= MAX_RETRIES) {
        throw cause;
      }

      attempt += 1;
      options.onRetry?.(attempt);
      await sleep(RETRY_BASE_MS * attempt, options.signal);
      continue;
    }

    if (stopped) {
      return;
    }

    if (attempt >= MAX_RETRIES) {
      throw new Error("SSE 连接在收到终态事件前结束");
    }

    attempt += 1;
    options.onRetry?.(attempt);
    await sleep(RETRY_BASE_MS * attempt, options.signal);
  }
}
