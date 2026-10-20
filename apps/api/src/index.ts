import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

const port = Number(process.env.PORT ?? 8787);
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const hasWebBuild = existsSync(webDist);

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "agent-workbench-api",
    message: "Hono mock runtime is running. hello world!",
    timestamp: new Date().toISOString(),
  }),
);

if (hasWebBuild) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  console.log(
    hasWebBuild
      ? `Serving web from ${webDist}`
      : "web/dist not found; run `pnpm build` for single-URL mode",
  );
});
