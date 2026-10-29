import { memo, Profiler, useEffect, useRef } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import { ChatRowView } from "@/components/chat/chat-row";
import type { ChatRow } from "@/lib/chat/chat-rows";
import { recordCommit } from "@/lib/render-stats";
import { cn } from "@/lib/utils";

function handleProfilerRender(
  _id: string,
  _phase: string,
  actualDuration: number,
) {
  recordCommit(actualDuration);
}

export const ChatFeed = memo(function ChatFeed({
  rows,
  version,
  followVersion,
  streaming,
  onResolveApproval,
  onStartRelease,
}: {
  rows: ChatRow[];
  version: number;
  followVersion: number;
  streaming: boolean;
  onResolveApproval: (
    runId: string,
    approvalId: string,
    approved: boolean,
  ) => void;
  onStartRelease: (runId: string, scenarioId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "tool"
        ? 140
        : rows[index]?.kind === "assistant-block"
          ? 72
          : 48,
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [followVersion]);

  useEffect(() => {
    if (!stickToBottomRef.current || rows.length === 0) {
      return;
    }

    autoScrollingRef.current = true;
    let frames = 0;
    let frameId = 0;

    const tick = () => {
      const element = scrollRef.current;

      if (!element || !stickToBottomRef.current) {
        autoScrollingRef.current = false;
        return;
      }

      lastScrollTopRef.current = element.scrollTop;
      element.scrollTop = element.scrollHeight;
      frames += 1;

      const distance =
        element.scrollHeight - element.scrollTop - element.clientHeight;

      if (frames < 60 && distance > 2) {
        frameId = requestAnimationFrame(tick);
      } else {
        lastScrollTopRef.current = element.scrollTop;
        autoScrollingRef.current = false;
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      autoScrollingRef.current = false;
    };
  }, [rows.length, version]);

  function handleScroll() {
    if (streaming || autoScrollingRef.current) {
      return;
    }

    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const current = element.scrollTop;
    const previous = lastScrollTopRef.current;
    lastScrollTopRef.current = current;

    if (current < previous - 2) {
      stickToBottomRef.current = false;
      return;
    }

    if (element.scrollHeight - current - element.clientHeight < 120) {
      stickToBottomRef.current = true;
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onWheel={() => {
        stickToBottomRef.current = false;
      }}
      onTouchMove={() => {
        stickToBottomRef.current = false;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
    >
      <Profiler id="chat-feed" onRender={handleProfilerRender}>
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];

            if (!row) {
              return null;
            }

            return (
              <div
                key={row.key}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div
                  className={cn(
                    "mx-auto w-full max-w-3xl px-4 md:px-8",
                    row.kind === "assistant-block" ? "py-1" : "py-2",
                    virtualItem.index === 0 && "pt-8",
                    virtualItem.index === rows.length - 1 && "pb-8",
                  )}
                >
                  <ChatRowView
                    row={row}
                    onResolveApproval={onResolveApproval}
                    onStartRelease={onStartRelease}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Profiler>
    </div>
  );
});
