import type {
  AgentEvent,
  Span,
  SpanStatus,
} from "@agent-workbench/protocol";

function runStatus(
  event: Extract<AgentEvent, { type: "run.completed" | "run.failed" }>,
): SpanStatus {
  if (event.type === "run.failed") {
    return "error";
  }

  return event.payload.status === "done" ? "ok" : "error";
}

export function deriveSpans(events: readonly AgentEvent[]): Span[] {
  const runStarted = events.find((event) => event.type === "run.started");

  if (!runStarted || runStarted.type !== "run.started") {
    return [];
  }

  const runId = runStarted.runId;
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "run.completed" || event.type === "run.failed",
    );
  const root: Span = {
    traceId: runId,
    spanId: `${runId}:span:root`,
    runId,
    name: "agent.run",
    kind: "agent",
    startTime: runStarted.ts,
    ...(terminal ? { endTime: terminal.ts } : {}),
    status: terminal
      ? runStatus(terminal as Extract<AgentEvent, { type: "run.completed" | "run.failed" }>)
      : "running",
    attributes: {
      runKind: runStarted.payload.kind,
      ...(runStarted.payload.title ? { title: runStarted.payload.title } : {}),
      ...(terminal?.type === "run.completed" && terminal.payload.usage
        ? { usage: terminal.payload.usage }
        : {}),
    },
  };

  const spans: Span[] = [root];
  const stageStarts = new Map<string, { start: number; kind?: string }>();
  const toolStarts = new Map<string, { start: number; name: string }>();
  const approvalStarts = new Map<string, number>();
  const approvals = new Map<
    string,
    { stageId?: string; risk?: string; title?: string }
  >();
  let spanIndex = 1;

  const addSpan = (
    name: string,
    kind: Span["kind"],
    startTime: number,
    endTime: number | undefined,
    status: SpanStatus,
    attributes: Record<string, unknown>,
  ) => {
    spans.push({
      traceId: runId,
      spanId: `${runId}:span:${spanIndex}`,
      parentSpanId: root.spanId,
      runId,
      name,
      kind,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
      status,
      attributes,
    });
    spanIndex += 1;
  };

  for (const event of events) {
    switch (event.type) {
      case "stage.started": {
        stageStarts.set(event.payload.stageId, {
          start: event.ts,
          ...(event.payload.kind ? { kind: event.payload.kind } : {}),
        });
        break;
      }

      case "stage.completed": {
        const started = stageStarts.get(event.payload.stageId);
        addSpan(
          `stage.${event.payload.stageId}`,
          "stage",
          started?.start ?? event.ts,
          event.ts,
          event.payload.status === "error" ? "error" : "ok",
          {
            stageId: event.payload.stageId,
            stageKind: started?.kind,
            status: event.payload.status,
            ...(event.payload.summary
              ? { summary: event.payload.summary }
              : {}),
          },
        );
        break;
      }

      case "tool.started": {
        toolStarts.set(event.payload.toolCallId, {
          start: event.ts,
          name: event.payload.name,
        });
        break;
      }

      case "tool.result": {
        const started = toolStarts.get(event.payload.toolCallId);
        addSpan(
          `tool.${started?.name ?? "unknown"}`,
          "tool",
          started?.start ?? event.ts,
          event.ts,
          event.payload.status === "error" ? "error" : "ok",
          {
            toolCallId: event.payload.toolCallId,
            status: event.payload.status,
            ...(event.payload.durationMs !== undefined
              ? { durationMs: event.payload.durationMs }
              : {}),
          },
        );
        break;
      }

      case "approval.required": {
        approvals.set(event.payload.approvalId, {
          stageId: event.payload.stageId,
          risk: event.payload.risk,
          title: event.payload.title,
        });
        break;
      }

      case "run.paused": {
        if (event.payload.reason === "approval" && event.payload.approvalId) {
          approvalStarts.set(event.payload.approvalId, event.ts);
        }
        break;
      }

      case "approval.resolved": {
        const start = approvalStarts.get(event.payload.approvalId);
        const meta = approvals.get(event.payload.approvalId);
        addSpan(
          "approval.wait",
          "internal",
          start ?? event.ts,
          event.ts,
          "ok",
          {
            approvalId: event.payload.approvalId,
            approved: event.payload.approved,
            ...(meta?.stageId ? { stageId: meta.stageId } : {}),
            ...(meta?.risk ? { risk: meta.risk } : {}),
            ...(meta?.title ? { title: meta.title } : {}),
          },
        );
        break;
      }

      default:
        break;
    }
  }

  return spans.sort((left, right) => {
    if (left.spanId === root.spanId) {
      return -1;
    }

    if (right.spanId === root.spanId) {
      return 1;
    }

    return left.startTime - right.startTime;
  });
}
