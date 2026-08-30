import { expect, test } from "@playwright/test";
import path from "node:path";
import { FIXTURES_DIR } from "./helpers.js";

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

test("build an image-only PDF, OCR it, and confirm it becomes searchable", async ({ page }) => {
  test.setTimeout(200_000);
  await page.goto("/");
  await page.waitForSelector("text=PDFLoom");

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "From images" }).click(),
  ]);
  await fileChooser.setFiles(path.join(FIXTURES_DIR, "ocr-source-page.png"));
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(600);
  await expect(page.locator("canvas").first()).toBeVisible();

  await page.getByLabel("Convert", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Make searchable (OCR)…" }).click();
  await expect(page.getByRole("heading", { name: "Make searchable (OCR)" })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Current", exact: true }).click();
  await page.getByRole("button", { name: /Run OCR/ }).click();

  // Real Tesseract.js WASM OCR — generous timeout, no shortcuts.
  await expect(page.getByText(/Recognized \d+ words/).first()).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.waitForTimeout(400);

  await page.getByLabel("Search", { exact: true }).click();
  await page.waitForTimeout(200);
  await page.keyboard.type("PDFLoom");
  await page.waitForTimeout(1000);
  await expect(page.getByText(/^\d+ of \d+$/).first()).toBeVisible({ timeout: 10000 });
});
