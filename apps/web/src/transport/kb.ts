import { HttpError } from "./sse";

export interface KbDocMetadata {
  service?: string;
  type?: string;
  tags?: string[];
}

export interface KbDocSummary {
  id: string;
  title: string;
  metadata?: KbDocMetadata;
}

export interface KbDoc extends KbDocSummary {
  content: string;
}

export async function fetchKbDocs(
  signal?: AbortSignal,
): Promise<KbDocSummary[]> {
  const response = await fetch("/api/kb/docs", { signal });

  if (!response.ok) {
    throw new HttpError(
      response.status,
      `读取知识库列表失败：HTTP ${response.status}`,
    );
  }

  const input = (await response.json()) as { docs?: unknown };

  return Array.isArray(input.docs) ? (input.docs as KbDocSummary[]) : [];
}

export async function fetchKbDoc(
  docId: string,
  signal?: AbortSignal,
): Promise<KbDoc> {
  const response = await fetch(
    `/api/kb/docs/${encodeURIComponent(docId)}`,
    { signal },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      `读取文档失败：HTTP ${response.status}${detail ? `（${detail}）` : ""}`,
    );
  }

  const input = (await response.json()) as { doc?: KbDoc };

  if (!input.doc) {
    throw new Error("文档响应格式错误");
  }

  return input.doc;
}
