import { expect, test } from "@playwright/test";

test("知识库按服务与类型展示目录树，并预览文档内容", async ({ page }) => {
  await page.goto("/#/chat");

  const trigger = page.getByRole("button", { name: "知识库", exact: true });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "知识库" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const tree = dialog.locator("aside");
  await expect(
    tree.getByText("checkout-service", { exact: true }),
  ).toBeVisible();
  await expect(tree.getByText("platform", { exact: true })).toBeVisible();
  await expect(
    tree.getByText("incident", { exact: true }).first(),
  ).toBeVisible();

  await tree.getByRole("button", { name: /INC-042/ }).click();

  await expect(
    dialog.getByRole("heading", { name: /INC-042/ }),
  ).toBeVisible();
  await expect(dialog.getByText("#inc-042")).toBeVisible();
  await expect(dialog.getByText("#payment")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
