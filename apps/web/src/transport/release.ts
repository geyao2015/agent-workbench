import type {
  AgentEvent,
  RunHistoryPage,
  RunKind,
  ThreadSummary,
} from "@agent-workbench/protocol";

import {
  HttpError,
  streamRunEvents,
  type StartChatRunOptions,
} from "./sse";

export interface ReleaseScenarioSummary {
  id: string;
  title: string;
  service: string;
  version: string;
  branch: string;
  stageCount: number;
}

export interface CreatedReleaseRun {
  runId: string;
  threadId: string;
  kind: RunKind;
}

export interface ArtifactContent {
  mime: string;
  body: string;
}

async function readJson<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `${fallbackMessage}：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  return (await response.json()) as T;
}

export async function fetchReleaseScenarios(
  signal?: AbortSignal,
): Promise<ReleaseScenarioSummary[]> {
  const response = await fetch("/api/releases/scenarios", { signal });
  const data = await readJson<{ scenarios?: ReleaseScenarioSummary[] }>(
    response,
    "读取发版场景失败",
  );

  return data.scenarios ?? [];
}

export async function fetchReleaseThreads(
  signal?: AbortSignal,
): Promise<ThreadSummary[]> {
  const response = await fetch("/api/releases/threads", { signal });
  const data = await readJson<{ threads?: ThreadSummary[] }>(
    response,
    "读取发版历史失败",
  );

  return data.threads ?? [];
}

export async function fetchReleaseRuns(
  threadId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RunHistoryPage> {
  const params = new URLSearchParams({ limit: "20" });

  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(
    `/api/releases/threads/${encodeURIComponent(threadId)}/runs?${params.toString()}`,
    { signal },
  );

  return readJson<RunHistoryPage>(response, "读取发版 run 失败");
}

export async function createReleaseRun(
  scenarioId?: string,
  signal?: AbortSignal,
): Promise<CreatedReleaseRun> {
  const response = await fetch("/api/releases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenarioId ? { scenarioId } : {}),
    signal,
  });

  return readJson<CreatedReleaseRun>(response, "创建发版 run 失败");
}

export async function rollbackReleaseRun(
  runId: string,
): Promise<CreatedReleaseRun & { parentRunId: string }> {
  const response = await fetch(
    `/api/releases/runs/${encodeURIComponent(runId)}/rollback`,
    { method: "POST" },
  );

  return readJson<CreatedReleaseRun & { parentRunId: string }>(
    response,
    "创建回滚 run 失败",
  );
}

export async function cancelReleaseRun(runId: string): Promise<void> {
  const response = await fetch(
    `/api/releases/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );

  await readJson<{ cancelled: boolean }>(response, "取消发版 run 失败");
}

export async function resolveReleaseApproval(
  approvalId: string,
  decision: { approved: boolean; note?: string },
): Promise<void> {
  const response = await fetch(
    `/api/releases/approvals/${encodeURIComponent(approvalId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision),
    },
  );

  await readJson<{ resolved: boolean }>(response, "提交审批失败");
}

export async function fetchReleaseArtifact(
  uri: string,
  signal?: AbortSignal,
): Promise<ArtifactContent> {
  const response = await fetch(uri, { signal });

  return readJson<ArtifactContent>(response, "读取 artifact 失败");
}

export async function fetchReleaseEvents(
  runId: string,
  signal?: AbortSignal,
): Promise<AgentEvent[]> {
  const response = await fetch(
    `/api/releases/runs/${encodeURIComponent(runId)}/events.json`,
    { signal },
  );
  const data = await readJson<{ events?: AgentEvent[] }>(
    response,
    "读取事件日志失败",
  );

  return data.events ?? [];
}

export function streamReleaseRunEvents(
  runId: string,
  options: StartChatRunOptions = {},
): AsyncGenerator<AgentEvent, void, void> {
  return streamRunEvents(
    runId,
    { ...options, stopOnPause: false },
    "/api/releases/runs",
  );
}
