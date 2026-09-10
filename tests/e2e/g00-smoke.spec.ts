import { test, expect } from "@playwright/test";

test("G.0 — Smoke: /login toont Nexus H1 (geen auth)", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const h1 = page.getByRole("heading", { level: 1 }).filter({ hasText: /nexus/i });
  await expect(h1).toBeVisible();
  await expect(page.locator("h2").filter({ hasText: /inloggen/i })).toBeVisible();
});
