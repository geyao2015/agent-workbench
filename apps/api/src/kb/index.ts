import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

export interface DocMetadata {
  service: string;
  type: string;
  tags: string[];
}

export interface SearchFilter {
  service?: string;
  type?: string;
  tags?: string[];
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  metadata?: DocMetadata;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  title: string;
  locator: string;
  content: string;
  metadata?: DocMetadata;
  tokens: string[];
  titleTokens: string[];
}

export interface SearchHit {
  sourceId: string;
  chunkId: string;
  title: string;
  locator: string;
  snippet: string;
  score: number;
}

const MAX_CHUNK_CHARS = 900;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];

  for (const word of normalized.match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? []) {
    tokens.push(word);
  }

  for (const run of normalized.match(/[一-鿿]+/g) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }

    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }

  return tokens;
}

function docTitle(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m);

  return heading?.[1]?.trim() || fallback;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitLongSection(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) {
    return [content];
  }

  const parts: string[] = [];
  let current = "";

  for (const paragraph of splitParagraphs(content)) {
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      parts.push(current);
      current = paragraph;
      continue;
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function chunkDoc(doc: KnowledgeDoc): KnowledgeChunk[] {
  const lines = doc.content.split(/\r?\n/);
  const sections: Array<{ heading: string; body: string[] }> = [
    { heading: "概述", body: [] },
  ];

  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      continue;
    }

    if (/^##\s+/.test(line)) {
      sections.push({ heading: line.replace(/^##\s+/, "").trim(), body: [] });
      continue;
    }

    sections.at(-1)?.body.push(line);
  }

  const chunks: KnowledgeChunk[] = [];
  const titleTokens = [...new Set(tokenize(doc.title))];

  for (const section of sections) {
    const body = section.body.join("\n").trim();

    if (!body) {
      continue;
    }

    const pieces = splitLongSection(body);

    pieces.forEach((piece, partIndex) => {
      const chunkIndex = chunks.length;
      const locator =
        pieces.length > 1
          ? `${doc.title} > ${section.heading}（${partIndex + 1}/${pieces.length}）`
          : `${doc.title} > ${section.heading}`;

      chunks.push({
        id: `${doc.id}#${chunkIndex}`,
        sourceId: doc.id,
        title: doc.title,
        locator,
        content: piece,
        ...(doc.metadata ? { metadata: doc.metadata } : {}),
        tokens: tokenize(`${doc.title}\n${section.heading}\n${piece}`),
        titleTokens,
      });
    });
  }

  return chunks;
}

function makeSnippet(content: string, queryTokens: string[], maxLength = 260): string {
  const lower = content.toLowerCase();
  let matchIndex = -1;

  for (const token of queryTokens) {
    const index = lower.indexOf(token);

    if (index >= 0 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
    }
  }

  if (matchIndex === -1) {
    return content.length > maxLength ? `${content.slice(0, maxLength)}…` : content;
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(content.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";

  return `${prefix}${content.slice(start, end)}${suffix}`;
}

export class KnowledgeBase {
  readonly docs: Map<string, KnowledgeDoc>;
  readonly chunks: KnowledgeChunk[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  private constructor(docs: Map<string, KnowledgeDoc>, chunks: KnowledgeChunk[]) {
    this.docs = docs;
    this.chunks = chunks;

    let totalLength = 0;

    for (const chunk of chunks) {
      totalLength += chunk.tokens.length;

      for (const token of new Set(chunk.tokens)) {
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) ?? 0) + 1,
        );
      }
    }

    this.averageLength = chunks.length > 0 ? totalLength / chunks.length : 0;
  }

  static load(docsDir: string): KnowledgeBase {
    const docs = new Map<string, KnowledgeDoc>();
    const metadataPath = resolve(docsDir, "metadata.json");
    const metadataById = existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, "utf8")) as {
          docs?: Record<string, DocMetadata>;
        }).docs ?? {}
      : {};

    for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const id = basename(entry.name, ".md");
      const content = readFileSync(resolve(docsDir, entry.name), "utf8").trim();
      const metadata = metadataById[id];

      docs.set(id, {
        id,
        title: docTitle(content, id),
        content,
        ...(metadata ? { metadata } : {}),
      });
    }

    const chunks = [...docs.values()].flatMap(chunkDoc);

    return new KnowledgeBase(docs, chunks);
  }

  list(): Array<{ id: string; title: string }> {
    return [...this.docs.values()].map(({ id, title }) => ({ id, title }));
  }

  get(sourceId: string): KnowledgeDoc | undefined {
    return this.docs.get(sourceId);
  }

  search(query: string, limit = 4, filter: SearchFilter = {}): SearchHit[] {
    const queryTokens = [...new Set(tokenize(query))];

    if (queryTokens.length === 0 || this.chunks.length === 0) {
      return [];
    }

    const chunks = this.chunks.filter((chunk) => {
      const metadata = chunk.metadata;

      if (filter.service && metadata?.service !== filter.service) {
        return false;
      }

      if (filter.type && metadata?.type !== filter.type) {
        return false;
      }

      if (filter.tags && filter.tags.length > 0) {
        if (!metadata || !filter.tags.every((tag) => metadata.tags.includes(tag))) {
          return false;
        }
      }

      return true;
    });

    if (chunks.length === 0) {
      return [];
    }

    const totalChunks = this.chunks.length;
    const scored = chunks.map((chunk) => {
      const frequencies = new Map<string, number>();

      for (const token of chunk.tokens) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }

      let score = 0;

      for (const token of queryTokens) {
        const frequency = frequencies.get(token) ?? 0;
        const documentFrequency = this.documentFrequency.get(token) ?? 0;
        const idf = Math.log(
          1 + (totalChunks - documentFrequency + 0.5) / (documentFrequency + 0.5),
        );

        if (frequency > 0 && this.averageLength > 0) {
          const denominator =
            frequency +
            BM25_K1 *
              (1 - BM25_B + (BM25_B * chunk.tokens.length) / this.averageLength);
          score += idf * ((frequency * (BM25_K1 + 1)) / denominator);
        }

        if (chunk.titleTokens.includes(token)) {
          score += idf * 0.8;
        }
      }

      return { chunk, score };
    });

    return scored
      .filter(({ score }) => score > 0.05)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, limit))
      .map(({ chunk, score }) => ({
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        title: chunk.title,
        locator: chunk.locator,
        snippet: makeSnippet(chunk.content, queryTokens),
        score: Number(score.toFixed(3)),
      }));
  }
}
