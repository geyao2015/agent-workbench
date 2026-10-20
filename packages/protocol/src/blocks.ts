export type BlockKind =
  | "paragraph"
  | "heading"
  | "list"
  | "code"
  | "table"
  | "blockquote";

export interface MarkdownSegment {
  id: string;
  index: number;
  kind: BlockKind;
  raw: string;
  status: "open" | "closed";
}

const FENCE_PATTERN = /^\s*(```|~~~)/;

function detectKind(line: string): BlockKind {
  if (/^\s*#{1,6}\s+/.test(line)) {
    return "heading";
  }

  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
    return "list";
  }

  if (/^\s*\|/.test(line)) {
    return "table";
  }

  if (/^\s*>/.test(line)) {
    return "blockquote";
  }

  return "paragraph";
}

export function segmentMarkdownBlocks(
  messageId: string,
  text: string,
): MarkdownSegment[] {
  if (!text.trim()) {
    return [];
  }

  const rawLines = text.split("\n");
  let trailingBlankCount = 0;

  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    if (rawLines[index]?.trim() === "") {
      trailingBlankCount += 1;
    } else {
      break;
    }
  }

  const hasTrailingBlankLine = trailingBlankCount >= 2;
  const lines =
    trailingBlankCount > 0 ? rawLines.slice(0, -trailingBlankCount) : rawLines;

  const chunks: Array<{ kind: BlockKind; lines: string[]; closed: boolean }> = [];
  let chunk: string[] = [];
  let chunkKind: BlockKind | null = null;
  let fence: string | null = null;

  const flush = (closed: boolean) => {
    if (chunk.length === 0) {
      return;
    }

    chunks.push({ kind: chunkKind ?? "paragraph", lines: chunk, closed });
    chunk = [];
    chunkKind = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (fence) {
      chunk.push(line);

      if (trimmed.startsWith(fence)) {
        fence = null;
      }

      continue;
    }

    const fenceMatch = FENCE_PATTERN.exec(line);

    if (fenceMatch) {
      flush(true);
      chunkKind = "code";
      chunk.push(line);
      fence = fenceMatch[1] ?? "```";
      continue;
    }

    if (trimmed === "") {
      flush(true);
      continue;
    }

    const kind = detectKind(line);

    if (kind === "heading") {
      flush(true);
      chunkKind = "heading";
      chunk.push(line);
      flush(true);
      continue;
    }

    const isIndentedContinuation =
      chunkKind !== null && chunkKind !== "paragraph" && /^\s+/.test(line);

    if (chunkKind !== null && chunkKind !== kind && !isIndentedContinuation) {
      flush(true);
    }

    if (chunkKind === null) {
      chunkKind = kind;
    }

    chunk.push(line);
  }

  if (chunk.length > 0) {
    const closedByFence = chunkKind === "code" && fence === null;
    flush(hasTrailingBlankLine || closedByFence);
  }

  return chunks.map((entry, index) => ({
    id: `${messageId}:b${index}`,
    index,
    kind: entry.kind,
    raw: entry.lines.join("\n"),
    status: entry.closed ? "closed" : "open",
  }));
}
