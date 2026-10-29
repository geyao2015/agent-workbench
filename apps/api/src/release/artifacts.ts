import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export interface ArtifactContent {
  mime: string;
  body: string;
}

export interface StoredArtifactInfo {
  mime: string;
  size: number;
  uri: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`非法 ${label}：${value}`);
  }
}

export class ArtifactStore {
  private readonly memory = new Map<string, ArtifactContent>();
  private readonly dir?: string;

  constructor(rootDir?: string) {
    this.dir = rootDir;

    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  write(
    runId: string,
    artifactId: string,
    content: ArtifactContent,
  ): StoredArtifactInfo {
    assertId(runId, "runId");
    assertId(artifactId, "artifactId");

    this.memory.set(`${runId}/${artifactId}`, content);

    if (this.dir) {
      const runDir = resolve(this.dir, runId);
      const target = resolve(runDir, `${artifactId}.json`);
      const temporary = `${target}.tmp`;

      mkdirSync(runDir, { recursive: true });
      writeFileSync(temporary, JSON.stringify(content), "utf8");
      renameSync(temporary, target);
    }

    return {
      mime: content.mime,
      size: Buffer.byteLength(content.body),
      uri: `/api/releases/runs/${runId}/artifacts/${artifactId}`,
    };
  }

  read(runId: string, artifactId: string): ArtifactContent | undefined {
    if (!ID_PATTERN.test(runId) || !ID_PATTERN.test(artifactId)) {
      return undefined;
    }

    const cached = this.memory.get(`${runId}/${artifactId}`);

    if (cached) {
      return cached;
    }

    if (!this.dir) {
      return undefined;
    }

    const path = resolve(this.dir, runId, `${artifactId}.json`);

    if (!existsSync(path)) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as ArtifactContent;

      if (typeof parsed.body === "string" && typeof parsed.mime === "string") {
        this.memory.set(`${runId}/${artifactId}`, parsed);
        return parsed;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}
