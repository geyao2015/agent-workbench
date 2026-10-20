import { memo, useState } from "react";

import { Brain, ChevronDown, Loader2 } from "lucide-react";

import { AgentCard } from "./agent-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReasoningCardProps {
  text: string;
  streaming: boolean;
}

export const ReasoningCard = memo(function ReasoningCard({
  text,
  streaming,
}: ReasoningCardProps) {
  const [expanded, setExpanded] = useState(true);
  const hasText = text.trim().length > 0;

  return (
    <div className="pl-11">
      <AgentCard
        icon={streaming ? <Loader2 className="animate-spin" /> : <Brain />}
        title="思考过程"
        subtitle={streaming ? "正在推理…" : `${text.length} 字`}
        actions={
          hasText ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? "收起" : "展开"}
              <ChevronDown
                className={cn("transition-transform", expanded && "rotate-180")}
              />
            </Button>
          ) : null
        }
      >
        {expanded ? (
          <p className="scroll-slim max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
            {text}
          </p>
        ) : null}
      </AgentCard>
    </div>
  );
});
