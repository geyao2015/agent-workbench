import { expect, test } from "@playwright/test";

test("Release 通过两次阶段审批后完成", async ({ page }) => {
  await page.goto("/#/releases");
  await expect(page.getByText("Release Workbench")).toBeVisible();

  await page.getByRole("button", { name: "开始发版" }).click();
  await expect(page).toHaveURL(/#\/releases\/thread_/);

  const status = page.getByTestId("release-status");
  await expect(status).toBeVisible();

  const approve = page
    .locator("button:not([disabled])")
    .filter({ hasText: "批准执行" });
  const deadline = Date.now() + 40_000;

  while (Date.now() < deadline) {
    if ((await status.textContent()) === "completed") {
      break;
    }

    if ((await approve.count()) > 0) {
      await approve.first().click();
      await page.waitForTimeout(500);
    } else {
      await page.waitForTimeout(200);
    }
  }

  await expect(status).toHaveText("completed", { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Audit" })).toBeVisible();
});
