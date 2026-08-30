import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser e2e suite over PDFLoom's core golden paths. Runs against a
 * dev server Playwright starts itself (reuses one already running locally,
 * e.g. during active development). AI-model tests genuinely download and
 * run a local model on first execution — see ai-summarize.spec.ts — so
 * they carry their own generous per-test timeouts rather than a blanket one.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
