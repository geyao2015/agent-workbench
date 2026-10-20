import { memo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { recordBlockRender } from "@/lib/render-stats";

interface MarkdownBlockProps {
  blockId: string;
  raw: string;
  closed: boolean;
  showCursor: boolean;
}

export const MarkdownBlock = memo(function MarkdownBlock({
  blockId,
  raw,
  closed,
  showCursor,
}: MarkdownBlockProps) {
  useEffect(() => {
    recordBlockRender(blockId, closed);
  });

  return (
    <div className="markdown-block">
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {raw + (showCursor ? " ▍" : "")}
        </ReactMarkdown>
      </div>
    </div>
  );
});
