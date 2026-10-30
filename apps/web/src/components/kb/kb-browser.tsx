import { useEffect, useMemo, useRef, useState } from "react";

import { FileText, Library, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchKbDoc,
  fetchKbDocs,
  type KbDoc,
  type KbDocSummary,
} from "@/transport/kb";

interface ServiceGroup {
  service: string;
  count: number;
  types: Array<{ type: string; docs: KbDocSummary[] }>;
}

function groupDocs(docs: KbDocSummary[]): ServiceGroup[] {
  const services = new Map<string, Map<string, KbDocSummary[]>>();

  for (const doc of docs) {
    const service = doc.metadata?.service ?? "其他";
    const type = doc.metadata?.type ?? "其他";
    const types = services.get(service) ?? new Map<string, KbDocSummary[]>();

    types.set(type, [...(types.get(type) ?? []), doc]);
    services.set(service, types);
  }

  return [...services.entries()]
    .map(([service, types]) => ({
      service,
      count: [...types.values()].reduce((sum, items) => sum + items.length, 0),
      types: [...types.entries()]
        .map(([type, items]) => ({
          type,
          docs: [...items].sort((a, b) => a.title.localeCompare(b.title)),
        }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    }))
    .sort((a, b) => a.service.localeCompare(b.service));
}

export function KbBrowser({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<KbDocSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<KbDoc | null>(null);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const items = await fetchKbDocs(controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setDocs(items);
        setSelectedId((current) => current ?? items[0]?.id ?? null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setListError(
            cause instanceof Error ? cause.message : "读取知识库失败",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingList(false);
        }
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const controller = new AbortController();
    setIsLoadingDoc(true);
    setDocError(null);

    void (async () => {
      try {
        const next = await fetchKbDoc(selectedId, controller.signal);

        if (!controller.signal.aborted) {
          setDoc(next);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setDoc(null);
          setDocError(cause instanceof Error ? cause.message : "读取文档失败");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingDoc(false);
        }
      }
    })();

    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const groups = useMemo(() => groupDocs(docs), [docs]);
  const heading = doc?.title ?? (isLoadingDoc ? "加载中…" : "选择文档");

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-foreground/30 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="知识库"
        className="flex h-full w-full overflow-hidden bg-background sm:h-[min(90vh,54rem)] sm:max-w-5xl sm:rounded-xl sm:border sm:shadow-2xl"
      >
        <aside className="flex w-40 shrink-0 flex-col border-r bg-muted/20 sm:w-60">
          <div className="flex items-center gap-2 border-b px-3 py-3 text-sm font-medium">
            <Library className="size-4 text-muted-foreground" />
            知识库
            <span className="text-xs font-normal text-muted-foreground">
              {docs.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoadingList ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                加载文档…
              </div>
            ) : listError ? (
              <p className="px-2 py-3 text-xs text-destructive">{listError}</p>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => (
                  <section key={group.service}>
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>{group.service}</span>
                      <span className="ml-1 font-normal normal-case">
                        ({group.count})
                      </span>
                    </p>
                    <div className="space-y-2">
                      {group.types.map(({ type, docs: items }) => (
                        <div key={type}>
                          <p className="px-2 text-[10px] text-muted-foreground/80">
                            {type}
                          </p>
                          <ul className="mt-0.5 space-y-0.5">
                            {items.map((item) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedId(item.id)}
                                  aria-current={
                                    selectedId === item.id
                                      ? "true"
                                      : undefined
                                  }
                                  className={cn(
                                    "flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs leading-4 transition-colors hover:bg-accent",
                                    selectedId === item.id &&
                                      "bg-accent font-medium",
                                  )}
                                >
                                  <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 truncate">
                                    {item.title}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{heading}</p>
              {doc?.metadata ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    {doc.metadata.service}
                  </span>
                  <span className="rounded bg-secondary px-1.5 py-0.5">
                    {doc.metadata.type}
                  </span>
                  {doc.metadata.tags?.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <Button
              ref={closeRef}
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="关闭知识库"
            >
              <X />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {isLoadingDoc ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                加载文档…
              </div>
            ) : docError ? (
              <p className="py-2 text-sm text-destructive">{docError}</p>
            ) : doc ? (
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) =>
                      href && /^https?:\/\//i.test(href) ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                  }}
                >
                  {doc.content}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                从左侧选择一篇文档查看内容。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
