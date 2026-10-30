import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RuntimeMode = "agent" | "mock";
export type ModelProvider = "anthropic" | "openai";
export type ConflictMode = "auto" | "llm" | "fixture";

export interface RuntimeModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  model: string;
}

export interface ModelCredentials {
  apiKey: string;
  baseURL?: string;
}

export interface RuntimeConfig {
  /** 启动默认模式；页面可全局切换。 */
  mode: RuntimeMode;
  models: RuntimeModelOption[];
  defaultModelId?: string;
  credentials: Partial<Record<ModelProvider, ModelCredentials>>;
  conflictMode: ConflictMode;
  port: number;
  docsDir: string;
  releasesDir: string;
  storeDir: string;
}

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1-mini",
};

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

function readModelCatalog(env: NodeJS.ProcessEnv): RuntimeModelOption[] {
  const raw = env.MODEL_CATALOG?.trim();

  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MODEL_CATALOG 必须是 JSON 数组。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("MODEL_CATALOG 必须是 JSON 数组。");
  }

  return parsed.map((entry): RuntimeModelOption => {
    if (!entry || typeof entry !== "object") {
      throw new Error("MODEL_CATALOG 的条目必须是对象。");
    }

    const record = entry as Record<string, unknown>;
    const provider = record.provider ?? "openai";
    const model = record.model;

    if (provider !== "anthropic" && provider !== "openai") {
      throw new Error("MODEL_CATALOG 的 provider 只能是 anthropic 或 openai。");
    }

    if (typeof model !== "string" || model.length === 0) {
      throw new Error("MODEL_CATALOG 的条目必须包含 model。");
    }

    const id =
      typeof record.id === "string" && record.id.length > 0
        ? record.id
        : `${provider}:${model}`;
    const label =
      typeof record.label === "string" && record.label.length > 0
        ? record.label
        : model;

    return { id, label, provider, model };
  });
}

function readCredentials(env: NodeJS.ProcessEnv): Partial<Record<ModelProvider, ModelCredentials>> {
  const credentials: Partial<Record<ModelProvider, ModelCredentials>> = {};
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();

  if (anthropicKey) {
    credentials.anthropic = {
      apiKey: anthropicKey,
      ...(env.ANTHROPIC_BASE_URL?.trim()
        ? { baseURL: env.ANTHROPIC_BASE_URL.trim() }
        : {}),
    };
  }

  if (openaiKey) {
    credentials.openai = {
      apiKey: openaiKey,
      ...(env.OPENAI_BASE_URL?.trim() ? { baseURL: env.OPENAI_BASE_URL.trim() } : {}),
    };
  }

  return credentials;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const requestedMode = readMode(env);
  const requestedProvider = readProvider(env);
  const credentials = readCredentials(env);
  const provider: ModelProvider | undefined =
    requestedProvider ??
    (credentials.anthropic ? "anthropic" : credentials.openai ? "openai" : undefined);
  const catalog = readModelCatalog(env);
  const providerModel = provider
    ? (env[provider === "anthropic" ? "ANTHROPIC_MODEL" : "OPENAI_MODEL"]?.trim() ??
      DEFAULT_MODELS[provider])
    : undefined;
  const models: RuntimeModelOption[] =
    catalog.length > 0
      ? catalog
      : provider && providerModel
        ? [
            {
              id: `${provider}:${providerModel}`,
              label: providerModel,
              provider,
              model: providerModel,
            },
          ]
        : [];
  const requestedModelId = env.MODEL_ID?.trim();
  const defaultModelId = requestedModelId ?? models[0]?.id;
  const config: RuntimeConfig = {
    mode: requestedMode ?? "mock",
    models,
    ...(defaultModelId ? { defaultModelId } : {}),
    credentials,
    conflictMode: readConflictMode(env),
    port: Number(env.PORT ?? 8787),
    docsDir: resolve(repoRoot, env.KB_DIR ?? "data/docs"),
    releasesDir: resolve(repoRoot, env.RELEASES_DIR ?? "data/releases"),
    storeDir: resolve(repoRoot, env.STORE_DIR ?? ".data"),
  };

  if (config.mode === "agent" && !resolveModelConfig(config)) {
    throw new Error(
      "未找到可用的模型配置：请设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY，或选择 mock 模式。",
    );
  }

  return config;
}

export function resolveModelConfig(
  config: RuntimeConfig,
  modelId?: string,
): ModelConfig | undefined {
  const option = config.models.find(
    (candidate) => candidate.id === (modelId ?? config.defaultModelId),
  );

  if (!option) {
    return undefined;
  }

  const credentials = config.credentials[option.provider];

  if (!credentials) {
    return undefined;
  }

  return {
    provider: option.provider,
    model: option.model,
    apiKey: credentials.apiKey,
    ...(credentials.baseURL ? { baseURL: credentials.baseURL } : {}),
  };
}
