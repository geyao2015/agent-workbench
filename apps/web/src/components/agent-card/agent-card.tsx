import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type CardTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneBorder: Record<CardTone, string> = {
  neutral: "",
  info: "border-sky-500/30",
  success: "border-emerald-500/30",
  warning: "border-amber-500/40",
  danger: "border-destructive/40",
};

interface AgentCardProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  tone?: CardTone;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function AgentCard({
  icon,
  title,
  subtitle,
  status,
  tone = "neutral",
  actions,
  children,
  footer,
  className,
}: AgentCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs",
        toneBorder[tone],
        className,
      )}
    >
      <header className="flex items-start gap-2.5 px-3 py-2.5">
        {icon ? (
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground [&_svg]:size-4">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{title}</span>
            {status}
          </div>
          {subtitle ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </header>

      {children ? <div className="border-t px-3 py-2.5">{children}</div> : null}
      {footer ? (
        <div className="border-t bg-muted/30 px-3 py-2.5">{footer}</div>
      ) : null}
    </section>
  );
}
