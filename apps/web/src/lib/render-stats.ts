export interface RenderStatsSnapshot {
  blockRenders: number;
  closedBlockRenders: number;
  openBlockRenders: number;
  uniqueBlocks: number;
  textUpdates: number;
  firstTokenMs: number | null;
  fps: number;
  commitCount: number;
  lastCommitMs: number;
  maxCommitMs: number;
}

const emptyStats = (): RenderStatsSnapshot => ({
  blockRenders: 0,
  closedBlockRenders: 0,
  openBlockRenders: 0,
  uniqueBlocks: 0,
  textUpdates: 0,
  firstTokenMs: null,
  fps: 0,
  commitCount: 0,
  lastCommitMs: 0,
  maxCommitMs: 0,
});

let snapshot = emptyStats();
const renderedBlockIds = new Set<string>();
const listeners = new Set<() => void>();
let notifyTimer: number | null = null;

function notify() {
  if (notifyTimer !== null) {
    return;
  }

  notifyTimer = window.setTimeout(() => {
    notifyTimer = null;

    for (const listener of listeners) {
      listener();
    }
  }, 100);
}

function update(patch: Partial<RenderStatsSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  notify();
}

export function recordBlockRender(blockId: string, closed: boolean) {
  renderedBlockIds.add(blockId);
  update({
    blockRenders: snapshot.blockRenders + 1,
    closedBlockRenders: snapshot.closedBlockRenders + (closed ? 1 : 0),
    openBlockRenders: snapshot.openBlockRenders + (closed ? 0 : 1),
    uniqueBlocks: renderedBlockIds.size,
  });
}

export function recordTextUpdate() {
  update({ textUpdates: snapshot.textUpdates + 1 });
}

export function recordFirstToken(ms: number) {
  update({ firstTokenMs: Math.round(ms) });
}

export function recordFps(fps: number) {
  update({ fps });
}

export function recordCommit(durationMs: number) {
  const rounded = Math.round(durationMs * 10) / 10;

  update({
    commitCount: snapshot.commitCount + 1,
    lastCommitMs: rounded,
    maxCommitMs: Math.max(snapshot.maxCommitMs, rounded),
  });
}

export function resetRenderStats() {
  snapshot = emptyStats();
  renderedBlockIds.clear();
  notify();
}

export function subscribeRenderStats(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getRenderStats(): RenderStatsSnapshot {
  return snapshot;
}
