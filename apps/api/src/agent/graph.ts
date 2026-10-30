import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";

import type { ModelConfig } from "../config.js";
import type { KnowledgeBase } from "../kb/index.js";
import type { ReleaseScenario } from "../release/types.js";
import { createReleaseHandoffTool } from "./handoff.js";
import { createChatModel } from "./model.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { createKbTools } from "./tools.js";

export function createChatAgent(
  config: ModelConfig,
  kb: KnowledgeBase,
  releaseScenarios: ReleaseScenario[],
) {
  const model = createChatModel(config);
  const tools = [
    ...createKbTools(kb),
    createReleaseHandoffTool(releaseScenarios),
  ];

  if (!model.bindTools) {
    throw new Error(`模型 ${config.model} 不支持工具调用`);
  }

  const modelWithTools = model.bindTools(tools);

  const callModel = async (
    state: typeof MessagesAnnotation.State,
    runConfig: RunnableConfig,
  ) => {
    const response = await modelWithTools.invoke(
      [new SystemMessage(SYSTEM_PROMPT), ...state.messages],
      runConfig,
    );

    return { messages: [response] };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition)
    .addEdge("tools", "agent");

  const graph = workflow.compile({ checkpointer: new MemorySaver() });

  return {
    graph,
    userMessage(text: string) {
      return new HumanMessage(text);
    },
    async hasCheckpoint(threadId: string): Promise<boolean> {
      const state = await graph.getState({ configurable: { thread_id: threadId } });
      const messages = (state.values as { messages?: unknown[] } | undefined)
        ?.messages;

      return Array.isArray(messages) && messages.length > 0;
    },
  };
}

export type ChatAgent = ReturnType<typeof createChatAgent>;
