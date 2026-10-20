import { describe, expect, it } from "vitest";

import { segmentMarkdownBlocks } from "../blocks";

const messageId = "msg_test";

describe("segmentMarkdownBlocks", () => {
  it("keeps a streaming paragraph open", () => {
    const blocks = segmentMarkdownBlocks(messageId, "hello");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: "msg_test:b0",
      index: 0,
      kind: "paragraph",
      raw: "hello",
      status: "open",
    });
  });

  it("keeps a single trailing newline on the open block", () => {
    const blocks = segmentMarkdownBlocks(messageId, "hello\n");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.status).toBe("open");
    expect(blocks[0]?.raw).toBe("hello\n");
  });

  it("closes blocks separated by blank lines", () => {
    const blocks = segmentMarkdownBlocks(messageId, "first\n\nsecond");

    expect(blocks.map((block) => block.status)).toEqual(["closed", "open"]);
    expect(blocks.map((block) => block.raw)).toEqual(["first", "second"]);
  });

  it("closes the final block when text ends with a blank line", () => {
    const blocks = segmentMarkdownBlocks(messageId, "first\n\n");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.status).toBe("closed");
  });

  it("splits headings into their own closed block", () => {
    const blocks = segmentMarkdownBlocks(messageId, "## Title\n\nbody");

    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
    expect(blocks.map((block) => block.status)).toEqual(["closed", "open"]);
    expect(blocks[0]?.raw).toBe("## Title");
  });

  it("keeps lists as a single block", () => {
    const blocks = segmentMarkdownBlocks(messageId, "- one\n- two\n- three");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("list");
    expect(blocks[0]?.raw).toBe("- one\n- two\n- three");
  });

  it("does not split inside fenced code", () => {
    const blocks = segmentMarkdownBlocks(
      messageId,
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.status).toBe("closed");
    expect(blocks[0]?.raw).toContain("const b = 2;");
  });

  it("keeps an unclosed fence open", () => {
    const blocks = segmentMarkdownBlocks(messageId, "```ts\nconst a = 1;");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("code");
    expect(blocks[0]?.status).toBe("open");
  });

  it("detects tables and blockquotes", () => {
    const blocks = segmentMarkdownBlocks(
      messageId,
      "| a | b |\n| - | - |\n\n> quote",
    );

    expect(blocks.map((block) => block.kind)).toEqual(["table", "blockquote"]);
    expect(blocks[0]?.status).toBe("closed");
    expect(blocks[1]?.status).toBe("open");
  });

  it("offsets ids and indexes for incremental tails", () => {
    const blocks = segmentMarkdownBlocks(messageId, "a\n\nb", 3);

    expect(blocks.map((block) => block.id)).toEqual([
      "msg_test:b3",
      "msg_test:b4",
    ]);
    expect(blocks.map((block) => block.index)).toEqual([3, 4]);
  });

  it("keeps closed block ids and raw text stable as text grows", () => {
    const prefix = segmentMarkdownBlocks(messageId, "## Title\n\nhello");
    const next = segmentMarkdownBlocks(messageId, "## Title\n\nhello world");
    const separated = segmentMarkdownBlocks(
      messageId,
      "## Title\n\nhello world\n\nnext",
    );

    expect(next[0]).toEqual(prefix[0]);
    expect(separated[0]).toEqual(prefix[0]);
    expect(separated[1]?.raw).toBe("hello world");
    expect(separated[1]?.status).toBe("closed");
    expect(separated[2]?.raw).toBe("next");
  });
});
