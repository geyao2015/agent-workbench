import type { ChatAgent } from "../agent/graph.js";
import {
  resolveModelConfig,
  type ModelConfig,
  type ModelProvider,
  type RuntimeConfig,
  type RuntimeMode,
  type RuntimeModelOption,
} from "../config.js";
import type { ConflictResolver } from "../release/conflict.js";

export interface RuntimeSelection {
  mode: RuntimeMode;
  modelId?: string;
  provider?: ModelProvider;
  model?: string;
  version: number;
}

export interface RuntimeModelInfo extends RuntimeModelOption {
  available: boolean;
}

export interface RuntimeInfo {
  mode: RuntimeMode;
  provider?: ModelProvider;
  model?: string;
  modelId?: string;
  version: number;
  agentAvailable: boolean;
  models: RuntimeModelInfo[];
}

export type RuntimeSwitchErrorCode =
  | "agent_unavailable"
  | "invalid_mode"
  | "unknown_model";

export class RuntimeSwitchError extends Error {
  constructor(
    readonly code: RuntimeSwitchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeSwitchError";
  }
}

export interface RuntimeControllerDeps {
  createAgent(model: ModelConfig): ChatAgent;
  createConflictResolver(model: ModelConfig | undefined): ConflictResolver;
}

export class RuntimeController {
  private mode: RuntimeMode;
  private modelId?: string;
  private version = 0;
  private readonly agents = new Map<string, ChatAgent>();
  private readonly resolvers = new Map<string, ConflictResolver>();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly deps: RuntimeControllerDeps,
  ) {
    this.mode = config.mode;
    this.modelId = config.defaultModelId;
  }

  agentAvailable(): boolean {
    return this.config.models.some(
      (option) => this.config.credentials[option.provider] !== undefined,
    );
  }

  info(): RuntimeInfo {
    const selection = this.snapshot();

    return {
      ...selection,
      ...(this.modelId ? { modelId: this.modelId } : {}),
      agentAvailable: this.agentAvailable(),
      models: this.config.models.map((option) => ({
        ...option,
        available: this.config.credentials[option.provider] !== undefined,
      })),
    };
  }

  snapshot(): RuntimeSelection {
    const model =
      this.mode === "agent"
        ? resolveModelConfig(this.config, this.modelId)
        : undefined;
    const selection: RuntimeSelection = { mode: this.mode, version: this.version };

    if (this.mode === "agent" && this.modelId) {
      selection.modelId = this.modelId;
    }

    if (model) {
      selection.provider = model.provider;
      selection.model = model.model;
    }

    return selection;
  }

  setSelection(input: { mode: string; modelId?: string }): RuntimeInfo {
    if (input.mode !== "mock" && input.mode !== "agent") {
      throw new RuntimeSwitchError(
        "invalid_mode",
        "模式只能是 mock 或 agent。",
      );
    }

    if (input.mode === "agent") {
      if (!this.agentAvailable()) {
        throw new RuntimeSwitchError(
          "agent_unavailable",
          "未配置模型 Key，无法切换到实时 Agent。",
        );
      }

      const modelId = input.modelId ?? this.modelId ?? this.firstAvailableModelId();

      if (!modelId || !resolveModelConfig(this.config, modelId)) {
        throw new RuntimeSwitchError(
          "unknown_model",
          `模型不可用：${input.modelId ?? "默认模型"}`,
        );
      }

      this.modelId = modelId;
    }

    this.mode = input.mode;
    this.version += 1;

    return this.info();
  }

  resolveAgent(selection: RuntimeSelection): ChatAgent {
    const model = resolveModelConfig(this.config, selection.modelId);

    if (!model) {
      throw new RuntimeSwitchError(
        "agent_unavailable",
        "模型配置缺失，无法创建 Agent。",
      );
    }

    const key = `${model.provider}:${model.model}:${model.baseURL ?? ""}`;
    const cached = this.agents.get(key);

    if (cached) {
      return cached;
    }

    const agent = this.deps.createAgent(model);
    this.agents.set(key, agent);

    return agent;
  }

  resolveConflictResolver(selection: RuntimeSelection): ConflictResolver {
    const model =
      selection.mode === "agent"
        ? resolveModelConfig(this.config, selection.modelId)
        : undefined;
    const key = model
      ? `${model.provider}:${model.model}:${model.baseURL ?? ""}:${this.config.conflictMode}`
      : "deterministic";
    const cached = this.resolvers.get(key);

    if (cached) {
      return cached;
    }

    const resolver = this.deps.createConflictResolver(model);
    this.resolvers.set(key, resolver);

    return resolver;
  }

  private firstAvailableModelId(): string | undefined {
    return this.config.models.find(
      (option) => this.config.credentials[option.provider] !== undefined,
    )?.id;
  }
}
