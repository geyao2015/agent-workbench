import { useState } from "react";
import { Loader2, Server } from "lucide-react";

import { Button } from "@/components/ui/button";

interface HealthResponse {
  status: string;
  service: string;
  message: string;
  timestamp: string;
}

export default function App() {
  const [result, setResult] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function checkApi() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/health");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setResult((await response.json()) as HealthResponse);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "请求失败");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-xl space-y-6 rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            M0 · Mock runtime
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Agent Workbench</h1>
          <p className="text-sm text-muted-foreground">
            服务端骨架已就绪。点击按钮验证前端到 Hono 的链路。
          </p>
        </div>

        <Button onClick={checkApi} disabled={isLoading}>
          {isLoading ? <Loader2 className="animate-spin" /> : <Server />}
          {isLoading ? "请求中" : "调用 /api/health"}
        </Button>

        <div className="min-h-40 rounded-lg border border-dashed bg-background/60 p-4">
          {error ? (
            <p className="text-sm text-destructive">请求失败：{error}</p>
          ) : result ? (
            <pre className="overflow-x-auto text-xs leading-relaxed">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              尚未请求接口。开发模式下 Vite 会把 /api 代理到 Hono（8787）。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
