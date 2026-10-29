import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

function parseDiff(body: string): { unified: string; fileCount: number } {
  try {
    const parsed = JSON.parse(body) as {
      unified?: unknown;
      files?: unknown;
    };

    if (typeof parsed.unified === "string") {
      return {
        unified: parsed.unified,
        fileCount: Array.isArray(parsed.files) ? parsed.files.length : 0,
      };
    }
  } catch {
    // 兼容纯文本 diff
  }

  return { unified: body, fileCount: 0 };
}

export function DiffViewer({
  body,
  loading,
}: {
  body: string | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取 diff…
      </div>
    );
  }

  if (!body) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        冲突阶段完成后会生成 diff。
      </p>
    );
  }

  const { unified, fileCount } = parseDiff(body);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center justify-between border-b px-3 py-2.5">
        <div>
          <p className="text-sm font-medium">冲突解决方案 diff</p>
          <p className="text-[11px] text-muted-foreground">
            模拟仓库 · {fileCount > 0 ? `${fileCount} 个文件` : "unified diff"}
          </p>
        </div>
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
          需人工审批
        </span>
      </header>

      <pre className="max-h-[60vh] overflow-auto bg-muted/20 px-0 py-2 font-mono text-[11px] leading-5">
        {unified.split("\n").map((line, index) => (
          <div
            key={index}
            className={cn(
              "px-3 whitespace-pre-wrap break-all",
              line.startsWith("+") && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              line.startsWith("-") && "bg-destructive/10 text-destructive",
              line.startsWith("@@") && "text-sky-700 dark:text-sky-300",
              line.startsWith("diff --git") && "font-medium text-foreground",
              !line && "h-2",
            )}
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </section>
  );
}
