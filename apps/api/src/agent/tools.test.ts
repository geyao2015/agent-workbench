import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KnowledgeBase } from "../kb/index.js";
import { createKbTools } from "./tools.js";

const kb = KnowledgeBase.load(
  fileURLToPath(new URL("../../../../data/docs", import.meta.url)),
);

describe("createKbTools", () => {
  it("将检索结果标记为不可信数据", async () => {
    const search = createKbTools(kb).find((item) => item.name === "search_kb");

    if (!search) {
      throw new Error("search_kb 未注册");
    }

    const output = await search.invoke({ query: "1.2.0 发版" });

    expect(String(output)).toContain("不可信数据");
    expect(String(output)).toContain("<<<KB_DATA");
    expect(String(output)).toContain("KB_DATA>>>");
  });
});
