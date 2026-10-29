import { expect, test } from "@playwright/test";

test("Chat 流式回放一条 fixture run，直到运行结束", async ({ page }) => {
  await page.goto("/#/chat");

  await page.getByRole("button", { name: /一般对话/ }).click();
  await expect(
    page.getByText("你在 Agent Workbench 里能做什么？"),
  ).toBeVisible();

  const feed = page.getByTestId("chat-feed");
  await expect(feed).toBeVisible();
  await expect(feed).toHaveAttribute("data-streaming", "false", {
    timeout: 20_000,
  });
  await expect(page.locator(".markdown-block").first()).toBeVisible();
});
