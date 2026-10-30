import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 5174);
const apiPort = Number(process.env.E2E_API_PORT ?? 8788);
const baseURL = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    channel: process.env.PW_CHANNEL ?? "chrome",
  },
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    // 独立端口与 STORE_DIR：不复用开发服务器，测试会话不会写进 .data/threads
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(apiPort),
      VITE_PORT: String(webPort),
      API_ORIGIN: `http://localhost:${apiPort}`,
      STORE_DIR: ".data/e2e",
      RUNTIME_MODE: "mock",
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      OPENAI_MODEL: "",
      ANTHROPIC_API_KEY: "",
      MODEL_PROVIDER: "",
      MODEL_CATALOG: "",
    },
  },
});
