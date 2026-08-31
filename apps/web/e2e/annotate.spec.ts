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

test("stamp: stays adjustable before placing, and Escape discards it without touching the document", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Annotate", { exact: true }).click();
  await page.getByLabel("Stamp", { exact: true }).click();

  const canvasBeforeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");
  const clickX = pageBox.x + pageBox.width * 0.3;
  const clickY = pageBox.y + Math.min(pageBox.height * 0.55, viewport.height * 0.45);
  await page.mouse.click(clickX, clickY);

  const handles = page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize");
  await expect(handles).toHaveCount(8);
  // Nothing is baked in yet, just from placing the draft.
  const canvasWhilePlacingDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasWhilePlacingDataUrl).toBe(canvasBeforeDataUrl);

  const draftBox = page.locator(".border-\\[3px\\]");
  const rectBefore = await draftBox.boundingBox();
  if (!rectBefore) throw new Error("stamp draft not found");

  // Move it by dragging its own body.
  await page.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(rectBefore.x + rectBefore.width / 2 + 70, rectBefore.y + rectBefore.height / 2 + 50, { steps: 8 });
  await page.mouse.up();

  // Resize via the SE handle (DOM order [nw,n,ne,w,e,sw,s,se] -> index 7).
  const seHandle = handles.nth(7);
  const seBox = await seHandle.boundingBox();
  if (!seBox) throw new Error("resize handle not found");
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 40, seBox.y + 20, { steps: 8 });
  await page.mouse.up();

  const rectAfter = await draftBox.boundingBox();
  if (!rectAfter) throw new Error("stamp draft not found after adjustment");
  expect(Math.abs(rectAfter.x - rectBefore.x)).toBeGreaterThan(30);
  expect(rectAfter.width).toBeGreaterThan(rectBefore.width + 10);

  // Commit via the checkmark — the adjusted stamp actually bakes in.
  await page.getByRole("button", { name: "Place stamp" }).click();
  await expect
    .poll(async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()), { timeout: 8000 })
    .not.toBe(canvasBeforeDataUrl);
  const canvasAfterCommitDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  // A second stamp, discarded via Escape, must not touch the document.
  await page.mouse.click(clickX, clickY + 150);
  await expect(handles).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(handles).toHaveCount(0);
  const canvasAfterEscapeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasAfterEscapeDataUrl).toBe(canvasAfterCommitDataUrl);
});
