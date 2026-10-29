import { useEffect, useState } from "react";

import {
  ArrowRight,
  GitBranch,
  Loader2,
  Rocket,
  ShieldCheck,
} from "lucide-react";

import type { ThreadSummary } from "@agent-workbench/protocol";

import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/hash-router";
import {
  createReleaseRun,
  fetchReleaseScenarios,
  fetchReleaseThreads,
  type ReleaseScenarioSummary,
} from "@/transport/release";

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

export function ReleaseListView() {
  const [scenarios, setScenarios] = useState<ReleaseScenarioSummary[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      fetchReleaseScenarios(controller.signal),
      fetchReleaseThreads(controller.signal),
    ])
      .then(([nextScenarios, nextThreads]) => {
        if (controller.signal.aborted) {
          return;
        }

        setScenarios(nextScenarios);
        setThreads(nextThreads);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "加载发版工作台失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  async function startRelease(scenario: ReleaseScenarioSummary) {
    if (starting) {
      return;
    }

    setStarting(scenario.id);
    setError(null);

    try {
      const run = await createReleaseRun(scenario.id);

      navigate(`#/releases/${run.threadId}?run=${run.runId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "启动发版失败");
      setStarting(null);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/20">
      <AppHeader
        subtitle="模拟发版环境 · 确定性流程 + 人工审批"
        activeView="releases"
        onNavigate={(view) =>
          navigate(view === "chat" ? "#/chat" : "#/releases")
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 md:px-8">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                Release Workbench
              </h2>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                模拟环境
              </span>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              确定性阶段负责前置检查、测试与审计，冲突解决和 diff
              审批由有边界的 Agent 与人工共同完成。不执行真实 CI/CD。
            </p>
          </section>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <section className="space-y-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              可用场景
            </p>

            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载场景…
              </div>
            ) : scenarios.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
                没有可用的发版场景。
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {scenarios.map((scenario) => (
                  <article
                    key={scenario.id}
                    className="rounded-xl border bg-card p-4 shadow-xs"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                        <Rocket className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{scenario.title}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {scenario.service} · {scenario.version}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <GitBranch className="size-3" />
                        {scenario.branch}
                      </span>
                      <span>{scenario.stageCount} 个阶段</span>
                    </div>

                    <Button
                      className="mt-4 w-full"
                      size="sm"
                      onClick={() => void startRelease(scenario)}
                      disabled={starting !== null}
                    >
                      {starting === scenario.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldCheck />
                      )}
                      {starting === scenario.id ? "正在启动…" : "开始发版"}
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              发版历史
            </p>

            {threads.length === 0 ? (
              <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
                还没有发版记录。启动一个场景后会出现在这里。
              </p>
            ) : (
              <div className="space-y-2">
                {threads.map((thread) => (
                  <button
                    key={thread.threadId}
                    type="button"
                    onClick={() => navigate(`#/releases/${thread.threadId}`)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{thread.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {thread.runCount} 次 run · {relativeTime(thread.updatedAt)}
                      </p>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
