import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AxeResults, NodeResult, Result } from "axe-core";
import { openPdf } from "./helpers.js";

/**
 * Automated WCAG audit of PDFLoom's own UI (not the PDF/UA tagging of
 * user documents — see accessibility.ts / AccessibilityDialog.tsx for
 * that, a deliberately separate concern). axe-core catches real,
 * objective violations (missing labels, contrast, ARIA misuse); it
 * can't catch everything a manual screen-reader pass would, but a zero-
 * violation baseline here is a real, meaningful floor to hold.
 */
async function scan(page: Page, disableRules: string[] = []): Promise<AxeResults> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "best-practice"]);
  if (disableRules.length) builder.disableRules(disableRules);
  return builder.analyze();
}

function describeViolations(results: AxeResults): string {
  return results.violations
    .map((v: Result) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))\n  ${v.nodes.map((n: NodeResult) => n.target.join(" ")).join("\n  ")}`)
    .join("\n\n");
}

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

test("welcome screen has no WCAG violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("PDFLoom").first()).toBeVisible();
  const results = await scan(page);
  expect(results.violations, describeViolations(results)).toEqual([]);
});

test("open document + reading view has no WCAG violations", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "sample.pdf");
  const results = await scan(page);
  expect(results.violations, describeViolations(results)).toEqual([]);
});

test("Organize pages view has no WCAG violations", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "sample.pdf");
  await page.getByLabel("Organize pages", { exact: true }).click();
  await expect(page.getByText("8 pages")).toBeVisible({ timeout: 10000 });
  const results = await scan(page);
  expect(results.violations, describeViolations(results)).toEqual([]);
});

test("a modal dialog (Protect) has no WCAG violations and traps focus", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "sample.pdf");
  await page.getByLabel("Protect", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });

  const results = await scan(page);
  expect(results.violations, describeViolations(results)).toEqual([]);

  // Tabbing from the last focusable element in the dialog should cycle
  // back inside it, not escape to the page behind — real focus trapping,
  // not just "a dialog role is present."
  const dialog = page.getByRole("dialog");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const activeInsideDialog = await dialog.evaluate((el, active) => el.contains(active), await page.evaluateHandle(() => document.activeElement));
  expect(activeInsideDialog).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 3000 });
});

test("AI tools dropdown menu has no WCAG violations, and background focus is truly trapped", async ({ page }) => {
  await page.goto("/");
  await openPdf(page, "sample.pdf");
  await page.getByLabel("AI tools", { exact: true }).click();
  await expect(page.getByText("Summarize…", { exact: true })).toBeVisible({ timeout: 5000 });

  // Radix marks #root aria-hidden while the menu's portal content is open
  // (a correct, standard pattern — the background truly is inert) and
  // relies on FocusScope, not tabindex="-1", to keep Tab from reaching it.
  // axe's static analysis can't see that runtime trap, so it flags the
  // hidden-but-still-in-the-tab-order background buttons, and — as a
  // knock-on effect of the whole root being hidden — even "the document
  // has a landmark/heading" become falsely un-satisfiable. Verified for
  // real below (8 real Tab presses never leave the menu); disabling only
  // the rules that are consequences of that specific, verified-safe
  // pattern, not the whole scan.
  const results = await scan(page, ["aria-hidden-focus", "landmark-one-main", "page-has-heading-one", "region"]);
  expect(results.violations, describeViolations(results)).toEqual([]);

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const insideMenu = await page.evaluate(() => !!document.activeElement?.closest('[role="menu"]'));
    expect(insideMenu, `Tab ${i + 1} escaped the open menu`).toBe(true);
  }
});
