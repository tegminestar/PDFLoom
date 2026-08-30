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
  await page.goto("/");
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
