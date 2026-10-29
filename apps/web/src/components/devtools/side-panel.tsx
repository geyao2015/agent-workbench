import { useEffect, useRef, useState, type ReactNode } from "react";

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
  const [overlay, setOverlay] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (instantOpen) {
      setEntered(true);
      return;
    }

    const frame = requestAnimationFrame(() => setEntered(true));

    return () => cancelAnimationFrame(frame);
  }, [instantOpen]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setOverlay(!query.matches);

    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);

  const open = entered && !closing;

  useEffect(() => {
    if (!open) {
      return;
    }

    const node = asideRef.current;

    if (!node) {
      return;
    }

    function focusables(): HTMLElement[] {
      return Array.from(
        node!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!overlay || event.key !== "Tab") {
        return;
      }

      const items = focusables();

      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement as HTMLElement | null;

      if (!node!.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    if (overlay) {
      closeRef.current?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, overlay, onClose]);

  return (
    <aside
      ref={asideRef}
      role={overlay ? "dialog" : "complementary"}
      aria-modal={overlay && open ? true : undefined}
      aria-label={title}
      aria-hidden={!open && !closing ? true : undefined}
      className={cn(
        "absolute inset-0 z-30 w-full overflow-hidden lg:static lg:z-auto lg:h-full lg:transition-[width] lg:duration-300 lg:ease-in-out",
        open ? "lg:w-96" : "lg:w-0",
        !open && "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col border-l bg-background transition-transform duration-300 ease-in-out lg:w-96 lg:translate-x-0 lg:shrink-0",
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
            ref={closeRef}
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
