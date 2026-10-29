import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BookOpen, Sparkles } from "lucide-react";

import { EngineeringNotes } from "@/components/devtools/engineering-notes";
import { Button } from "@/components/ui/button";
import type { AppView } from "@/lib/hash-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{ id: AppView; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "releases", label: "Releases" },
];

interface AppHeaderProps {
  subtitle: string;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  children?: ReactNode;
}

export function AppHeader({
  subtitle,
  activeView,
  onNavigate,
  children,
}: AppHeaderProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [notesRoot, setNotesRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (showNotes) {
      setNotesRoot(document.getElementById("notes-root"));
    }
  }, [showNotes]);

  return (
    <>
      <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Agent Workbench</h1>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <nav
          aria-label="主导航"
          className="flex shrink-0 items-center justify-self-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeView === item.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-self-end gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNotes(true)}
            aria-label="工程说明"
          >
            <BookOpen />
            <span className="hidden sm:inline">工程说明</span>
          </Button>
          {children}
        </div>
      </header>

      {showNotes && notesRoot
        ? createPortal(
            <EngineeringNotes onClose={() => setShowNotes(false)} />,
            notesRoot,
          )
        : null}
    </>
  );
}
