import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { RuntimeConfig } from "../config.js";
import {
  createConflictResolver,
  DeterministicConflictResolver,
  LlmConflictResolver,
  mergeResolution,
  withFallback,
  type LlmResolution,
} from "./conflict.js";
import { loadReleaseScenarios } from "./scenario.js";

const releasesDir = fileURLToPath(
  new URL("../../../../data/releases", import.meta.url),
);
const scenario = loadReleaseScenarios(releasesDir)[0];

if (!scenario) {
  throw new Error("缺少 release 场景");
}

function validOutput(): LlmResolution {
  return {
    files: scenario.files.map((file) => ({
      path: file.path,
      hunks: file.hunks.map((hunk) => ({
        id: hunk.id,
        resolved: hunk.recommended,
        rationale: `LLM 选择 ${hunk.id}`,
      })),
    })),
  };
}

describe("conflict resolution", () => {
  it("确定性方案使用 recommended", async () => {
    const result = await new DeterministicConflictResolver().resolve({
      scenario,
      signal: new AbortController().signal,
    });

    expect(result.mode).toBe("deterministic");
    expect(result.files[0]?.hunks[0]?.resolved).toBe(
      scenario.files[0]?.hunks[0]?.recommended,
    );
  });

  it("合并 LLM 输出并保留 rationale", async () => {
    const files = mergeResolution(scenario.files, validOutput());

    expect(files[0]?.hunks[0]?.rationale).toContain("LLM 选择");
  });

  it("缺少文件或 hunk 时拒绝 LLM 输出", () => {
    const output = validOutput();
    output.files = output.files.slice(1);

    expect(() => mergeResolution(scenario.files, output)).toThrow("缺少文件");

    const missingHunk = validOutput();
    missingHunk.files[0]!.hunks = [];

    expect(() => mergeResolution(scenario.files, missingHunk)).toThrow(
      "缺少 hunk",
    );
  });

  it("LLM 解析器返回结构化结果", async () => {
    const resolver = new LlmConflictResolver(async () => validOutput());
    const result = await resolver.resolve({
      scenario,
      signal: new AbortController().signal,
    });

    expect(result.mode).toBe("llm");
    expect(result.files[0]?.hunks[0]?.rationale).toContain("LLM 选择");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("LLM 失败或输出非法时回退到确定性方案", async () => {
    const throwing = withFallback(
      new LlmConflictResolver(async () => {
        throw new Error("timeout");
      }),
      new DeterministicConflictResolver(),
    );
    const invalid = withFallback(
      new LlmConflictResolver(async () => ({ files: [] })),
      new DeterministicConflictResolver(),
    );

    const thrown = await throwing.resolve({
      scenario,
      signal: new AbortController().signal,
    });
    const invalidResult = await invalid.resolve({
      scenario,
      signal: new AbortController().signal,
    });

    expect(thrown.mode).toBe("fallback");
    expect(thrown.fallbackReason).toContain("timeout");
    expect(thrown.files[0]?.hunks[0]?.resolved).toBe(
      scenario.files[0]?.hunks[0]?.recommended,
    );
    expect(invalidResult.mode).toBe("fallback");
    expect(invalidResult.fallbackReason).toContain("缺少文件");
  });

  it("mock 模式固定使用确定性方案", () => {
    const config: RuntimeConfig = {
      mode: "mock",
      conflictMode: "auto",
      port: 0,
      docsDir: "",
      releasesDir: "",
      storeDir: "",
    };

    expect(createConflictResolver(config)).toBeInstanceOf(
      DeterministicConflictResolver,
    );
  });
});
