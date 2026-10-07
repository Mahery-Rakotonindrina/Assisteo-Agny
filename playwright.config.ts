import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a production build in demo mode (no AI calls,
// deterministic answers). Locally they use the installed Edge; CI installs
// Playwright's Chromium.
const PORT = 3200;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fr-FR",
    trace: "retain-on-failure",
    ...(ci ? {} : { channel: "msedge" }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...(ci ? {} : { channel: "msedge" }) } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...(ci ? {} : { channel: "msedge" }) } },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { AI_DEMO_MODE: "true" },
  },
});
