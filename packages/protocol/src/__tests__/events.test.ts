import { describe, expect, it } from "vitest";

import {
  agentEventEnvelopeSchema,
  agentEventSchema,
  isKnownEventType,
  parseAgentEvent,
} from "../events";

const baseEvent = {
  v: 1,
  eventId: "evt_001",
  seq: 1,
  runId: "run_test",
  threadId: "thread_test",
  ts: 0,
  type: "run.started",
  payload: { kind: "chat" },
};

describe("AgentEvent schema", () => {
  it("parses a known event and narrows its payload", () => {
    const event = parseAgentEvent(baseEvent);

    expect(event.type).toBe("run.started");

    if (event.type === "run.started") {
      expect(event.payload.kind).toBe("chat");
    }
  });

  it("accepts unknown event types at the envelope level", () => {
    const envelope = agentEventEnvelopeSchema.parse({
      ...baseEvent,
      type: "future.event",
      payload: { anything: true },
    });

    expect(envelope.type).toBe("future.event");
    expect(isKnownEventType(envelope.type)).toBe(false);
  });

  it("ignores unknown fields for forward compatibility", () => {
    const event = parseAgentEvent({ ...baseEvent, extra: "ignored" });

    expect("extra" in event).toBe(false);
  });

  it("rejects invalid seq values", () => {
    const result = agentEventSchema.safeParse({ ...baseEvent, seq: 0 });

    expect(result.success).toBe(false);
  });

  it("rejects a known type with an invalid payload", () => {
    const result = agentEventSchema.safeParse({
      ...baseEvent,
      payload: { kind: "unknown" },
    });

    expect(result.success).toBe(false);
  });
});
