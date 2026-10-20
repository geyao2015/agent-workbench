import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownBlockProps {
  raw: string;
  showCursor: boolean;
}

export const MarkdownBlock = memo(function MarkdownBlock({
  raw,
  showCursor,
}: MarkdownBlockProps) {
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
