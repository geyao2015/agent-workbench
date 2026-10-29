import { describe, expect, it } from "vitest";

import {
  findEvidence,
  formatLogHits,
  getLogContext,
  searchLogs,
} from "./logs.js";

const logs = {
  "checkout-service.log": [
    "INFO callback received order=ORD-1",
    "ERROR consumer treats payment_conflict as retryable",
    "WARN retry queue depth=60000",
  ].join("\n"),
  "ci-test1.log": [
    "expected: duplicate callback returns 200 duplicate=true",
    "received: 409 payment_conflict",
  ].join("\n"),
};

describe("logs", () => {
  it("按关键词检索并按命中数排序", () => {
    const hits = searchLogs(logs, "payment_conflict retryable", 5);

    expect(hits[0]?.text).toContain("treats payment_conflict as retryable");
  });

  it("按证据文本定位到文件与行号", () => {
    const evidence = findEvidence(logs, [
      "duplicate callback returns 200",
      "treats payment_conflict as retryable",
    ]);

    expect(evidence[0]).toMatchObject({ file: "ci-test1.log", line: 1 });
    expect(evidence[1]).toMatchObject({ file: "checkout-service.log", line: 2 });
  });

  it("缺失证据时报错", () => {
    expect(() => findEvidence(logs, ["not in logs"])).toThrow("找不到证据");
  });

  it("读取上下文与格式化输出", () => {
    const context = getLogContext(logs, "checkout-service.log", 2, 1);

    expect(context.map((hit) => hit.line)).toEqual([1, 2, 3]);
    expect(formatLogHits(context)).toContain("[checkout-service.log:2]");
  });
});
