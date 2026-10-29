export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

interface PendingApproval {
  runId: string;
  resolve: (decision: ApprovalDecision | null) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ApprovalRegistry {
  private readonly pending = new Map<string, PendingApproval>();

  wait(
    approvalId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision | null> {
    if (signal?.aborted) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const onAbort = () => {
        this.settle(approvalId, null);
      };
      const entry: PendingApproval = { runId, resolve, signal, onAbort };

      this.pending.set(approvalId, entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    return this.settle(approvalId, decision);
  }

  clearRun(runId: string): void {
    for (const [approvalId, entry] of this.pending) {
      if (entry.runId === runId) {
        this.settle(approvalId, null);
      }
    }
  }

  private settle(
    approvalId: string,
    decision: ApprovalDecision | null,
  ): boolean {
    const entry = this.pending.get(approvalId);

    if (!entry) {
      return false;
    }

    this.pending.delete(approvalId);

    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }

    entry.resolve(decision);

    return true;
  }
}
