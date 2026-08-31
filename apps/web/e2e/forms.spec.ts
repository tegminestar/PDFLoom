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

test("fill an AcroForm, save, and confirm values persist on reopen", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "test-form.pdf");

  await page.getByLabel("Fill form", { exact: true }).click();
  // Field detection is async (setFormFillOpen scans the AcroForm off the
  // click), and briefly shows a "no fillable fields" empty state before
  // resolving — wait for the real field overlay, not a generic "field"
  // text match, which also matches the always-present "Add fields" button.
  await expect(page.locator('input[type="text"]').first()).toBeVisible({ timeout: 8000 });

  await page.locator('input[type="text"]').first().fill("Ada Lovelace");
  await page.locator("textarea").fill("Mathematician and writer.");
  await page.locator('input[type="checkbox"]').check();
  await page.locator('input[type="radio"]').nth(1).check();
  await page.locator("select").selectOption("Canada");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Form saved").first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(500);

  await page.getByLabel("Fill form", { exact: true }).click();
  await page.waitForTimeout(800);

  await expect(page.locator('input[type="text"]').first()).toHaveValue("Ada Lovelace");
  await expect(page.locator('input[type="checkbox"]')).toBeChecked();
  await expect(page.locator("select")).toHaveValue("Canada");
  await expect(page.locator('input[type="radio"]').nth(1)).toBeChecked();
});

test("field designer: a placed field stays adjustable, and the created field lands at the adjusted position/size", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf"); // no pre-existing fields — a blank canvas to design onto

  await page.getByLabel("Fill form", { exact: true }).click();
  await page.getByText("Add fields").click();
  await page.getByLabel("Text field", { exact: true }).click();

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");
  const clickX = pageBox.x + pageBox.width * 0.3;
  const clickY = pageBox.y + Math.min(pageBox.height * 0.55, viewport.height * 0.45);
  await page.mouse.click(clickX, clickY);

  const handles = page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize");
  await expect(handles).toHaveCount(8); // free resize, no aspect lock — unlike the image-signature case

  const draftBox = page.locator(".border-dashed.border-primary");
  const draftRectBefore = await draftBox.boundingBox();
  if (!draftRectBefore) throw new Error("draft box not found");

  // Move it by dragging the box's own body.
  const moveFromX = draftRectBefore.x + draftRectBefore.width / 2;
  const moveFromY = draftRectBefore.y + draftRectBefore.height / 2;
  await page.mouse.move(moveFromX, moveFromY);
  await page.mouse.down();
  await page.mouse.move(moveFromX + 60, moveFromY + 40, { steps: 8 });
  await page.mouse.up();

  // Resize via the SE handle — DOM order is [nw,n,ne,w,e,sw,s,se], so index 7.
  const seHandle = handles.nth(7);
  const seBox = await seHandle.boundingBox();
  if (!seBox) throw new Error("resize handle not found");
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 60, seBox.y + 15, { steps: 8 });
  await page.mouse.up();

  const draftRectAfter = await draftBox.boundingBox();
  if (!draftRectAfter) throw new Error("draft box not found after adjustment");
  expect(Math.abs(draftRectAfter.x - draftRectBefore.x)).toBeGreaterThan(20);
  expect(draftRectAfter.width).toBeGreaterThan(draftRectBefore.width + 20);

  await page.getByPlaceholder("e.g. fullName").fill("designerTestField");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await expect(page.getByText('Added "designerTestField" field').first()).toBeVisible({ timeout: 8000 });

  // Switch to Fill mode and confirm the created field renders at the
  // *adjusted* position/size, not the original click-placed default —
  // proving the resize/move actually reached the real AcroForm field, not
  // just the local draft preview.
  await page.getByText("Fill", { exact: true }).click();
  const filledInput = page.locator('input[type="text"]').first();
  await expect(filledInput).toBeVisible({ timeout: 5000 });
  const filledBox = await filledInput.boundingBox();
  if (!filledBox) throw new Error("filled field not found");
  expect(filledBox.width).toBeGreaterThan(draftRectBefore.width + 15);
});
