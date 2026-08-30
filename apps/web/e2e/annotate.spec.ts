import { expect, test, type Locator } from "@playwright/test";
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

test("annotate a page (highlight + shape), committed marks change the rendered pixels", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Annotate", { exact: true }).click();
  await expect(page.getByText("Annotate").first()).toBeVisible();

  const canvasBeforeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  await page.getByLabel("Highlight text", { exact: true }).click();
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".loom-text-layer span")];
    const target = spans.find((s) => s.textContent?.includes("Lorem ipsum"));
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForTimeout(300);
  const applyBtn = page.getByRole("button", { name: /Highlight/ }).last() as Locator;
  await expect(applyBtn).toBeVisible({ timeout: 5000 });
  await applyBtn.click();
  await expect(page.getByText("Added highlight").first()).toBeVisible({ timeout: 8000 });

  await page.getByLabel("Rectangle", { exact: true }).click();
  const canvasBox = await page.locator("canvas").first().boundingBox();
  if (!canvasBox) throw new Error("canvas not found");
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 400);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 420, canvasBox.y + 470, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Added square").first()).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(500);

  // Both annotations bake into the page's own rasterized pixels (they
  // serialize to real PDF annotation objects, not a separate DOM overlay),
  // so the most reliable persistence signal is the canvas actually having
  // changed from its pre-annotation state.
  const canvasAfterDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasAfterDataUrl).not.toBe(canvasBeforeDataUrl);

  // Toggling the Annotate rail item off and back on re-renders the page
  // from the in-memory document (not a redo of the draw), so the same
  // pixels coming back confirms the marks actually landed on the document
  // rather than living only in transient overlay state.
  await page.getByLabel("Annotate", { exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByLabel("Annotate", { exact: true }).click();
  await page.waitForTimeout(500);
  const canvasReopenedDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasReopenedDataUrl).toBe(canvasAfterDataUrl);
});
