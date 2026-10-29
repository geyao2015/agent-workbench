import { Loader2, MessageSquare, Plus } from "lucide-react";

import type { ThreadSummary } from "@agent-workbench/protocol";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;

  if (diff < 60_000) {
    return "刚刚";
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }

  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }

  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export function ThreadSidebar({
  threads,
  activeThreadId,
  loading,
  onSelect,
  onNew,
}: {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  loading: boolean;
  onSelect: (threadId: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-background/70 md:flex">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="size-4 text-muted-foreground" />
          会话
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onNew} aria-label="新对话">
          <Plus />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            加载会话…
          </div>
        ) : threads.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
            还没有历史会话。发一个问题，会话会保存在这里。
          </p>
        ) : (
          <ul className="space-y-1">
            {threads.map((thread) => (
              <li key={thread.threadId}>
                <button
                  type="button"
                  onClick={() => onSelect(thread.threadId)}
                  className={cn(
                    "w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                    activeThreadId === thread.threadId && "bg-accent",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {thread.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(thread.updatedAt)}
                    </span>
                  </div>
                  {thread.preview ? (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {thread.preview}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {thread.messageCount} 条消息
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
