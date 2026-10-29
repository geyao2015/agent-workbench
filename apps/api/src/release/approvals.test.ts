import { describe, expect, it } from "vitest";

import { ApprovalRegistry } from "./approvals.js";

describe("ApprovalRegistry", () => {
  it("等待并解析审批", async () => {
    const registry = new ApprovalRegistry();
    const pending = registry.wait("ap_1", "run_1");

    expect(registry.resolve("ap_1", { approved: true, note: "同意" })).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, note: "同意" });
    expect(registry.resolve("ap_1", { approved: false })).toBe(false);
  });

  it("取消时返回 null", async () => {
    const registry = new ApprovalRegistry();
    const controller = new AbortController();
    const pending = registry.wait("ap_2", "run_2", controller.signal);

    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(registry.resolve("ap_2", { approved: true })).toBe(false);
  });

  it("可以清理某个 run 的 pending 审批", async () => {
    const registry = new ApprovalRegistry();
    const pending = registry.wait("ap_3", "run_3");

    registry.clearRun("run_3");

    await expect(pending).resolves.toBeNull();
  });
});
