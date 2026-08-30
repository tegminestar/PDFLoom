import { expect, test } from "@playwright/test";

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

test("landing page renders its sections and the hero CTA opens the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Weave every page.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the app" })).toBeVisible();
  await expect(page.locator("#features")).toBeVisible();
  await expect(page.locator("#ai")).toBeVisible();
  await expect(page.locator("#privacy")).toBeVisible();

  await page.getByRole("link", { name: "Open PDFLoom — it's free" }).click();
  await page.waitForURL("**/app");
  await expect(page.getByText("Drop a PDF here")).toBeVisible({ timeout: 10000 });
});

test("reloading on /app stays in the app, not the landing page", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("Drop a PDF here")).toBeVisible({ timeout: 10000 });
  await page.reload();
  await expect(page.getByText("Drop a PDF here")).toBeVisible({ timeout: 10000 });
});

test("an unknown path redirects to the landing page", async ({ page }) => {
  await page.goto("/this-page-does-not-exist");
  await page.waitForURL("**/");
  await expect(page.getByText("Weave every page.")).toBeVisible();
});
