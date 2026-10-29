import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type { KnowledgeBase, SearchHit } from "../kb/index.js";

function formatHits(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return `查询“${query}”没有命中任何文档片段。请改写查询词，或明确告知用户资料不足。`;
  }

  const sections = hits.map((hit, index) => {
    return [
      `[${index + 1}] sourceId=${hit.sourceId} | ${hit.locator} | score=${hit.score}`,
      hit.snippet,
    ].join("\n");
  });

  return [
    `查询“${query}”命中 ${hits.length} 段文档：`,
    ...sections,
    "需要完整上下文时可调用 get_doc(sourceId)。",
  ].join("\n\n");
}

export function createKbTools(kb: KnowledgeBase) {
  const searchKb = tool(
    async ({ query, k }: { query: string; k?: number }) => {
      return formatHits(query, kb.search(query, k ?? 4));
    },
    {
      name: "search_kb",
      description:
        "检索 checkout-service 工程知识库。返回相关文档片段、来源 ID 与标题位置。回答前应先调用。",
      schema: z.object({
        query: z.string().min(1).describe("检索关键词，可以是自然语言问题"),
        k: z.number().int().min(1).max(8).optional().describe("返回片段数，默认 4"),
      }),
    },
  );

  const getDoc = tool(
    async ({ sourceId }: { sourceId: string }) => {
      const doc = kb.get(sourceId);

      if (!doc) {
        return `未找到文档 ${sourceId}。请先用 search_kb 检索可用的 sourceId。`;
      }

      return [`sourceId=${doc.id} | ${doc.title}`, doc.content].join("\n\n");
    },
    {
      name: "get_doc",
      description: "按 sourceId 读取知识库文档全文，用于查看检索片段前后的完整上下文。",
      schema: z.object({
        sourceId: z.string().min(1).describe("search_kb 返回的 sourceId"),
      }),
    },
  );

  return [searchKb, getDoc];
}
