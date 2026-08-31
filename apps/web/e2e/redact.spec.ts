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

test("a redaction box can be moved and resized before applying, and the adjusted (not original) position is what actually gets redacted", async ({
  page,
}) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Redact", { exact: true }).click();

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");

  // Draw a small box in clearly empty space, well clear of the "Lorem
  // ipsum" paragraph near the top of the page — deliberately NOT covering
  // it yet. Coordinates stay within the actual viewport (a PDF page at
  // "fit width" is routinely taller than the browser window).
  const drawX = pageBox.x + pageBox.width * 0.3;
  const drawY = pageBox.y + Math.min(pageBox.height * 0.6, viewport.height * 0.5);
  await page.mouse.move(drawX, drawY);
  await page.mouse.down();
  await page.mouse.move(drawX + 100, drawY + 30, { steps: 8 });
  await page.mouse.up();

  // A freshly-drawn box is auto-selected and immediately adjustable — 8
  // resize handles, not just a delete-and-redraw-only rectangle.
  const handles = page.locator(".cursor-nwse-resize, .cursor-nesw-resize, .cursor-ns-resize, .cursor-ew-resize");
  await expect(handles).toHaveCount(8);

  // Drag the box (via its own body — the whole box is the move handle)
  // up onto the "Lorem ipsum" paragraph.
  const boxCenterX = drawX + 50;
  const boxCenterY = drawY + 15;
  const targetY = pageBox.y + 250; // empirically where the text block's center sits at this zoom
  await page.mouse.move(boxCenterX, boxCenterY);
  await page.mouse.down();
  await page.mouse.move(boxCenterX, targetY, { steps: 10 });
  await page.mouse.up();

  // Widen it via the E (east/right) handle. DOM order is
  // [nw,n,ne,w,e,sw,s,se] and w/e share the .cursor-ew-resize class, so
  // select by position (.nth(4)), not .first() (which would grab "w").
  const eHandle = handles.nth(4);
  const eBox = await eHandle.boundingBox();
  if (!eBox) throw new Error("resize handle not found");
  await page.mouse.move(eBox.x + eBox.width / 2, eBox.y + eBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(eBox.x + 220, eBox.y, { steps: 8 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Apply redactions" }).click();
  await expect(page.getByText(/Redacted \d+ page/).first()).toBeVisible({ timeout: 8000 });

  // Prove it's the ADJUSTED position that got redacted, not the original
  // draw spot: "Lorem ipsum" appears on every page of this fixture, so a
  // correct redaction removes just page 1's match from the search results
  // while every other page's match stays findable (proving search itself
  // still works, not just coincidentally empty). Scoped to the search
  // panel's own result *buttons* (SearchPanel.tsx renders each as "Page N"
  // + a context snippet) rather than a page-wide text search — the
  // fixture's own page content literally contains the string "Page 2 of 8"
  // too (pdf.js text-layer spans, not buttons), so a page-wide getByText
  // can flakily match whichever page happens to be scrolled into view.
  await page.keyboard.press("Control+f");
  const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
  await searchInput.fill("Lorem ipsum");
  await expect(page.getByRole("button", { name: /^Page 2\b/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /^Page 1\b/ })).toHaveCount(0);
});

test("clicking an existing box selects it for adjustment, and Escape deselects without deleting it", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Redact", { exact: true }).click();

  const pageBox = await page.locator("[data-page-number='1']").boundingBox();
  const viewport = page.viewportSize();
  if (!pageBox || !viewport) throw new Error("page or viewport not found");

  const drawX = pageBox.x + pageBox.width * 0.3;
  const drawY = pageBox.y + Math.min(pageBox.height * 0.6, viewport.height * 0.5);
  await page.mouse.move(drawX, drawY);
  await page.mouse.down();
  await page.mouse.move(drawX + 100, drawY + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".cursor-nwse-resize")).toHaveCount(2); // 2 of the 8 handles share this class (nw, se)

  // Escape deselects (handles disappear) without removing the box itself.
  const selectedBox = page.locator(".border-ai.bg-black\\/70");
  await selectedBox.first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cursor-nwse-resize")).toHaveCount(0);
  await expect(page.getByText("1 box across 1 page")).toBeVisible();

  // Clicking the now-deselected box re-selects it (handles reappear) rather
  // than starting a brand-new box on top of it.
  await page.mouse.click(drawX + 50, drawY + 15);
  await expect(page.locator(".cursor-nwse-resize")).toHaveCount(2);
  await expect(page.getByText("1 box across 1 page")).toBeVisible(); // still exactly one box, not two
});
