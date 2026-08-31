import { expect, test } from "@playwright/test";
import path from "node:path";
import { FIXTURES_DIR, openPdf } from "./helpers.js";

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

test("edit text: the replacement box stays resizable, since the new text is often a different length than the original", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Edit", { exact: true }).click();
  await page.getByText("Lorem ipsum").first().click();

  const handles = page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize");
  await expect(handles).toHaveCount(8);

  const box = page.locator(".border-dashed.border-primary").first();
  const rectBefore = await box.boundingBox();
  if (!rectBefore) throw new Error("text-edit box not found");

  // Widen via the E (east/right) handle — DOM order [nw,n,ne,w,e,sw,s,se], index 4.
  const eHandle = handles.nth(4);
  const eBox = await eHandle.boundingBox();
  if (!eBox) throw new Error("resize handle not found");
  await page.mouse.move(eBox.x + eBox.width / 2, eBox.y + eBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(eBox.x + 150, eBox.y, { steps: 8 });
  await page.mouse.up();

  const rectAfter = await box.boundingBox();
  if (!rectAfter) throw new Error("text-edit box not found after resize");
  expect(rectAfter.width).toBeGreaterThan(rectBefore.width + 50);

  const canvasBefore = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator("textarea").fill("This replacement text is considerably longer than the original word");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Text replaced").first()).toBeVisible({ timeout: 8000 });
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()), { timeout: 8000 })
    .not.toBe(canvasBefore);
});

test("replace image: the picked image stays adjustable (move + resize) before it's actually applied", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Edit", { exact: true }).click();
  await page.getByLabel("Replace image", { exact: true }).click();

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");
  const drawX = pageBox.x + pageBox.width * 0.3;
  const drawY = pageBox.y + Math.min(pageBox.height * 0.55, viewport.height * 0.4);

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    (async () => {
      await page.mouse.move(drawX, drawY);
      await page.mouse.down();
      await page.mouse.move(drawX + 120, drawY + 90, { steps: 8 });
      await page.mouse.up();
    })(),
  ]);
  await fileChooser.setFiles(path.join(FIXTURES_DIR, "ocr-source-page.png"));

  const handles = page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize");
  await expect(handles).toHaveCount(8);
  await expect(page.locator("img[src^='blob:']")).toBeVisible({ timeout: 5000 });

  const box = page.locator(".border-dashed.border-primary").first();
  const rectBefore = await box.boundingBox();
  if (!rectBefore) throw new Error("image-edit preview box not found");

  // Move by dragging the box's own body.
  await page.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(rectBefore.x + rectBefore.width / 2 + 60, rectBefore.y + rectBefore.height / 2 + 40, { steps: 8 });
  await page.mouse.up();

  const rectAfter = await box.boundingBox();
  if (!rectAfter) throw new Error("image-edit preview box not found after move");
  expect(Math.abs(rectAfter.x - rectBefore.x)).toBeGreaterThan(30);

  const canvasBefore = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole("button", { name: "Replace with this image" }).click();
  await expect(page.getByText("Image replaced").first()).toBeVisible({ timeout: 8000 });
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()), { timeout: 8000 })
    .not.toBe(canvasBefore);
});
