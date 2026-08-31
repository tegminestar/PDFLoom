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

test("placing a date: click starts an adjustable draft (not baked yet), drag + resize adjust it, commit bakes the adjusted placement", async ({
  page,
}) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Sign", { exact: true }).click();
  await page.getByLabel("Add today's date", { exact: true }).click();

  const canvasBeforeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  if (!pageBox) throw new Error("page not found");
  const startX = pageBox.x + pageBox.width * 0.5;
  const startY = pageBox.y + pageBox.height * 0.4;
  await page.mouse.click(startX, startY);

  // A draft appeared with its own confirm/cancel controls — nothing baked yet.
  const confirmBtn = page.getByRole("button", { name: "Place here" });
  const cancelBtn = page.getByRole("button", { name: "Cancel placement" });
  await expect(confirmBtn).toBeVisible({ timeout: 3000 });
  await expect(cancelBtn).toBeVisible();
  const canvasStillUnbakedDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasStillUnbakedDataUrl).toBe(canvasBeforeDataUrl);

  // Drag it to a new position.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 90, startY + 70, { steps: 10 });
  await page.mouse.up();

  // Resize via the bottom-right corner handle — 8 handles (free resize) for
  // a text-based kind like "date", unlike the aspect-locked 4 for images.
  const handleCount = await page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize").count();
  expect(handleCount).toBe(8);
  const seHandle = page.locator(".cursor-nwse-resize").last();
  const seBox = await seHandle.boundingBox();
  if (!seBox) throw new Error("resize handle not found");
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 60, seBox.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(confirmBtn).toBeVisible();

  // Commit — the confirm button vanishes the instant isPlacing flips true
  // (replaced by a spinner), well before the async worker RPC + PDF reload
  // actually finish, so poll the canvas's real pixels rather than trust any
  // UI element's visibility as a "done" signal.
  await confirmBtn.click();
  await expect
    .poll(
      async () => page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL()),
      { timeout: 8000 },
    )
    .not.toBe(canvasBeforeDataUrl);
  const canvasAfterDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  // Persistence check, same pattern as annotate.spec.ts: leaving and
  // re-entering Sign mode re-renders from the in-memory document, not from
  // any leftover overlay state, so identical pixels confirm it's real.
  await page.getByLabel("Exit sign mode", { exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByLabel("Sign", { exact: true }).click();
  await page.waitForTimeout(300);
  const canvasReopenedDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasReopenedDataUrl).toBe(canvasAfterDataUrl);
});

test("placing a drawn signature: resize handles stay aspect-locked to the drawing, and Escape cancels without touching the document", async ({
  page,
}) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Sign", { exact: true }).click();
  await page.getByLabel("Create signature", { exact: true }).click();

  const drawCanvas = page.locator("canvas.cursor-crosshair");
  const cbox = await drawCanvas.boundingBox();
  if (!cbox) throw new Error("signature drawing canvas not found");
  await page.mouse.move(cbox.x + 40, cbox.y + cbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cbox.x + 200, cbox.y + 40, { steps: 8 });
  await page.mouse.move(cbox.x + cbox.width - 40, cbox.y + cbox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Use this signature" }).click();

  const canvasBeforeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  if (!pageBox) throw new Error("page not found");
  await page.mouse.click(pageBox.x + pageBox.width * 0.5, pageBox.y + pageBox.height * 0.4);

  const cancelBtn = page.getByRole("button", { name: "Cancel placement" });
  await expect(cancelBtn).toBeVisible({ timeout: 3000 });

  // Image assets only get the 4 corner handles (aspect-locked), not all 8.
  const handleCount = await page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize").count();
  expect(handleCount).toBe(4);

  const rectBefore = await page.evaluate(() => {
    const r = document.querySelector(".ring-2.ring-primary")!.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  const seHandle = page.locator(".cursor-nwse-resize").last();
  const seBox = await seHandle.boundingBox();
  if (!seBox) throw new Error("resize handle not found");
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 55, seBox.y + 2, { steps: 8 }); // mostly-horizontal drag
  await page.mouse.up();
  await page.waitForTimeout(150);
  const rectAfter = await page.evaluate(() => {
    const r = document.querySelector(".ring-2.ring-primary")!.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(rectAfter.width).toBeGreaterThan(rectBefore.width);
  const aspectBefore = rectBefore.width / rectBefore.height;
  const aspectAfter = rectAfter.width / rectAfter.height;
  expect(Math.abs(aspectAfter - aspectBefore) / aspectBefore).toBeLessThan(0.02);

  // Escape discards the draft — the document must be byte-for-byte
  // unchanged (nothing baked in), unlike a commit.
  await page.keyboard.press("Escape");
  await expect(cancelBtn).not.toBeVisible({ timeout: 3000 });
  const canvasAfterEscapeDataUrl = await page.locator("canvas").first().evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(canvasAfterEscapeDataUrl).toBe(canvasBeforeDataUrl);
});
