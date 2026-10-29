import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("移动端 header 单行，抽屉从 header 下方展开且支持 Esc", async ({
  page,
}) => {
  await page.goto("/#/chat");

  const header = page.locator("header");
  const nav = page.getByRole("navigation", { name: "主导航" });
  const actions = page.getByTestId("header-actions");

  const layout = await page.evaluate(() => {
    const header = document.querySelector("header")!;
    const nav = document.querySelector('nav[aria-label="主导航"]')!;
    const actions = document.querySelector(
      '[data-testid="header-actions"]',
    )!;
    return {
      header: header.getBoundingClientRect().toJSON(),
      nav: nav.getBoundingClientRect().toJSON(),
      actions: actions.getBoundingClientRect().toJSON(),
      brandVisible:
        getComputedStyle(header.firstElementChild as HTMLElement).display !==
        "none",
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });

  expect(layout.brandVisible).toBe(false);
  expect(Math.abs(layout.nav.y - layout.actions.y)).toBeLessThan(20);
  expect(layout.actions.x).toBeGreaterThan(layout.nav.right - 1);
  expect(layout.docScrollWidth).toBe(layout.innerWidth);

  const trigger = page.getByRole("button", { name: /^事件/ });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "事件检查器" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  const dialogBox = await dialog.boundingBox();

  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.y).toBeGreaterThanOrEqual(layout.header.bottom - 1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 3_000 });
  await expect(trigger).toBeFocused();

  await expect(header).toBeVisible();
  await expect(nav).toBeVisible();
});

test("320px 下 Release tabs 可横向滚动并选中尾部 tab", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/#/releases");
  await page.getByRole("button", { name: "开始发版" }).click();

  const tabs = page.getByRole("tablist");
  await expect(tabs).toBeVisible();

  const metrics = await tabs.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  const audit = page.getByRole("tab", { name: "Audit" });
  await audit.click();
  await expect(audit).toHaveAttribute("aria-selected", "true");
});
