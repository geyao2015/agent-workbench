import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "./config.js";

describe("loadRuntimeConfig", () => {
  it("未设置 RUNTIME_MODE 时默认 mock，即使配置了 Key", () => {
    const config = loadRuntimeConfig({ OPENAI_API_KEY: "sk-test" });

    expect(config.mode).toBe("mock");
    expect(config.models[0]?.provider).toBe("openai");
    expect(config.credentials.openai?.apiKey).toBe("sk-test");
  });

  it("RUNTIME_MODE=agent 且无 Key 时报错", () => {
    expect(() => loadRuntimeConfig({ RUNTIME_MODE: "agent" })).toThrow(
      /模型配置/,
    );
  });

  it("MODEL_CATALOG 解析为模型列表，默认取第一项", () => {
    const config = loadRuntimeConfig({
      OPENAI_API_KEY: "sk-test",
      MODEL_CATALOG: JSON.stringify([
        { id: "fast", label: "Fast", provider: "openai", model: "glm-4-flash" },
        { id: "smart", provider: "openai", model: "glm-5.2" },
      ]),
    });

    expect(config.models).toHaveLength(2);
    expect(config.defaultModelId).toBe("fast");
    expect(config.models[1]).toEqual({
      id: "smart",
      label: "glm-5.2",
      provider: "openai",
      model: "glm-5.2",
    });
  });

  it("非法 MODEL_CATALOG 报错", () => {
    expect(() =>
      loadRuntimeConfig({ MODEL_CATALOG: "not-json" }),
    ).toThrow(/MODEL_CATALOG/);
    expect(() =>
      loadRuntimeConfig({ MODEL_CATALOG: JSON.stringify([{ provider: "openai" }]) }),
    ).toThrow(/model/);
  });
});
