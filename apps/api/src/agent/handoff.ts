import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type { ReleaseScenario } from "../release/types.js";

export function createReleaseHandoffTool(scenarios: ReleaseScenario[]) {
  return tool(
    async ({ version, reason }: { version?: string; reason?: string }) => {
      const scenario = version
        ? scenarios.find(
            (candidate) =>
              candidate.version === version || candidate.id === version,
          )
        : scenarios[0];

      if (!scenario) {
        return `当前没有匹配的发版场景：${version ?? "(default)"}。请确认版本号。`;
      }

      return JSON.stringify({
        type: "release_handoff",
        scenarioId: scenario.id,
        title: scenario.title,
        service: scenario.service,
        version: scenario.version,
        reason: reason ?? "用户请求准备发版",
      });
    },
    {
      name: "prepare_release",
      description:
        "当用户要准备/开始一次发版时调用，返回 Release 工作台入口。普通知识问答不要调用。",
      schema: z.object({
        version: z
          .string()
          .optional()
          .describe("目标版本，例如 1.2.0"),
        reason: z.string().optional().describe("用户准备发版的原因"),
      }),
    },
  );
}
