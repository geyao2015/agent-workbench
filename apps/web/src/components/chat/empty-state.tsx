import { Sparkles } from "lucide-react";

import type { QuickPrompt } from "@/lib/chat/quick-prompts";

export function EmptyState({
  prompts,
  description,
  onPick,
}: {
  prompts: QuickPrompt[];
  description: string;
  onPick: (item: QuickPrompt) => void;
}) {
  const groups = [...new Set(prompts.map((item) => item.group))];

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm">
        <Sparkles className="size-6 text-muted-foreground" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">从一个工程问题开始</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      {groups.map((group) => (
        <div key={group} className="w-full space-y-2 text-left">
          <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground">
            {group}
          </p>
          <div className="grid w-full gap-3 sm:grid-cols-2">
            {prompts
              .filter((item) => item.group === group)
              .map((item) => (
                <button
                  key={item.kind === "run" ? item.label : `history:${item.label}`}
                  type="button"
                  onClick={() => onPick(item)}
                  className="rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:bg-accent"
                >
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
