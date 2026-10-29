import type {
  AgentEvent,
  AgentEventType,
  RunKind,
} from "@agent-workbench/protocol";

type PayloadOf<T extends AgentEventType> = Extract<
  AgentEvent,
  { type: T }
>["payload"];

export class RunLog {
  readonly runId: string;
  readonly threadId: string;
  readonly kind: RunKind;
  private readonly events: AgentEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private seq = 0;
  private finished = false;

  constructor(input: { runId: string; threadId: string; kind: RunKind }) {
    this.runId = input.runId;
    this.threadId = input.threadId;
    this.kind = input.kind;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get lastEvent(): AgentEvent | undefined {
    return this.events.at(-1);
  }

  append<T extends AgentEventType>(type: T, payload: PayloadOf<T>): AgentEvent {
    if (this.finished) {
      throw new Error(`run ${this.runId} 已结束，不能再追加事件`);
    }

    const seq = this.seq + 1;
    const event = {
      v: 1,
      eventId: `${this.runId}:${seq}`,
      seq,
      runId: this.runId,
      threadId: this.threadId,
      ts: Date.now(),
      type,
      payload,
    } as AgentEvent;

    this.seq = seq;
    this.events.push(event);
    this.notify();

    return event;
  }

  finish(): void {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.notify();
  }

  snapshotEvents(): readonly AgentEvent[] {
    return this.events;
  }

  sequenceAfter(lastEventId: string | undefined): number {
    if (!lastEventId) {
      return 0;
    }

    const event = this.events.find((candidate) => candidate.eventId === lastEventId);

    return event?.seq ?? 0;
  }

  async *iterate(
    afterSeq: number,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent, void, void> {
    let index = this.events.findIndex((event) => event.seq > afterSeq);

    if (index === -1) {
      index = this.events.length;
    }

    while (true) {
      while (index < this.events.length) {
        const event = this.events[index];
        index += 1;

        if (event) {
          yield event;
        }
      }

      if (this.finished || signal?.aborted) {
        return;
      }

      await this.waitForChange(signal);
    }
  }

  private waitForChange(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const wake = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", wake);
        resolve();
      };

      this.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }

  private notify(): void {
    for (const wake of this.waiters) {
      wake();
    }

    this.waiters.clear();
  }
}
