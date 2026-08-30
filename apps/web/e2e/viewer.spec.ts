import { expect, test } from "@playwright/test";
import { openPdf } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  (page as unknown as { __errors: string[] }).__errors = errors;
});

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __errors: string[] }).__errors;
  expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
});

test("open, thumbnails, search, zoom, and page navigation", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("PDFLoom").first()).toBeVisible();

  await openPdf(page, "sample.pdf");
  await expect(page.locator("canvas").first()).toBeVisible();

  const pageInput = page.locator('input[class*="tabular-nums"]');

  await page.getByLabel("Pages", { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("3")').first().click();
  await page.waitForTimeout(300);
  await expect(pageInput).toHaveValue("3");

  await page.getByLabel("Search", { exact: true }).click();
  await page.waitForTimeout(200);
  await page.keyboard.type("Lorem");
  await page.waitForTimeout(600);
  for (let i = 0; i < 4; i++) {
    await page.getByLabel("Next match", { exact: true }).click();
  }
  await page.waitForTimeout(300);
  await expect(pageInput).not.toHaveValue("3");

  await page.getByLabel("Zoom in", { exact: true }).click();
  await page.getByLabel("Zoom in", { exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.locator("canvas").first()).toBeVisible();
});

test("theme toggle switches dark/light", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.getByLabel(/Switch to light theme/).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBe(before);
  expect(after).toBe("light");
});
