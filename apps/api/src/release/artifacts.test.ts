import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "./artifacts.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ArtifactStore", () => {
  it("写入后可从新实例读取，并返回 uri", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-artifacts-"));
    tempDirs.push(dir);

    const store = new ArtifactStore(dir);
    const info = store.write("run_1", "art_1", {
      mime: "text/x-diff",
      body: "diff --git a/a b/a",
    });

    expect(info.uri).toBe("/api/releases/runs/run_1/artifacts/art_1");
    expect(info.size).toBeGreaterThan(0);

    const reloaded = new ArtifactStore(dir);

    expect(reloaded.read("run_1", "art_1")).toEqual({
      mime: "text/x-diff",
      body: "diff --git a/a b/a",
    });
  });

  it("拒绝非法 id 与缺失内容", () => {
    const store = new ArtifactStore();

    expect(() =>
      store.write("../run", "art_1", { mime: "text/plain", body: "x" }),
    ).toThrow("非法 runId");

    expect(store.read("run_1", "missing")).toBeUndefined();
    expect(store.read("../run", "art_1")).toBeUndefined();
  });
});
