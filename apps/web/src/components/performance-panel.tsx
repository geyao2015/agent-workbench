import { useEffect, useState, useSyncExternalStore } from "react";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getRenderStats,
  recordFps,
  resetRenderStats,
  subscribeRenderStats,
} from "@/lib/render-stats";
import { useRuntimeMetrics } from "@/lib/runtime-metrics";

function useFps(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    let frames = 0;
    let last = performance.now();
    let raf = 0;

    const loop = (now: number) => {
      frames += 1;
      const elapsed = now - last;

      if (elapsed >= 500) {
        recordFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        last = now;
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [active]);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

function RuntimeMetrics() {
  const runtime = useRuntimeMetrics();

  return (
    <>
      <Metric
        label="内存（JS Heap）"
        value={
          runtime.memorySupported
            ? `${(runtime.memoryUsedMB ?? 0).toFixed(1)} / 峰值 ${(
                runtime.memoryPeakMB ?? 0
              ).toFixed(1)} MB`
            : "不支持"
        }
      />
      <Metric
        label="CPU（阻塞近似）"
        value={
          runtime.cpuSupported
            ? `${Math.round(runtime.blockingMs)}ms · ${runtime.blockingRatio.toFixed(1)}%`
            : "不支持"
        }
      />
      <Metric
        label="长帧"
        value={runtime.cpuSupported ? String(runtime.longFrames) : "—"}
      />
    </>
  );
}

export function PerformancePanel({
  active,
  totalBlocks,
  onClose,
}: {
  active: boolean;
  totalBlocks: number;
  onClose: () => void;
}) {
  const stats = useSyncExternalStore(subscribeRenderStats, getRenderStats);
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);

  useFps(active);

  return (
    <aside className="scroll-slim fixed right-4 bottom-4 z-40 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">渲染性能</p>
          <p className="text-xs text-muted-foreground">当前对话累计</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="关闭性能面板"
        >
          <X />
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="块渲染" value={String(stats.blockRenders)} />
        <Metric
          label="闭合块渲染"
          value={`${stats.closedBlockRenders} / ${stats.uniqueBlocks} 块`}
        />
        <Metric label="开放块渲染" value={String(stats.openBlockRenders)} />
        <Metric label="总块数" value={String(totalBlocks)} />
        <Metric label="文本增量" value={String(stats.textUpdates)} />
        <Metric
          label="首 token"
          value={stats.firstTokenMs === null ? "—" : `${stats.firstTokenMs}ms`}
        />
        <Metric
          label="帧率（最近）"
          value={
            stats.fps > 0 ? `${stats.fps}fps` : active ? "测量中…" : "—"
          }
        />
        <Metric label="最近提交" value={`${stats.lastCommitMs}ms`} />
        <Metric label="最大提交" value={`${stats.maxCommitMs}ms`} />
        <RuntimeMetrics key={runtimeEpoch} />
      </dl>

      <div className="mt-3 flex items-start justify-between gap-3">
        <p className="text-[10px] leading-4 text-muted-foreground">
          StrictMode 会重复计数；CPU 为浏览器可观测的主线程阻塞近似值，内存仅 Chrome/Edge 支持。
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetRenderStats();
            setRuntimeEpoch((value) => value + 1);
          }}
        >
          重置
        </Button>
      </div>
    </aside>
  );
}
