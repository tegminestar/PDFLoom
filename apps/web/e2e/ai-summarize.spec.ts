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

test("summarize a page with the real local AI model (no API key, no mock)", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("AI tools", { exact: true }).click();
  await page.getByText("Summarize…", { exact: true }).click();
  await expect(page.getByText("A small AI model reads")).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Current page", exact: true }).click();
  await page.getByRole("button", { name: "Summarize", exact: true }).click();

  await expect(page.getByText(/Downloading AI model|Preparing the AI model|Summarizing/).first()).toBeVisible({ timeout: 30_000 });

  // First run on a fresh browser context downloads a real ~70MB model —
  // genuinely can take a few minutes. Wait for the Copy button, which only
  // renders once a real result exists (unlike any text containing
  // "summary", which also matches the dialog's own description paragraph).
  await expect(page.locator('button:has-text("Copy")')).toBeVisible({ timeout: 240_000 });
  await page.waitForTimeout(300);

  const summaryText = await page.locator("p.whitespace-pre-wrap").first().textContent();
  expect(summaryText?.trim().length ?? 0).toBeGreaterThan(0);
  // Genuinely condensed, not an echo of the (short) source page text.
  expect(summaryText?.length ?? 0).toBeLessThan(2000);
});
