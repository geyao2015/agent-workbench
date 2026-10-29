import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadReleaseScenarios } from "../release/scenario.js";
import { createReleaseHandoffTool } from "./handoff.js";

const scenarios = loadReleaseScenarios(
  fileURLToPath(new URL("../../../../data/releases", import.meta.url)),
);

describe("prepare_release", () => {
  it("返回可渲染的 Release handoff 结果", async () => {
    const tool = createReleaseHandoffTool(scenarios);
    const result = await tool.invoke({
      version: "1.2.0",
      reason: "准备发版",
    });
    const parsed = JSON.parse(String(result)) as {
      type: string;
      scenarioId: string;
      version: string;
    };

    expect(parsed.type).toBe("release_handoff");
    expect(parsed.scenarioId).toBe("release-1.2.0");
    expect(parsed.version).toBe("1.2.0");
  });

  it("未知版本返回提示而不是伪造 handoff", async () => {
    const tool = createReleaseHandoffTool(scenarios);
    const result = await tool.invoke({ version: "9.9.9" });

    expect(String(result)).toContain("没有匹配的发版场景");
  });
});
