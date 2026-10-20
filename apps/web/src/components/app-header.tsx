import { Activity, Gauge, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  eventCount: number;
  hasConversation: boolean;
  onToggleInspector: () => void;
  onTogglePerformance: () => void;
  onReset: () => void;
}

export function AppHeader({
  eventCount,
  hasConversation,
  onToggleInspector,
  onTogglePerformance,
  onReset,
}: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">Agent Workbench</h1>
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
              Chat · M1
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            本地 fixture 回放 · 不调用模型
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={onToggleInspector}>
          <Activity />
          <span className="hidden sm:inline">事件</span>
          {eventCount}
        </Button>
        <Button variant="outline" size="sm" onClick={onTogglePerformance}>
          <Gauge />
          <span className="hidden sm:inline">性能</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!hasConversation}
        >
          <RotateCcw />
          <span className="hidden sm:inline">新对话</span>
        </Button>
      </div>
    </header>
  );
}
