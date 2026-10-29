import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { QuickPrompt } from "@/lib/chat/quick-prompts";
import { navigate } from "@/lib/hash-router";
import { SHOWCASE_HIGHLIGHTS } from "@/lib/showcase";

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

      <div className="w-full space-y-2 text-left">
        <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground">
          工程亮点
        </p>
        <div className="grid w-full gap-2 sm:grid-cols-2">
          {SHOWCASE_HIGHLIGHTS.map((highlight) => {
            const action = highlight.action;
            const promptItem =
              action?.type === "prompt"
                ? prompts.find((item) =>
                    item.kind === "history"
                      ? item.label === action.promptText
                      : item.prompt.includes(action.promptText),
                  )
                : undefined;

            return (
              <div
                key={highlight.label}
                className="flex flex-col rounded-xl border bg-card p-3 shadow-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{highlight.label}</p>
                  <span className="rounded-full border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {highlight.value}
                  </span>
                </div>
                <p className="mt-1 flex-1 text-[11px] leading-5 text-muted-foreground">
                  {highlight.detail}
                </p>
                {action?.type === "route" ? (
                  <Button
                    className="mt-2 w-full"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(action.path)}
                  >
                    打开 Releases
                  </Button>
                ) : promptItem ? (
                  <Button
                    className="mt-2 w-full"
                    variant="outline"
                    size="sm"
                    onClick={() => onPick(promptItem)}
                  >
                    试一下
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
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
