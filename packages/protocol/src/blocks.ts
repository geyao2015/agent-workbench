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
  startIndex = 0,
): MarkdownSegment[] {
  if (!text.trim()) {
    return [];
  }

  const endsWithNewline = text.endsWith("\n");
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

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    const isLastLine = lineIndex === lines.length - 1;
    const isIncompleteLastLine = isLastLine && !endsWithNewline;

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

      if (!isLastLine || endsWithNewline) {
        flush(true);
      }

      continue;
    }

    const isIndentedContinuation =
      chunkKind !== null && chunkKind !== "paragraph" && /^\s+/.test(line);

    if (
      chunkKind !== null &&
      chunkKind !== kind &&
      !isIndentedContinuation &&
      !isIncompleteLastLine
    ) {
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

  const preserveTrailingNewline =
    !hasTrailingBlankLine && trailingBlankCount === 1;

  return chunks.map((entry, offset) => {
    const index = startIndex + offset;
    const isLastChunk = offset === chunks.length - 1;
    const raw =
      entry.lines.join("\n") +
      (isLastChunk && !entry.closed && preserveTrailingNewline ? "\n" : "");

    return {
      id: `${messageId}:b${index}`,
      index,
      kind: entry.kind,
      raw,
      status: entry.closed ? "closed" : "open",
    };
  });
}
