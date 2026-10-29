import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeMode = "agent" | "mock";
export type ModelProvider = "anthropic" | "openai";
export type ConflictMode = "auto" | "llm" | "fixture";

export interface RuntimeConfig {
  mode: RuntimeMode;
  provider?: ModelProvider;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  conflictMode: ConflictMode;
  port: number;
  docsDir: string;
  releasesDir: string;
  storeDir: string;
}

export interface PublicRuntimeInfo {
  mode: RuntimeMode;
  provider?: ModelProvider;
  model?: string;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readMode(env: NodeJS.ProcessEnv): RuntimeMode | undefined {
  const value = env.RUNTIME_MODE?.trim();

  if (value === "mock" || value === "agent") {
    return value;
  }

  if (value) {
    throw new Error("RUNTIME_MODE 只能是 agent 或 mock。");
  }

  return undefined;
}

function readConflictMode(env: NodeJS.ProcessEnv): ConflictMode {
  const value = env.RELEASE_CONFLICT_MODE?.trim();

  if (value === "auto" || value === "llm" || value === "fixture") {
    return value;
  }

  if (value) {
    throw new Error("RELEASE_CONFLICT_MODE 只能是 auto、llm 或 fixture。");
  }

  return "auto";
}

function readProvider(env: NodeJS.ProcessEnv): ModelProvider | undefined {
  const value = env.MODEL_PROVIDER?.trim();

  if (value === "anthropic" || value === "openai") {
    return value;
  }

  if (value) {
    throw new Error("MODEL_PROVIDER 只能是 anthropic 或 openai。");
  }

  return undefined;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const requestedMode = readMode(env);
  const requestedProvider = readProvider(env);
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const provider: ModelProvider | undefined =
    requestedProvider ??
    (anthropicKey ? "anthropic" : openaiKey ? "openai" : undefined);
  const base = {
    conflictMode: readConflictMode(env),
    port: Number(env.PORT ?? 8787),
    docsDir: resolve(repoRoot, env.KB_DIR ?? "data/docs"),
    releasesDir: resolve(repoRoot, env.RELEASES_DIR ?? "data/releases"),
    storeDir: resolve(repoRoot, env.STORE_DIR ?? ".data"),
  };

  if (requestedMode === "mock") {
    return { mode: "mock", ...base };
  }

  if (!provider) {
    if (requestedMode === "agent") {
      throw new Error(
        "未找到模型配置：请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY，或显式使用 RUNTIME_MODE=mock。",
      );
    }

    return { mode: "mock", ...base };
  }

  if (provider === "anthropic") {
    if (!anthropicKey) {
      throw new Error("MODEL_PROVIDER=anthropic 需要 ANTHROPIC_API_KEY。");
    }

    return {
      mode: "agent",
      provider,
      apiKey: anthropicKey,
      model: env.ANTHROPIC_MODEL?.trim() ?? "claude-sonnet-4-6",
      baseURL: env.ANTHROPIC_BASE_URL?.trim(),
      ...base,
    };
  }

  if (!openaiKey) {
    throw new Error("MODEL_PROVIDER=openai 需要 OPENAI_API_KEY。");
  }

  return {
    mode: "agent",
    provider,
    apiKey: openaiKey,
    model: env.OPENAI_MODEL?.trim() ?? "gpt-4.1-mini",
    baseURL: env.OPENAI_BASE_URL?.trim(),
    ...base,
  };
}

export function publicRuntimeInfo(config: RuntimeConfig): PublicRuntimeInfo {
  if (config.mode === "mock") {
    return { mode: "mock" };
  }

  return {
    mode: "agent",
    provider: config.provider,
    model: config.model,
  };
}
