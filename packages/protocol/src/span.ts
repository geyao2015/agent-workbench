export type SpanKind =
  | "agent"
  | "model"
  | "tool"
  | "retriever"
  | "stage"
  | "internal";

export type SpanStatus = "running" | "ok" | "error";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  runId: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
}
