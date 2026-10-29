import { SidePanel } from "@/components/devtools/side-panel";
import { ENGINEERING_NOTES } from "@/lib/showcase";

export function EngineeringNotes({ onClose }: { onClose: () => void }) {
  return (
    <SidePanel title="工程说明" onClose={onClose} overlay>
      <div className="space-y-4">
        <p className="px-1 text-xs leading-5 text-muted-foreground">
          这个 Demo 展示的是 Agent 工程深度，不只是聊天界面。
        </p>

        {ENGINEERING_NOTES.map((section) => (
          <section key={section.title} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
              {section.title}
            </h3>
            <ul className="space-y-1.5">
              {section.items.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="px-1 pt-1 text-[10px] leading-4 text-muted-foreground">
          数据均为合成数据；Release 为模拟环境；真实模型端到端评测待配置 Key。
        </p>
      </div>
    </SidePanel>
  );
}
