import { useEffect, useState, type ReactNode } from "react";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidePanel } from "@/lib/side-panel-state";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: SidePanelProps) {
  const { closing, instantOpen } = useSidePanel();
  const [entered, setEntered] = useState(instantOpen);

  useEffect(() => {
    if (instantOpen) {
      setEntered(true);
      return;
    }

    const frame = requestAnimationFrame(() => setEntered(true));

    return () => cancelAnimationFrame(frame);
  }, [instantOpen]);

  const open = entered && !closing;

  return (
    <aside
      className={cn(
        "fixed inset-0 z-30 w-full overflow-hidden lg:static lg:z-auto lg:h-full lg:transition-[width] lg:duration-[360ms] lg:ease-in-out",
        open ? "lg:w-96" : "lg:w-0",
        !open && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col border-l bg-background transition-transform duration-[360ms] ease-in-out lg:w-96 lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "translate-x-full",
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
      </div>
    </aside>
  );
}
