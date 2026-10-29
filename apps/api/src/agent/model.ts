import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";

import type { RuntimeConfig } from "../config.js";

export function createChatModel(config: RuntimeConfig): BaseChatModel {
  if (config.provider === "anthropic") {
    return new ChatAnthropic({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.2,
      maxTokens: 4096,
      maxRetries: 2,
      ...(config.baseURL ? { anthropicApiUrl: config.baseURL } : {}),
    });
  }

  if (config.provider === "openai") {
    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.2,
      maxRetries: 2,
      ...(config.baseURL ? { configuration: { baseURL: config.baseURL } } : {}),
    });
  }

  throw new Error("agent 模式缺少模型配置");
}
