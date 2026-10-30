import { describe, expect, it, vi } from "vitest";

import type { ChatAgent } from "../agent/graph.js";
import { loadRuntimeConfig } from "../config.js";
import { DeterministicConflictResolver } from "../release/conflict.js";
import { RuntimeController, RuntimeSwitchError } from "./controller.js";

function makeController(env: NodeJS.ProcessEnv = {}) {
  const config = loadRuntimeConfig({
    OPENAI_API_KEY: "sk-test",
    OPENAI_MODEL: "glm-5.2",
    ...env,
  });
  const createAgent = vi.fn(
    () => ({}) as unknown as ChatAgent,
  );
  const controller = new RuntimeController(config, {
    createAgent,
    createConflictResolver: () => new DeterministicConflictResolver(),
  });

  return { controller, createAgent };
}

describe("RuntimeController", () => {
  it("默认 mock，Key 存在时 agent 可用但不会自动启用", () => {
    const { controller } = makeController();
    const info = controller.info();

    expect(info.mode).toBe("mock");
    expect(info.agentAvailable).toBe(true);
    expect(info.models[0]?.available).toBe(true);
    expect(info.version).toBe(0);
  });

  it("切换到 agent 后 version 递增并带模型信息", () => {
    const { controller } = makeController();
    const info = controller.setSelection({ mode: "agent" });
    const selection = controller.snapshot();

    expect(info.mode).toBe("agent");
    expect(selection).toMatchObject({
      mode: "agent",
      provider: "openai",
      model: "glm-5.2",
      version: 1,
    });
  });

  it("无 Key 切 agent 抛 agent_unavailable", () => {
    const { controller } = makeController({ OPENAI_API_KEY: "" });

    expect(controller.info().agentAvailable).toBe(false);
    expect(() => controller.setSelection({ mode: "agent" })).toThrowError(
      RuntimeSwitchError,
    );

    try {
      controller.setSelection({ mode: "agent" });
    } catch (cause) {
      expect((cause as RuntimeSwitchError).code).toBe("agent_unavailable");
    }
  });

  it("忽略非法模式与未知模型", () => {
    const { controller } = makeController();

    expect(() => controller.setSelection({ mode: "other" })).toThrowError(
      /mock 或 agent/,
    );
    expect(() =>
      controller.setSelection({ mode: "agent", modelId: "missing" }),
    ).toThrowError(/模型不可用/);
  });

  it("同一模型复用同一个 agent 实例", () => {
    const { controller, createAgent } = makeController();
    controller.setSelection({ mode: "agent" });
    const selection = controller.snapshot();

    const first = controller.resolveAgent(selection);
    const second = controller.resolveAgent(selection);

    expect(first).toBe(second);
    expect(createAgent).toHaveBeenCalledTimes(1);
  });

  it("mock 模式下冲突解决器为确定性实现", () => {
    const { controller } = makeController();
    const resolver = controller.resolveConflictResolver(controller.snapshot());

    expect(resolver).toBeInstanceOf(DeterministicConflictResolver);
  });
});
