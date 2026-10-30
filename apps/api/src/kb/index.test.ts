import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KnowledgeBase, tokenize } from "./index.js";

const docsDir = fileURLToPath(new URL("../../../../data/docs", import.meta.url));
const kb = KnowledgeBase.load(docsDir);

describe("KnowledgeBase", () => {
  it("按中文与版本号检索 1.2.0 发版清单", () => {
    const hits = kb.search("1.2.0 发版有哪些注意事项", 4);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.sourceId).toBe("release-1-2-0-checklist");
  });

  it("按事故编号检索 INC-042 复盘", () => {
    const hits = kb.search("INC-042 支付回调为什么一直重试", 4);

    expect(hits[0]?.sourceId).toBe("incident-042-payment-callback");
  });

  it("检索服务架构文档", () => {
    const hits = kb.search("checkout-service 的架构是怎样的", 4);

    expect(hits[0]?.sourceId).toBe("checkout-service-architecture");
  });

  it("检索前端组件库的 Button 文档", () => {
    const hits = kb.search("前端组件库 Button 按钮组件怎么用", 4);

    expect(hits[0]?.sourceId).toBe("frontend-button");
  });

  it("无命中时返回空数组", () => {
    expect(kb.search("量子纠缠 火星殖民", 4)).toEqual([]);
  });

  it("可以按 id 读取全文", () => {
    const doc = kb.get("release-runbook");

    expect(doc?.title).toBe("发版 Runbook");
    expect(doc?.content).toContain("灰度");
  });

  it("中文按 bigram、英文按词切分", () => {
    expect(tokenize("支付回调")).toEqual(["支付", "付回", "回调"]);
    expect(tokenize("INC-042 checkout-service")).toEqual([
      "inc-042",
      "checkout-service",
    ]);
  });

  it("按 metadata 过滤服务与文档类型", () => {
    expect(kb.get("incident-051-inventory-lock")?.metadata?.service).toBe(
      "inventory-service",
    );

    const inventory = kb.search("库存锁超时 根因", 4, {
      service: "inventory-service",
    });
    expect(inventory[0]?.sourceId).toBe("incident-051-inventory-lock");

    const checkoutOnly = kb.search("支付回调", 4, {
      service: "inventory-service",
    });
    expect(
      checkoutOnly.every((hit) => hit.sourceId === "incident-051-inventory-lock"),
    ).toBe(true);

    const incidents = kb.search("回调 幂等", 4, { type: "incident" });
    expect(incidents.every((hit) => hit.sourceId.includes("incident"))).toBe(
      true,
    );
  });
});
