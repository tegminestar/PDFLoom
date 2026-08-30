import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, "fixtures");

/**
 * Opens a PDF via the welcome screen's drop zone — a synthetic `drop` event
 * carrying a real File, not the native file picker (which the File System
 * Access API implementation opens as an unautomatable OS dialog).
 */
export async function openPdf(page: Page, fixtureName: string): Promise<void> {
  const buf = await readFile(path.join(FIXTURES_DIR, fixtureName));
  const dataTransfer = await page.evaluateHandle(
    ({ base64, name }) => {
      const dt = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], name, { type: "application/pdf" }));
      return dt;
    },
    { base64: buf.toString("base64"), name: fixtureName },
  );
  await page
    .locator("text=Drop a PDF here")
    .locator("xpath=ancestor::div[contains(@class,'border-dashed')]")
    .dispatchEvent("drop", { dataTransfer });
  await page.waitForSelector("canvas", { timeout: 15000 });
  await page.waitForTimeout(500);
}
