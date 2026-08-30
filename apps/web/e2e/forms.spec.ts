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
  await page.goto("/");
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
