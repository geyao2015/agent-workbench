import { expect, test } from "@playwright/test";

async function runtimeInfo(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/runtime");

  return (await response.json()) as {
    mode: "agent" | "mock";
    agentAvailable: boolean;
  };
}

test.afterEach(async ({ request }) => {
  await request.post("/api/runtime", { data: { mode: "mock" } });
});

test("默认 mock，agent 是否可切换取决于模型 Key", async ({ page }) => {
  await page.goto("/#/chat");

  const info = await runtimeInfo(page);
  const switcher = page.getByTestId("runtime-switcher");

  await expect(switcher).toContainText("Mock 模式");
  await switcher.click();

  const mockItem = page.locator('[data-runtime-mode="mock"]');
  const agentItem = page.locator('[data-runtime-mode="agent"]');

  await expect(mockItem).toBeVisible();
  await expect(agentItem).toBeVisible();

  if (info.agentAvailable) {
    await expect(agentItem).not.toHaveAttribute("aria-disabled", "true");
  } else {
    await expect(agentItem).toHaveAttribute("aria-disabled", "true");
    await expect(agentItem).toContainText("未配置模型 Key");
  }
});

test("Release 页面共享同一个运行时切换控件", async ({ page }) => {
  await page.goto("/#/releases");

  await expect(page.getByTestId("runtime-switcher")).toContainText("Mock 模式");
});

test("运行中切换会挂起，run 结束后自动生效", async ({ page }) => {
  const info = await runtimeInfo(page);

  test.skip(!info.agentAvailable, "未配置模型 Key，无法验证切换");

  await page.goto("/#/chat");
  await page.getByRole("button", { name: /超长返回/ }).click();

  const feed = page.getByTestId("chat-feed");
  await expect(feed).toHaveAttribute("data-streaming", "true");

  await page.getByTestId("runtime-switcher").click();
  await page.locator('[data-runtime-mode="agent"]').click();

  await expect(page.getByTestId("runtime-switcher")).toContainText("待切换");

  await page.getByRole("button", { name: "取消运行" }).click();
  await expect(page.getByTestId("runtime-switcher")).toContainText("glm-", {
    timeout: 15_000,
  });
});
