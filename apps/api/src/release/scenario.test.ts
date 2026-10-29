import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildDiffArtifact, buildUnifiedDiff, resolveFiles } from "./diff.js";
import { loadReleaseScenarios } from "./scenario.js";

const releasesDir = fileURLToPath(
  new URL("../../../../data/releases", import.meta.url),
);

describe("release scenario", () => {
  const scenarios = loadReleaseScenarios(releasesDir);

  it("加载 1.2.0 场景与阶段", () => {
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.id).toBe("release-1.2.0");
    expect(scenarios[0]?.version).toBe("1.2.0");
    expect(scenarios[0]?.stages.map((stage) => stage.kind)).toContain(
      "diff_approval",
    );
    expect(scenarios[0]?.files).toHaveLength(2);
    expect(scenarios[0]?.rollback.targetTag).toBe("v1.1.3");
    expect(scenarios[0]?.rollback.stages.map((stage) => stage.kind)).toContain(
      "rollback_approval",
    );
  });

  it("确定性冲突解决选择 recommended", () => {
    const files = resolveFiles(scenarios[0]?.files ?? []);

    expect(files[0]?.hunks[0]?.resolved).toContain("5000");
    expect(files[1]?.hunks[0]?.resolved).toContain("throw new Error");
  });

  it("生成 unified diff 与 artifact 内容", () => {
    const files = scenarios[0]?.files ?? [];
    const unified = buildUnifiedDiff(files);
    const artifact = buildDiffArtifact(files);

    expect(unified).toContain("diff --git a/src/checkout/client.ts");
    expect(unified).toContain("-const requestTimeoutMs = 3000;");
    expect(unified).toContain("+const requestTimeoutMs = 5000;");
    expect(artifact.files).toHaveLength(2);
    expect(artifact.unified).toBe(unified);
  });
});
