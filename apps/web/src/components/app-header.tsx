import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BookOpen, Sparkles } from "lucide-react";

import { EngineeringNotes } from "@/components/devtools/engineering-notes";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import type { AppView } from "@/lib/hash-router";
import { useSidePanel } from "@/lib/side-panel-state";
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
  const { activePanel, togglePanel, closePanel } = useSidePanel();
  const [notesRoot, setNotesRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (activePanel === "notes") {
      setNotesRoot(document.getElementById("notes-root"));
    }
  }, [activePanel]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-b bg-background/90 px-3 py-2.5 backdrop-blur md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3 md:px-6 md:py-3">
        <div className="hidden min-w-0 items-center gap-3 md:flex">
          <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:flex">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Agent Workbench</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {subtitle}
            </p>
          </div>
        </div>

        <nav
          aria-label="主导航"
          className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5 md:justify-self-center"
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                closePanel();
                onNavigate(item.id);
              }}
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

        <div className="flex min-w-0 items-center justify-self-end gap-1 md:gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => togglePanel("notes")}
            aria-label="工程说明"
            aria-pressed={activePanel === "notes"}
          >
            <BookOpen />
            <span className="hidden lg:inline">工程说明</span>
          </Button>
          {children}
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="max-[359px]:hidden"
          >
            <a
              href="https://github.com/geyao2015/agent-workbench"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 仓库"
            >
              <GithubIcon className="size-4" />
            </a>
          </Button>
        </div>
      </header>

      {activePanel === "notes" && notesRoot
        ? createPortal(
            <EngineeringNotes onClose={closePanel} />,
            notesRoot,
          )
        : null}
    </>
  );
}
