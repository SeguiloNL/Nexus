import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * Playwright E2E configuratie (Task 25 uit spec, optioneel)
 *
 * Setup:
 *   1. Dev server MOET reeds draaien op poort 3001:
 *        npx next dev -p 3001
 *   2. Playwright browsers installeren (indien nog niet gebeurd):
 *        npm run test:e2e:install
 *   3. Run tests:
 *        npm run test:e2e
 *        npm run test:e2e:headed   (met browser window zichtbaar)
 *
 * Base URL: http://localhost:3001 (volgens A→B→C→D flow in dit project)
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  outputDir: path.resolve(process.cwd(), "test-results"),
});
