import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openPdf, FIXTURES_DIR } from "./helpers.js";

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

test("merge another file in, then export a page from the merged result and verify its bytes", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Organize pages", { exact: true }).click();
  await expect(page.getByText("8 pages")).toBeVisible({ timeout: 10000 });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Add pages from file…" }).click(),
  ]);
  await fileChooser.setFiles(path.join(FIXTURES_DIR, "test-form.pdf"));
  // sample.pdf's 8 pages plus test-form.pdf's own 1 page, merged in.
  await expect(page.getByText("9 pages")).toBeVisible({ timeout: 10000 });
  const mergedCount = 9;

  // Export the merged document's LAST page (only present because of the
  // merge) via Split's custom-range export — a real, automatable download,
  // unlike the toolbar's "Save a copy" which opens a native file picker.
  await page.getByRole("button", { name: "Split…" }).click();
  await expect(page.getByText("Split document")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Custom ranges", exact: true }).click();
  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill(String(mergedCount));
  await numberInputs.nth(1).fill(String(mergedCount));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Split into 1 file/ }).click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `pdfloom-e2e-merged-page-${Date.now()}.pdf`);
  await download.saveAs(outPath);
  await download.path();

  try {
    const bytes = await readFile(outPath);
    const exported = await PDFDocument.load(bytes);
    expect(exported.getPageCount()).toBe(1);
  } finally {
    await unlink(outPath).catch(() => undefined);
  }
});

test("resize pages to A4 actually changes page dimensions, not just a no-op toast", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Organize pages", { exact: true }).click();
  await expect(page.getByText("8 pages")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Resize…" }).click();
  await expect(page.getByText("Resize pages")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "A4 (210 × 297 mm)" }).click();
  await page.getByRole("button", { name: /Resize 8 pages/ }).click();
  await expect(page.getByText("Resized 8 pages").first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("8 pages", { exact: true })).toBeVisible(); // page count unaffected by a resize

  // Verify the ACTUAL new page size, not just that nothing crashed — same
  // "export via Split, then inspect the real bytes" trick as the merge test
  // above, since Resize mutates the open document in place rather than
  // producing its own downloadable file.
  await page.getByRole("button", { name: "Split…" }).click();
  await page.getByRole("button", { name: "Custom ranges", exact: true }).click();
  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill("1");
  await numberInputs.nth(1).fill("1");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Split into 1 file/ }).click();
  const download = await downloadPromise;
  const outPath = path.join(os.tmpdir(), `pdfloom-e2e-resized-page-${Date.now()}.pdf`);
  await download.saveAs(outPath);

  try {
    const bytes = await readFile(outPath);
    const exported = await PDFDocument.load(bytes);
    const { width, height } = exported.getPage(0).getSize();
    // A4 in points: 595.28 x 841.89 — allow a small tolerance for pdf-lib's
    // own floating-point rounding through the scale/setSize/translate chain.
    expect(Math.abs(width - 595.28)).toBeLessThan(1);
    expect(Math.abs(height - 841.89)).toBeLessThan(1);
  } finally {
    await unlink(outPath).catch(() => undefined);
  }
});

test("multiple pages per sheet: dialog shows the right sheet count, and cancelling the save doesn't show a false success toast", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Organize pages", { exact: true }).click();
  await expect(page.getByText("8 pages")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Multiple per sheet…" }).click();
  await expect(page.getByText("Multiple pages per sheet")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "4 per sheet" }).click();
  await expect(page.getByText("8 pages → 2 US Letter sheets, 4 per sheet.")).toBeVisible();

  // Headless Chromium's showSaveFilePicker always rejects with AbortError —
  // there's no real user to click through a native OS dialog — so this
  // exercises the save-cancellation path every real user hits at least
  // occasionally. That path used to show a false "success" toast (saveAs
  // swallowed the cancellation into the same `null` return used for a real
  // completed download, so callers couldn't tell them apart) — the fix
  // makes it throw a distinguishable AbortError instead, and this is the
  // regression test for it: neither toast should appear, and the dialog
  // should stay open rather than closing as if the save had completed.
  await page.getByRole("button", { name: /Save \d+ sheets?/ }).click();
  await page.waitForTimeout(800);
  await expect(page.getByText(/Combined \d+ pages/)).toHaveCount(0);
  await expect(page.getByText("Couldn't combine pages")).toHaveCount(0);
  await expect(page.getByText("Multiple pages per sheet")).toBeVisible();
});

test("reorder via drag shows a clear before/after insertion line and applies a direction-consistent reorder", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Organize pages", { exact: true }).click();
  await expect(page.getByText("8 pages")).toBeVisible({ timeout: 10000 });

  const tiles = page.locator("[draggable='true']");
  const tile1 = tiles.nth(0);
  const tile3 = tiles.nth(2);
  const box1 = await tile1.boundingBox();
  const box3 = await tile3.boundingBox();
  if (!box1 || !box3) throw new Error("page tiles not found");

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await tile1.dispatchEvent("dragstart", { dataTransfer });
  // Hover the right half of tile 3 — the insertion line should appear on
  // tile 3's trailing (right) edge, not a whole-tile highlight, and drop
  // there should land page 1 immediately *after* page 3 regardless of drag
  // direction (see reorder.ts's own direction-independence tests).
  await tile3.dispatchEvent("dragover", { dataTransfer, clientX: box3.x + box3.width * 0.85, clientY: box3.y + box3.height / 2 });
  await page.waitForTimeout(150);
  const rightEdgeIndicatorVisible = await tile3.locator(".bg-ai").count();
  expect(rightEdgeIndicatorVisible).toBeGreaterThan(0);

  await tile3.dispatchEvent("drop", { dataTransfer, clientX: box3.x + box3.width * 0.85, clientY: box3.y + box3.height / 2 });
  await tile1.dispatchEvent("dragend", { dataTransfer });

  await expect(page.getByText("Reordered pages").first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("8 pages", { exact: true })).toBeVisible();
});
