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

test("attach a file, see it listed with its size, download it, and confirm it survives a document reload", async ({ page }) => {
  await page.goto("/app");
  await openPdf(page, "sample.pdf");

  await page.getByLabel("Attachments", { exact: true }).click();
  await expect(page.getByText("Attachments").first()).toBeVisible();
  await expect(page.getByText("No files attached.")).toBeVisible();

  const fileInput = page.getByRole("complementary").locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from an attached file"),
  });
  await expect(page.getByText('Attached "notes.txt"').first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("notes.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("27 B")).toBeVisible(); // "hello from an attached file" is 27 bytes

  // Trigger and verify the actual download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("Download notes.txt", { exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes.txt");

  // Close and reopen the panel — this remounts it, forcing a fresh
  // doc.listAttachments() read straight off the mutated document's real
  // PDF structure (not a cached JS value), the same "re-render from the
  // in-memory bytes" persistence check annotate.spec.ts already relies on.
  await page.getByLabel("Attachments", { exact: true }).click();
  await page.getByLabel("Attachments", { exact: true }).click();
  await expect(page.getByText("notes.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("No files attached.")).toHaveCount(0);
});
