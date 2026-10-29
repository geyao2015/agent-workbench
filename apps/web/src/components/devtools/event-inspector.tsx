import type { AgentEvent, RunState } from "@agent-workbench/protocol";

import { SidePanel } from "@/components/devtools/side-panel";

function formatTime(ts: number): string {
  const time = new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
  return `${time}.${String(ts % 1000).padStart(3, "0")}`;
}

interface EventInspectorProps {
  events: AgentEvent[];
  state: RunState | null;
  onClose: () => void;
}

export function EventInspector({ events, state, onClose }: EventInspectorProps) {
  return (
    <SidePanel
      title="事件检查器"
      subtitle={`${events.length} 个事件 · lastSeq ${state?.lastSeq ?? 0} · ${state?.status ?? "idle"}`}
      onClose={onClose}
    >
      <div className="space-y-2">
        {events.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">尚无事件。</p>
        ) : (
          events.map((event) => (
            <article key={event.eventId} className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    #{event.seq}
                  </span>
                  <span
                    className="font-mono text-[10px] text-muted-foreground/70"
                    title={event.runId}
                  >
                    {event.runId.slice(-6)}
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
          ))
        )}
      </div>
    </SidePanel>
  );
}
