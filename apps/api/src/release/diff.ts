import type {
  ConflictResolution,
  DiffArtifactBody,
  ReleaseFile,
  ResolvedFile,
} from "./types.js";

function linesOf(text: string): string[] {
  return text.split("\n");
}

export function resolveFiles(files: ReleaseFile[]): ResolvedFile[] {
  return files.map((file) => ({
    path: file.path,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      resolved: hunk.recommended,
    })),
  }));
}

export function buildUnifiedDiffFromResolved(files: ResolvedFile[]): string {
  const lines: string[] = [];

  for (const file of files) {
    lines.push(`diff --git a/${file.path} b/${file.path}`);
    lines.push(`--- a/${file.path}`);
    lines.push(`+++ b/${file.path}`);
    let lineNumber = 1;

    for (const hunk of file.hunks) {
      const baseLines = linesOf(hunk.base);
      const resolvedLines = linesOf(hunk.resolved);

      lines.push(
        `@@ -${lineNumber},${baseLines.length} +${lineNumber},${resolvedLines.length} @@ ${hunk.id}`,
      );

      for (const line of baseLines) {
        lines.push(`-${line}`);
      }

      for (const line of resolvedLines) {
        lines.push(`+${line}`);
      }

      lineNumber += baseLines.length;
    }
  }

  return lines.join("\n");
}

export function buildUnifiedDiff(files: ReleaseFile[]): string {
  return buildUnifiedDiffFromResolved(resolveFiles(files));
}

export function buildDiffArtifact(
  files: ReleaseFile[],
  resolution?: ConflictResolution,
): DiffArtifactBody {
  const resolved = resolution?.files ?? resolveFiles(files);

  return {
    unified: buildUnifiedDiffFromResolved(resolved),
    files: resolved,
    ...(resolution
      ? {
          resolution: {
            mode: resolution.mode,
            ...(resolution.fallbackReason
              ? { fallbackReason: resolution.fallbackReason }
              : {}),
            ...(resolution.latencyMs !== undefined
              ? { latencyMs: resolution.latencyMs }
              : {}),
          },
        }
      : {}),
  };
}
