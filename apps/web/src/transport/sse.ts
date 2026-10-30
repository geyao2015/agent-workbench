import { parseAgentEvent } from "@agent-workbench/protocol";
import type {
  AgentEvent,
  RunHistoryPage,
  RunKind,
  ThreadSummary,
} from "@agent-workbench/protocol";

interface CreateRunResponse {
  runId: string;
  threadId: string;
  kind: RunKind;
}

export interface RuntimeModelInfo {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  model: string;
  available: boolean;
}

export interface RuntimeInfo {
  mode: "agent" | "mock";
  provider?: "anthropic" | "openai";
  model?: string;
  modelId?: string;
  version: number;
  agentAvailable: boolean;
  models: RuntimeModelInfo[];
  docs?: number;
  releases?: number;
}

export interface RuntimeSwitchInput {
  mode: "agent" | "mock";
  modelId?: string;
}

export async function fetchRuntimeInfo(signal?: AbortSignal): Promise<RuntimeInfo> {
  const response = await fetch("/api/runtime", { signal });

  if (!response.ok) {
    throw new HttpError(response.status, `读取运行时信息失败：HTTP ${response.status}`);
  }

  return (await response.json()) as RuntimeInfo;
}

export async function switchRuntime(input: RuntimeSwitchInput): Promise<RuntimeInfo> {
  const response = await fetch("/api/runtime", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `切换运行时失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  return (await response.json()) as RuntimeInfo;
}

export async function fetchThreads(signal?: AbortSignal): Promise<ThreadSummary[]> {
  const response = await fetch("/api/threads", { signal });

  if (!response.ok) {
    throw new HttpError(response.status, `读取会话列表失败：HTTP ${response.status}`);
  }

  const input = (await response.json()) as { threads?: unknown };

  return Array.isArray(input.threads) ? (input.threads as ThreadSummary[]) : [];
}

export async function fetchThreadRuns(
  threadId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RunHistoryPage> {
  const params = new URLSearchParams({ limit: "20" });

  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(
    `/api/threads/${encodeURIComponent(threadId)}/runs?${params.toString()}`,
    { signal },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `读取会话历史失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  return (await response.json()) as RunHistoryPage;
}

export interface StartChatRunInput {
  prompt: string;
  fixture?: string;
  threadId?: string;
}

export interface StartChatRunOptions {
  signal?: AbortSignal;
  onRetry?: (attempt: number) => void;
  lastEventId?: string;
  stopOnPause?: boolean;
}

export interface StartedRun {
  runId: string;
  threadId: string;
  kind: RunKind;
  events: AsyncGenerator<AgentEvent, void, void>;
}

export interface DemoRun {
  runId: string;
  events: AgentEvent[];
}

export interface DemoThread {
  threadId: string;
  runs: DemoRun[];
}

export async function fetchLongConversation(
  signal?: AbortSignal,
): Promise<DemoThread> {
  const response = await fetch("/api/demo/long-conversation", {
    method: "POST",
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `加载长会话失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  const input = (await response.json()) as {
    threadId?: unknown;
    runs?: unknown;
  };

  if (typeof input.threadId !== "string" || !Array.isArray(input.runs)) {
    throw new Error("长会话数据格式不正确");
  }

  return {
    threadId: input.threadId,
    runs: input.runs.map((run) => {
      const candidate = run as { runId?: unknown; events?: unknown };

      if (
        typeof candidate.runId !== "string" ||
        !Array.isArray(candidate.events)
      ) {
        throw new Error("长会话 run 格式不正确");
      }

      return {
        runId: candidate.runId,
        events: candidate.events.map(parseAgentEvent),
      };
    }),
  };
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 300;

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function startChatRun(
  input: StartChatRunInput,
  options: StartChatRunOptions = {},
): Promise<StartedRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
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

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export async function resolveApproval(
  runId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const response = await fetch(
    `/api/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...decision, runId }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `提交审批失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
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
  path = "/api/runs",
): AsyncGenerator<AgentEvent, void, void> {
  const headers: Record<string, string> = { accept: "text/event-stream" };

  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  const response = await fetch(`${path}/${encodeURIComponent(runId)}/events`, {
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
  path = "/api/runs",
): AsyncGenerator<AgentEvent, void, void> {
  let lastEventId = options.lastEventId;
  let attempt = 0;

  while (true) {
    let stopped = false;

    try {
      for await (const event of openEventStream(
        runId,
        lastEventId,
        options.signal,
        path,
      )) {
        lastEventId = event.eventId;
        attempt = 0;

        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          ((options.stopOnPause ?? true) && event.type === "run.paused")
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
