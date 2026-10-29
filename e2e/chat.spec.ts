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

test("流式期间追加消息，当前 run 结束后自动发送", async ({ page }) => {
  await page.goto("/#/chat");

  await page.getByRole("button", { name: /超长返回/ }).click();

  const input = page.getByRole("textbox", { name: "消息输入" });
  await expect(input).toBeEnabled();
  await input.fill("追加：顺便列出回滚条件");
  await page.getByRole("button", { name: "排队发送" }).click();

  await expect(
    page.getByText("待发送 · 追加：顺便列出回滚条件"),
  ).toBeVisible();
  await expect(
    page.getByText("当前 run 结束后自动发送 1 条排队消息"),
  ).toBeVisible();

  await expect(
    page.getByText("追加：顺便列出回滚条件", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("待发送 · 追加：顺便列出回滚条件")).toBeHidden();

  const feed = page.getByTestId("chat-feed");
  await expect(feed).toHaveAttribute("data-streaming", "false", {
    timeout: 30_000,
  });
});

test("取消当前 run 会清空排队消息", async ({ page }) => {
  await page.goto("/#/chat");

  await page.getByRole("button", { name: /超长返回/ }).click();

  const input = page.getByRole("textbox", { name: "消息输入" });
  await input.fill("这条消息不应该被发送");
  await page.getByRole("button", { name: "排队发送" }).click();
  await expect(
    page.getByText("待发送 · 这条消息不应该被发送"),
  ).toBeVisible();

  await page.getByRole("button", { name: "取消运行" }).click();

  await expect(
    page.getByText("待发送 · 这条消息不应该被发送"),
  ).toBeHidden();
  await expect(
    page.getByText("这条消息不应该被发送", { exact: true }),
  ).toHaveCount(0);
});
