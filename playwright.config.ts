import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    channel: process.env.PW_CHANNEL ?? "chrome",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      RUNTIME_MODE: "mock",
      STORE_DIR: ".data/e2e",
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      OPENAI_MODEL: "",
      ANTHROPIC_API_KEY: "",
      MODEL_PROVIDER: "",
      MODEL_CATALOG: "",
    },
  },
});
