import { describe, expect, it } from "vitest";

import { evaluateAnswer, isRefusal, type AnswerCase } from "./answer.js";

const cases: AnswerCase[] = [
  {
    id: "a1",
    query: "发版注意事项",
    goldSourceIds: ["checklist"],
    goldPoints: ["迁移", "灰度"],
    answerable: true,
  },
  {
    id: "a2",
    query: "Redis 密码",
    goldSourceIds: [],
    goldPoints: [],
    answerable: false,
  },
];

describe("answer evaluation", () => {
  it("计算引用、要点覆盖与拒答准确性", () => {
    const metrics = evaluateAnswer(cases, {
      a1: {
        answer: "需要先做迁移，再灰度发布。",
        citations: ["checklist", "extra"],
        tools: ["search_kb"],
      },
      a2: {
        answer: "资料不足，无法提供密码。",
        citations: [],
        tools: ["search_kb"],
      },
    });

    expect(metrics.citationRecall).toBe(1);
    expect(metrics.citationPrecision).toBe(0.5);
    expect(metrics.keyPointCoverage).toBe(1);
    expect(metrics.refusalAccuracy).toBe(1);
    expect(metrics.failures).toEqual([]);
  });

  it("识别拒答与错误行为", () => {
    expect(isRefusal("资料不足，无法回答")).toBe(true);
    expect(isRefusal("需要先迁移")).toBe(false);

    const metrics = evaluateAnswer(cases, {
      a1: {
        answer: "无法回答",
        citations: [],
        tools: [],
      },
      a2: {
        answer: "密码是 123456",
        citations: [],
        tools: [],
      },
    });

    expect(metrics.refusalAccuracy).toBe(0);
    expect(metrics.failures.length).toBeGreaterThan(0);
  });
});
