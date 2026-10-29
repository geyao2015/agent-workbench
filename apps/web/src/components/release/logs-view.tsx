import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface RcaBody {
  incidentId: string;
  version: string;
  rootCause: string;
  fix: string;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ file: string; line: number; text: string }>;
  runbook?: { sourceId: string; title: string; locator: string };
  generatedAt: string;
}

function parseRca(body: string | null): RcaBody | null {
  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as RcaBody;

    return Array.isArray(parsed.evidence) && typeof parsed.rootCause === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const CONFIDENCE_META = {
  high: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

function LogBlock({ body }: { body: string | null }) {
  if (!body) {
    return (
      <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        测试失败后会生成日志包。
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="border-b px-3 py-2.5">
        <p className="text-sm font-medium">测试日志</p>
        <p className="text-[11px] text-muted-foreground">
          模拟 CI 与 checkout-service 日志包
        </p>
      </header>
      <pre className="max-h-[45vh] overflow-auto bg-muted/20 px-0 py-2 font-mono text-[11px] leading-5">
        {body.split("\n").map((line, index) => (
          <div
            key={index}
            className={cn(
              "px-3 whitespace-pre-wrap break-all",
              line.includes(" ERROR ") && "bg-destructive/10 text-destructive",
              line.includes(" WARN ") &&
                "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              line.startsWith("=====") && "font-medium text-foreground",
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

export function LogsView({
  logBody,
  logLoading,
  rcaBody,
  rcaLoading,
}: {
  logBody: string | null;
  logLoading: boolean;
  rcaBody: string | null;
  rcaLoading: boolean;
}) {
  if (logLoading || rcaLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取日志与 RCA…
      </div>
    );
  }

  const rca = parseRca(rcaBody);

  return (
    <div className="space-y-3">
      {rca ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">
                根因分析 · {rca.incidentId}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {rca.version} · {rca.evidence.length} 条证据
              </p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                CONFIDENCE_META[rca.confidence],
              )}
            >
              置信度 {rca.confidence}
            </span>
          </header>

          <div className="space-y-3 p-3 text-xs leading-5">
            <div>
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                根因
              </p>
              <p className="mt-1">{rca.rootCause}</p>
            </div>

            <div>
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                修复建议
              </p>
              <p className="mt-1">{rca.fix}</p>
            </div>

            {rca.runbook ? (
              <div>
                <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                  关联 runbook
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {rca.runbook.sourceId} · {rca.runbook.locator}
                </p>
              </div>
            ) : null}

            <div>
              <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                证据
              </p>
              <div className="mt-1 space-y-1.5">
                {rca.evidence.map((item) => (
                  <div
                    key={`${item.file}:${item.line}`}
                    className="rounded-md bg-muted/30 px-2.5 py-2"
                  >
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {item.file}:{item.line}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-[11px]">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          测试失败后会自动执行日志检索与根因分析。
        </p>
      )}

      <LogBlock body={logBody} />
    </div>
  );
}
