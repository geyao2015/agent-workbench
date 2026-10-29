import type { ReactNode } from "react";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  overlay?: boolean;
}

export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
  overlay = false,
}: SidePanelProps) {
  return (
    <aside
      className={cn(
        "flex flex-col border-l bg-background",
        overlay
          ? "fixed inset-y-0 right-0 z-30 w-full lg:w-96"
          : "fixed inset-0 z-30 lg:static lg:z-auto lg:w-96 lg:shrink-0",
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={`关闭${title}`}
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

      {footer ? <div className="border-t px-4 py-2">{footer}</div> : null}
    </aside>
  );
}
