import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface Rationale {
  path: string;
  hunkId: string;
  rationale: string;
}

interface ParsedDiff {
  unified: string;
  fileCount: number;
  mode?: "deterministic" | "llm" | "fallback";
  fallbackReason?: string;
  latencyMs?: number;
  rationales: Rationale[];
}

function parseDiff(body: string): ParsedDiff {
  try {
    const parsed = JSON.parse(body) as {
      unified?: unknown;
      files?: unknown;
      resolution?: {
        mode?: unknown;
        fallbackReason?: unknown;
        latencyMs?: unknown;
      };
    };

    if (typeof parsed.unified === "string") {
      const files = Array.isArray(parsed.files) ? parsed.files : [];
      const rationales = files.flatMap((file) => {
        const candidate = file as {
          path?: unknown;
          hunks?: unknown;
        };

        if (typeof candidate.path !== "string" || !Array.isArray(candidate.hunks)) {
          return [];
        }

        return candidate.hunks.flatMap((hunk) => {
          const item = hunk as {
            id?: unknown;
            rationale?: unknown;
          };

          return typeof item.id === "string" && typeof item.rationale === "string"
            ? [
                {
                  path: candidate.path as string,
                  hunkId: item.id,
                  rationale: item.rationale,
                },
              ]
            : [];
        });
      });
      const mode =
        parsed.resolution?.mode === "llm" ||
        parsed.resolution?.mode === "fallback" ||
        parsed.resolution?.mode === "deterministic"
          ? parsed.resolution.mode
          : undefined;

      return {
        unified: parsed.unified,
        fileCount: files.length,
        mode,
        ...(typeof parsed.resolution?.fallbackReason === "string"
          ? { fallbackReason: parsed.resolution.fallbackReason }
          : {}),
        ...(typeof parsed.resolution?.latencyMs === "number"
          ? { latencyMs: parsed.resolution.latencyMs }
          : {}),
        rationales,
      };
    }
  } catch {
    // 兼容纯文本 diff
  }

  return { unified: body, fileCount: 0, rationales: [] };
}

const MODE_META = {
  llm: {
    label: "LLM 解决",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  fallback: {
    label: "确定性回退",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  deterministic: {
    label: "确定性方案",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
} as const;

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

  const { unified, fileCount, mode, fallbackReason, latencyMs, rationales } =
    parseDiff(body);

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">冲突解决方案 diff</p>
            <p className="text-[11px] text-muted-foreground">
              模拟仓库 · {fileCount > 0 ? `${fileCount} 个文件` : "unified diff"}
              {latencyMs !== undefined ? ` · ${latencyMs}ms` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  MODE_META[mode].className,
                )}
                title={fallbackReason}
              >
                {MODE_META[mode].label}
              </span>
            ) : null}
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              需人工审批
            </span>
          </div>
        </header>

        {fallbackReason ? (
          <p className="border-b bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            已回退到确定性方案：{fallbackReason}
          </p>
        ) : null}

        <pre className="max-h-[55vh] overflow-auto bg-muted/20 px-0 py-2 font-mono text-[11px] leading-5">
          {unified.split("\n").map((line, index) => (
            <div
              key={index}
              className={cn(
                "px-3 whitespace-pre-wrap break-all",
                line.startsWith("+") &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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

      {rationales.length > 0 ? (
        <section className="rounded-xl border bg-card">
          <header className="border-b px-3 py-2.5 text-sm font-medium">
            解决依据
          </header>
          <div className="space-y-2 p-3">
            {rationales.map((item) => (
              <div
                key={`${item.path}:${item.hunkId}`}
                className="rounded-md bg-muted/30 px-2.5 py-2 text-xs"
              >
                <p className="font-mono text-[10px] text-muted-foreground">
                  {item.path} · {item.hunkId}
                </p>
                <p className="mt-1 leading-5 text-muted-foreground">
                  {item.rationale}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
