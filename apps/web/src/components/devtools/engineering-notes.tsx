import { SidePanel } from "@/components/devtools/side-panel";
import { ENGINEERING_NOTES } from "@/lib/showcase";

const NOTES = ENGINEERING_NOTES.flatMap((section) =>
  section.items.map((item) => ({
    section: section.title,
    item,
  })),
);

export function EngineeringNotes({ onClose }: { onClose: () => void }) {
  return (
    <SidePanel
      title="工程说明"
      subtitle="架构取舍、性能数据、模拟环境与已知限制"
      onClose={onClose}
    >
      <div className="space-y-2">
        {NOTES.map((note) => (
          <article
            key={`${note.section}:${note.item}`}
            className="rounded-lg border bg-muted/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{note.section}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                说明
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {note.item}
            </p>
          </article>
        ))}
      </div>
    </SidePanel>
  );
}
