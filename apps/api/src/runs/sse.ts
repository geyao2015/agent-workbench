import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { ActiveRun } from "./run-registry.js";

export function streamRunEvents(c: Context, run: ActiveRun) {
  const lastEventId =
    c.req.header("last-event-id") ?? c.req.query("lastEventId");
  const afterSeq = run.log.sequenceAfter(lastEventId);

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    for await (const event of run.log.iterate(afterSeq, abort.signal)) {
      await stream.writeSSE({
        id: event.eventId,
        data: JSON.stringify(event),
      });
    }
  });
}
