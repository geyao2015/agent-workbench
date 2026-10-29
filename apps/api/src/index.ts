import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { createAgentApi } from "./agent-api.js";
import { createChatAgent } from "./agent/graph.js";
import { loadRuntimeConfig, publicRuntimeInfo } from "./config.js";
import { loadFixtures, watchFixtures } from "./fixtures.js";
import { KnowledgeBase } from "./kb/index.js";
import { createLongConversationDemo } from "./mock/demo.js";
import { registerMockRuntime } from "./mock/runtime.js";
import { createReleaseApi } from "./release-api.js";
import { ApprovalRegistry } from "./release/approvals.js";
import { ArtifactStore } from "./release/artifacts.js";
import { createConflictResolver } from "./release/conflict.js";
import { ReleaseService } from "./release/runtime.js";
import { loadReleaseScenarios } from "./release/scenario.js";
import { RunManager } from "./runs/run-manager.js";
import { RunRegistry } from "./runs/run-registry.js";
import { ThreadStore } from "./runs/thread-store.js";

try {
  process.loadEnvFile();
} catch {
  // 没有 .env 时继续使用进程环境变量
}

const config = (() => {
  try {
    return loadRuntimeConfig();
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  }
})();

const port = config.port;
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const hasWebBuild = existsSync(webDist);
let fixtures = loadFixtures();

watchFixtures(() => {
  try {
    fixtures = loadFixtures();
    console.log(`Reloaded fixtures: ${[...fixtures.keys()].join(", ")}`);
  } catch (cause) {
    console.error("fixture 重载失败", cause);
  }
});

const kb = KnowledgeBase.load(config.docsDir);
const threads = new ThreadStore(config.storeDir);
const registry = new RunRegistry(threads);
const artifacts = new ArtifactStore(resolve(config.storeDir, "artifacts"));
const approvals = new ApprovalRegistry();
const releaseScenarios = loadReleaseScenarios(config.releasesDir);
const conflictResolver = createConflictResolver(config);
const release = new ReleaseService({
  registry,
  scenarios: releaseScenarios,
  artifacts,
  approvals,
  conflictResolver,
  kb,
});
const agentRuntime = (() => {
  if (config.mode !== "agent") {
    return undefined;
  }

  const agent = createChatAgent(config, kb, releaseScenarios);
  const runs = new RunManager({ agent, kb, store: threads, registry });

  return { runs };
})();

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "agent-workbench-api",
    runtime: config.mode,
    message:
      config.mode === "agent"
        ? "Hono agent runtime is running."
        : "Hono mock runtime is running. hello world!",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/runtime", (c) =>
  c.json({
    ...publicRuntimeInfo(config),
    docs: kb.list().length,
    releases: releaseScenarios.length,
  }),
);

app.route(
  "/",
  createReleaseApi({ release, registry, approvals, artifacts, threads }),
);

if (agentRuntime) {
  app.route(
    "/",
    createAgentApi({
      runs: agentRuntime.runs,
      threads,
      kb,
    }),
  );
}

app.get("/api/scenarios", (c) =>
  c.json({
    scenarios: [...fixtures.values()].map(({ scenario }) => ({
      name: scenario.name,
      description: scenario.description,
      runKind: scenario.runKind,
    })),
  }),
);

app.post("/api/demo/long-conversation", (c) => {
  try {
    return c.json(createLongConversationDemo(fixtures));
  } catch (cause) {
    return c.json(
      { error: cause instanceof Error ? cause.message : "生成长会话失败" },
      500,
    );
  }
});

// mock 运行时：fixture 回放，保留 M1 的暂停、审批与断线重放语义
if (config.mode === "mock") {
  registerMockRuntime(app, () => fixtures);
}


if (hasWebBuild) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  console.log(
    config.mode === "agent"
      ? `Runtime: agent (${config.provider}/${config.model}) · KB ${kb.list().length} docs · Releases ${releaseScenarios.length}`
      : `Runtime: mock · ${fixtures.size} fixtures · Releases ${releaseScenarios.length}`,
  );
  console.log(
    hasWebBuild
      ? `Serving web from ${webDist}`
      : "web/dist not found; run `pnpm build` for single-URL mode",
  );
});
