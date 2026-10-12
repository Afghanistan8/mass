import { defineConfig, devices } from "@playwright/test";

// E2E runs against `next dev` (NODE_ENV=development) because the wallet/data test seam
// (window.__MASS_E2E_MOCK__) is deliberately inert in production builds.
const PORT = 3101;

export default defineConfig({
  globalSetup: "./tests/e2e/warmup.ts",
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
