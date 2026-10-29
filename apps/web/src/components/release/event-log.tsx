import type { AgentEvent } from "@agent-workbench/protocol";

function formatTime(ts: number): string {
  const time = new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });

  return `${time}.${String(ts % 1000).padStart(3, "0")}`;
}

export function ReleaseEventLog({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        尚无事件。运行中的事件会实时追加。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <article key={event.eventId} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                #{event.seq}
              </span>
              <time className="font-mono text-[10px] text-muted-foreground/80">
                {formatTime(event.ts)}
              </time>
            </div>
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              {event.type}
            </span>
          </div>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-muted-foreground">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </article>
      ))}
    </div>
  );
}
