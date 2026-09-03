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
    // Explicit IPv4 loopback, matching vite.config.ts's server.host — see
    // the comment there for why "localhost" on its own isn't safe to rely
    // on (it resolves to whatever the OS/Node prefers at that moment,
    // observed to vary between IPv4 and IPv6-only run to run).
    baseURL: "http://127.0.0.1:5173",
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
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
