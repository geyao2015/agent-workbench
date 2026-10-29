import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ENGINEERING_NOTES } from "@/lib/showcase";

export function EngineeringNotes({ onClose }: { onClose: () => void }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <p className="text-sm font-semibold">工程说明</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            这个 Demo 展示的是 Agent 工程深度，不只是聊天界面。
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭工程说明">
          <X />
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {ENGINEERING_NOTES.map((section) => (
          <section key={section.title} className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border bg-card px-3 py-2 text-xs leading-5 text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t px-5 py-3 text-[11px] leading-5 text-muted-foreground">
        数据均为合成数据；Release 为模拟环境；真实模型端到端评测待配置 Key。
      </div>
    </aside>
  );
}
