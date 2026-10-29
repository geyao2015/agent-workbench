import { z } from "zod";

export const runKindSchema = z.enum(["chat", "release"]);
export type RunKind = z.infer<typeof runKindSchema>;

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type Usage = z.infer<typeof usageSchema>;

export const riskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof riskSchema>;

export const artifactKindSchema = z.enum([
  "diff",
  "log_bundle",
  "release_notes",
  "plan",
  "document",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

function event<const T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({
    v: z.literal(1),
    eventId: z.string().min(1),
    seq: z.number().int().positive(),
    runId: z.string().min(1),
    threadId: z.string().min(1),
    ts: z.number().int().nonnegative(),
    type: z.literal(type),
    payload,
  });
}

const eventSchemas = [
  event(
    "run.started",
    z.object({
      kind: runKindSchema,
      title: z.string().optional(),
      parentRunId: z.string().optional(),
      sourceRunId: z.string().optional(),
    }),
  ),
  event(
    "run.paused",
    z.object({
      reason: z.enum(["approval", "user"]),
      approvalId: z.string().optional(),
    }),
  ),
  event("run.resumed", z.object({ fromSeq: z.number().int().positive().optional() })),
  event(
    "run.completed",
    z.object({
      status: z.enum(["done", "cancelled", "error"]),
      usage: usageSchema.optional(),
    }),
  ),
  event(
    "run.failed",
    z.object({
      code: z.string().min(1),
      message: z.string(),
      retryable: z.boolean(),
    }),
  ),
  event(
    "message.started",
    z.object({
      messageId: z.string().min(1),
      role: z.enum(["user", "assistant"]),
    }),
  ),
  event(
    "text.delta",
    z.object({
      messageId: z.string().min(1),
      delta: z.string(),
      blockId: z.string().min(1).optional(),
    }),
  ),
  event(
    "text.block.completed",
    z.object({
      messageId: z.string().min(1),
      blockId: z.string().min(1),
    }),
  ),
  event(
    "message.completed",
    z.object({
      messageId: z.string().min(1),
      stopReason: z.string().optional(),
    }),
  ),
  event(
    "reasoning.started",
    z.object({
      messageId: z.string().min(1),
      blockId: z.string().min(1).optional(),
    }),
  ),
  event(
    "reasoning.delta",
    z.object({
      messageId: z.string().min(1),
      delta: z.string(),
      blockId: z.string().min(1).optional(),
    }),
  ),
  event(
    "reasoning.completed",
    z.object({
      messageId: z.string().min(1),
      blockId: z.string().min(1).optional(),
    }),
  ),
  event(
    "citation.added",
    z.object({
      messageId: z.string().min(1),
      citationId: z.string().min(1),
      sourceId: z.string().min(1),
      title: z.string().optional(),
      locator: z.string().optional(),
    }),
  ),
  event(
    "tool.started",
    z.object({
      toolCallId: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
  event(
    "tool.args.delta",
    z.object({
      toolCallId: z.string().min(1),
      delta: z.string(),
    }),
  ),
  event(
    "tool.ready",
    z.object({
      toolCallId: z.string().min(1),
      args: z.unknown(),
    }),
  ),
  event(
    "tool.result",
    z.object({
      toolCallId: z.string().min(1),
      status: z.enum(["success", "error"]),
      content: z.string(),
      durationMs: z.number().nonnegative().optional(),
    }),
  ),
  event(
    "tool.approval_required",
    z.object({
      toolCallId: z.string().min(1),
      approvalId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      risk: riskSchema,
      args: z.unknown(),
    }),
  ),
  event(
    "tool.approval_resolved",
    z.object({
      toolCallId: z.string().min(1),
      approvalId: z.string().min(1),
      approved: z.boolean(),
      note: z.string().optional(),
    }),
  ),
  event(
    "approval.required",
    z.object({
      approvalId: z.string().min(1),
      scope: z.literal("stage"),
      stageId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      risk: riskSchema,
      args: z.unknown(),
    }),
  ),
  event(
    "approval.resolved",
    z.object({
      approvalId: z.string().min(1),
      approved: z.boolean(),
      note: z.string().optional(),
    }),
  ),
  event(
    "stage.started",
    z.object({
      stageId: z.string().min(1),
      name: z.string().min(1),
      kind: z.string().optional(),
    }),
  ),
  event(
    "stage.completed",
    z.object({
      stageId: z.string().min(1),
      status: z.enum(["success", "error", "skipped"]),
      summary: z.string().optional(),
    }),
  ),
  event(
    "artifact.created",
    z.object({
      artifactId: z.string().min(1),
      kind: artifactKindSchema,
      title: z.string().min(1),
      mime: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
      uri: z.string().optional(),
      stageId: z.string().min(1).optional(),
    }),
  ),
  event(
    "artifact.updated",
    z.object({
      artifactId: z.string().min(1),
      patch: z
        .object({
          title: z.string().optional(),
          mime: z.string().optional(),
          size: z.number().int().nonnegative().optional(),
          uri: z.string().optional(),
          stageId: z.string().min(1).optional(),
        })
        .optional(),
    }),
  ),
  event(
    "error",
    z.object({
      code: z.string().min(1),
      message: z.string(),
      retryable: z.boolean(),
      scope: z.string().optional(),
    }),
  ),
] as const;

export const agentEventSchema = z.discriminatedUnion("type", eventSchemas);
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = AgentEvent["type"];

export const knownEventTypes: ReadonlySet<AgentEventType> = new Set(
  eventSchemas.map((schema) => schema.shape.type.value as AgentEventType),
);

export function isKnownEventType(type: string): type is AgentEventType {
  return (knownEventTypes as ReadonlySet<string>).has(type);
}

export const agentEventEnvelopeSchema = z.object({
  v: z.literal(1),
  eventId: z.string().min(1),
  seq: z.number().int().positive(),
  runId: z.string().min(1),
  threadId: z.string().min(1),
  ts: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
});
export type AgentEventEnvelope = z.infer<typeof agentEventEnvelopeSchema>;

export function parseAgentEvent(input: unknown): AgentEvent {
  return agentEventSchema.parse(input);
}

export function parseAgentEventEnvelope(input: unknown): AgentEventEnvelope {
  return agentEventEnvelopeSchema.parse(input);
}
