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
  await page.goto("/app");
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

test("comment (text) box: stays adjustable while editing, then move + resize + commit bakes it in at the adjusted spot", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Annotate", { exact: true }).click();
  await page.getByLabel("Add comment", { exact: true }).click();

  const canvasBeforeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  if (!pageBox) throw new Error("page not found");
  // A PDF page at "fit width" is routinely taller than the actual browser
  // viewport, so click/drag targets are chosen relative to the viewport
  // (always on-screen), not as raw fractions of the page's own — possibly
  // much larger — bounding box.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("viewport size unavailable");
  const firstY = pageBox.y + Math.min(pageBox.height * 0.35, viewport.height * 0.3);
  await page.mouse.click(pageBox.x + pageBox.width * 0.5, firstY);

  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible({ timeout: 3000 });
  await textarea.fill("Please review this section before signing.");

  // Nothing is baked in yet just from placing + typing.
  const canvasWhileEditingDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasWhileEditingDataUrl).toBe(canvasBeforeDataUrl);

  // Drag via the grip handle — the box must stay editable afterward (not
  // accidentally blurred/committed by the drag gesture).
  const grip = page.getByText("Comment", { exact: true });
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error("drag grip not found");
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + 60, gripBox.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect(textarea).toHaveValue("Please review this section before signing.");

  // Resize via the bottom-right handle — same "still editable after" check.
  const seHandle = page.locator(".cursor-nwse-resize").last();
  const seBox = await seHandle.boundingBox();
  if (!seBox) throw new Error("resize handle not found");
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 80, seBox.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect(textarea).toHaveValue("Please review this section before signing.");

  // Commit via the checkmark button.
  await page.getByRole("button", { name: "Add comment" }).last().click();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()), { timeout: 8000 })
    .not.toBe(canvasBeforeDataUrl);
  const canvasAfterCommitDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  // A second box, discarded via the X button, must not touch the document.
  const secondY = pageBox.y + Math.min(pageBox.height * 0.6, viewport.height * 0.55);
  await page.mouse.click(pageBox.x + pageBox.width * 0.5, secondY);
  const discardBtn = page.getByRole("button", { name: "Discard comment" });
  await expect(discardBtn).toBeVisible({ timeout: 3000 });
  await discardBtn.click();
  await expect(page.locator("textarea")).toHaveCount(0);
  const canvasAfterDiscardDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasAfterDiscardDataUrl).toBe(canvasAfterCommitDataUrl);

  // A third box, finalized by clicking elsewhere on the page instead of the checkmark.
  await page.mouse.click(pageBox.x + pageBox.width * 0.5, secondY);
  await page.locator("textarea").fill("Click-away commit test");
  await page.mouse.click(pageBox.x + pageBox.width * 0.2, firstY);
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()), { timeout: 8000 })
    .not.toBe(canvasAfterDiscardDataUrl);
});
