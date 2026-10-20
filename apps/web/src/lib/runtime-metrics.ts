import { useEffect, useState } from "react";

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  blockingDuration?: number;
}

export interface RuntimeMetrics {
  memorySupported: boolean;
  memoryUsedMB: number | null;
  memoryPeakMB: number | null;
  cpuSupported: boolean;
  blockingMs: number;
  blockingRatio: number;
  longFrames: number;
}

const initialMetrics: RuntimeMetrics = {
  memorySupported: false,
  memoryUsedMB: null,
  memoryPeakMB: null,
  cpuSupported: false,
  blockingMs: 0,
  blockingRatio: 0,
  longFrames: 0,
};

function readMemory(): PerformanceMemory | undefined {
  return (performance as Performance & { memory?: PerformanceMemory }).memory;
}

export function useRuntimeMetrics(): RuntimeMetrics {
  const [metrics, setMetrics] = useState<RuntimeMetrics>(initialMetrics);

  useEffect(() => {
    const startedAt = performance.now();
    const memorySupported = readMemory() !== undefined;
    const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
    const usesLoaf = supportedEntryTypes.includes("long-animation-frame");
    const usesLongTask = !usesLoaf && supportedEntryTypes.includes("longtask");

    let blockingMs = 0;
    let longFrames = 0;
    let memoryUsed = 0;
    let memoryPeak = 0;
    let observer: PerformanceObserver | null = null;
    let disposed = false;

    const emit = () => {
      if (disposed) {
        return;
      }

      const elapsed = performance.now() - startedAt;

      setMetrics({
        memorySupported,
        memoryUsedMB: memorySupported ? memoryUsed / 1024 / 1024 : null,
        memoryPeakMB: memorySupported ? memoryPeak / 1024 / 1024 : null,
        cpuSupported: usesLoaf || usesLongTask,
        blockingMs,
        blockingRatio:
          elapsed > 0 && (usesLoaf || usesLongTask)
            ? (blockingMs / elapsed) * 100
            : 0,
        longFrames,
      });
    };

    const handleEntries = (list: PerformanceObserverEntryList) => {
      for (const entry of list.getEntries()) {
        const blocking =
          (entry as LongAnimationFrameEntry).blockingDuration ??
          Math.max(0, entry.duration - 50);

        blockingMs += blocking;

        if (blocking > 0) {
          longFrames += 1;
        }
      }

      emit();
    };

    try {
      if (usesLoaf) {
        observer = new PerformanceObserver(handleEntries);
        observer.observe({ type: "long-animation-frame", buffered: true });
      } else if (usesLongTask) {
        observer = new PerformanceObserver(handleEntries);
        observer.observe({ type: "longtask", buffered: true });
      }
    } catch {
      observer = null;
    }

    const sampleMemory = () => {
      const memory = readMemory();

      if (memory) {
        memoryUsed = memory.usedJSHeapSize;
        memoryPeak = Math.max(memoryPeak, memoryUsed);
      }

      emit();
    };

    sampleMemory();
    const timer = window.setInterval(sampleMemory, 1000);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return metrics;
}
