import type { RunKind } from "./events.js";
import type { RunState } from "./reducer.js";

export interface RunSnapshot extends Omit<RunState, "appliedEventIds"> {
  appliedEventIds: string[];
}

export interface ThreadSummary {
  threadId: string;
  kind: RunKind;
  title: string;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  messageCount: number;
  preview?: string;
}

export interface RunHistoryPage {
  threadId: string;
  runs: RunSnapshot[];
  nextCursor: string | null;
}

export function toRunSnapshot(state: RunState): RunSnapshot {
  return {
    ...state,
    appliedEventIds: [...state.appliedEventIds],
  };
}

export function fromRunSnapshot(snapshot: RunSnapshot): RunState {
  return {
    ...snapshot,
    appliedEventIds: new Set(snapshot.appliedEventIds),
  };
}
