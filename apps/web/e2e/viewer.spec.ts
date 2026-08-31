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

test("search shows a precise on-page highlight box, not just a page-level ring", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Search", { exact: true }).click();
  await page.getByPlaceholder("Search in document…").fill("Lorem ipsum");
  await page.waitForTimeout(600);

  const pageBox = await page.locator('[data-page-number="1"]').boundingBox();
  const highlight = page.locator('[data-page-number="1"] [class*="bg-ai"]').first();
  await expect(highlight).toBeVisible();
  const highlightBox = await highlight.boundingBox();
  if (!pageBox || !highlightBox) throw new Error("page or highlight box not found");
  // A real per-match box is much smaller than the whole page — proves this
  // isn't just the pre-existing page-wide "active result" ring.
  expect(highlightBox.width).toBeLessThan(pageBox.width * 0.6);
  expect(highlightBox.height).toBeLessThan(pageBox.height * 0.3);
});

test("fit to page shows the whole page without vertical overflow, distinct from fit to width", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  const zoomReadout = page.locator("button:has-text('%')").first();
  const widthPercent = await zoomReadout.textContent();

  await page.getByLabel("Fit to page", { exact: true }).click();
  await page.waitForTimeout(300);
  const pagePercent = await zoomReadout.textContent();
  expect(pagePercent).not.toBe(widthPercent);

  const pageBox = await page.locator('[data-page-number="1"]').boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");
  expect(pageBox.height).toBeLessThanOrEqual(viewport.height);
});

test("command palette's Presentation mode entry toggles both ways and relabels itself", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.keyboard.press("Control+k");
  await page.getByText("Presentation mode", { exact: true }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);

  await page.keyboard.press("Control+k");
  await expect(page.getByText("Exit presentation mode", { exact: true })).toBeVisible();
  await page.getByText("Exit presentation mode", { exact: true }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test("view mode: single page and two-page spread both render the right pages, sized to fit the viewport", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  const pageEls = page.locator("[data-page-number]");
  await expect(pageEls).toHaveCount(8); // continuous (default) shows every page

  await page.getByLabel(/^View mode:/).click();
  await page.getByText("Single page", { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(pageEls).toHaveCount(1);
  await expect(pageEls.first()).toHaveAttribute("data-page-number", "1");

  await page.getByLabel("Next page", { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(pageEls).toHaveCount(1);
  await expect(pageEls.first()).toHaveAttribute("data-page-number", "2");

  await page.getByLabel(/^View mode:/).click();
  await page.getByText("Two-page view", { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(pageEls).toHaveCount(2);

  // Regression coverage for a real bug: switching to two-page briefly
  // rendered 2 pages at the single-page fit-width scale before the
  // container was re-measured, and a missing min-w-0 in the app's flex
  // layout let it grow to fit that overflow instead of clipping it —
  // locking in a scale that never actually fit 2 pages side by side.
  const box1 = await pageEls.nth(0).boundingBox();
  const box2 = await pageEls.nth(1).boundingBox();
  const viewport = page.viewportSize();
  if (!box1 || !box2 || !viewport) throw new Error("page boxes or viewport not found");
  expect(box1.x).toBeGreaterThanOrEqual(0);
  expect(box2.x + box2.width).toBeLessThanOrEqual(viewport.width);
  expect(Math.abs(box1.y - box2.y)).toBeLessThan(5); // side by side, not stacked

  await page.getByLabel(/^View mode:/).click();
  await page.getByText("Continuous scrolling", { exact: true }).click();
  await page.waitForTimeout(300);
  await expect(pageEls).toHaveCount(8);
});
