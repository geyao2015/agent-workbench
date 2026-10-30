import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Check, ChevronDown, Loader2 } from "lucide-react";

import { useRuntimeStore } from "@/lib/runtime-store";
import { cn } from "@/lib/utils";

function modeLabel(
  mode: "agent" | "mock" | undefined,
  modelLabel: string | undefined,
): string {
  if (mode === "agent") {
    return modelLabel ?? "实时 Agent";
  }

  return "Mock 模式";
}

export function RuntimeSwitcher() {
  const info = useRuntimeStore((state) => state.info);
  const status = useRuntimeStore((state) => state.status);
  const switching = useRuntimeStore((state) => state.switching);
  const pending = useRuntimeStore((state) => state.pending);
  const error = useRuntimeStore((state) => state.error);
  const requestSwitch = useRuntimeStore((state) => state.requestSwitch);

  const currentModel = info?.models.find((model) => model.id === info.modelId);
  const currentLabel = modeLabel(info?.mode, currentModel?.label);
  const pendingLabel = pending
    ? modeLabel(
        pending.mode,
        info?.models.find((model) => model.id === pending.modelId)?.label,
      )
    : null;
  const effectiveMode = pending?.mode ?? info?.mode;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="runtime-switcher"
          aria-label="切换运行时"
          className="hidden h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          {switching || pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full",
                info?.mode === "agent" ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
          )}
          {status === "loading" && !info ? (
            <span className="text-muted-foreground">运行时…</span>
          ) : pendingLabel ? (
            <span>待切换：{pendingLabel}</span>
          ) : (
            <span>{currentLabel}</span>
          )}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
            运行时
          </DropdownMenu.Label>

          <DropdownMenu.Item
            data-runtime-mode="mock"
            disabled={switching}
            onSelect={() => void requestSwitch({ mode: "mock" })}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent",
            )}
          >
            <span className="flex items-center justify-between gap-2 text-xs font-medium">
              Mock 模式
              {effectiveMode === "mock" ? <Check className="size-3.5" /> : null}
            </span>
            <span className="text-[11px] text-muted-foreground">
              本地 fixture 回放，不调用模型
            </span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            data-runtime-mode="agent"
            disabled={switching || !info?.agentAvailable}
            onSelect={() => void requestSwitch({ mode: "agent" })}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-accent",
            )}
          >
            <span className="flex items-center justify-between gap-2 text-xs font-medium">
              实时 Agent
              {effectiveMode === "agent" ? <Check className="size-3.5" /> : null}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {info?.agentAvailable
                ? (currentModel?.label ?? "调用真实模型")
                : "未配置模型 Key"}
            </span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
            模型
          </DropdownMenu.Label>

          {(info?.models.length ?? 0) === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              未配置模型
            </p>
          ) : (
            info?.models.map((model) => (
              <DropdownMenu.Item
                key={model.id}
                disabled
                className="flex cursor-not-allowed flex-col gap-0.5 rounded-lg px-2 py-1.5 opacity-60 outline-none"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-medium">
                  {model.label}
                  {model.id === info.modelId ? (
                    <Check className="size-3.5" />
                  ) : null}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {model.available ? "模型切换即将支持" : "未配置该模型的 Key"}
                </span>
              </DropdownMenu.Item>
            ))
          )}

          {pending ? (
            <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
              当前对话结束后切换，下一个对话生效。
            </p>
          ) : null}

          {error ? (
            <p className="mt-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
