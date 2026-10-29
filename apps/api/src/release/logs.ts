import type { LogHit } from "./types.js";

export function flattenLogs(
  logs: Record<string, string>,
): LogHit[] {
  return Object.entries(logs).flatMap(([file, content]) =>
    content
      .split(/\r?\n/)
      .map((text, index) => ({
        file,
        line: index + 1,
        text,
      }))
      .filter((hit) => hit.text.trim().length > 0),
  );
}

export function searchLogs(
  logs: Record<string, string>,
  query: string,
  limit = 6,
): LogHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return [];
  }

  return flattenLogs(logs)
    .map((hit) => {
      const text = hit.text.toLowerCase();
      const score = terms.reduce(
        (count, term) => count + (text.includes(term) ? 1 : 0),
        0,
      );

      return { hit, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        left.hit.file.localeCompare(right.hit.file) ||
        left.hit.line - right.hit.line
      );
    })
    .slice(0, Math.max(1, limit))
    .map(({ hit }) => hit);
}

export function findEvidence(
  logs: Record<string, string>,
  evidence: string[],
): LogHit[] {
  const all = flattenLogs(logs);

  return evidence.map((needle) => {
    const match = all.find((hit) =>
      hit.text.toLowerCase().includes(needle.toLowerCase()),
    );

    if (!match) {
      throw new Error(`日志中找不到证据：${needle}`);
    }

    return match;
  });
}

export function getLogContext(
  logs: Record<string, string>,
  file: string,
  line: number,
  radius = 2,
): LogHit[] {
  const content = logs[file];

  if (content === undefined) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);

  return lines
    .slice(start - 1, end)
    .map((text, index) => ({
      file,
      line: start + index,
      text,
    }))
    .filter((hit) => hit.text.trim().length > 0);
}

export function formatLogHits(hits: LogHit[]): string {
  if (hits.length === 0) {
    return "没有命中日志行。";
  }

  return hits
    .map((hit) => `[${hit.file}:${hit.line}] ${hit.text}`)
    .join("\n");
}
