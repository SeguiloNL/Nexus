import { test, expect } from "@playwright/test";

test("G.0 — Smoke: /login toont STM H1 + Inloggen H2 (geen auth)", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // H1 = STM (project-hernoeming: Nexus → STM, H1 was zelfs eerder volledig afwezig)
  const h1 = page.getByRole("heading", { level: 1 }).filter({ hasText: /^stm$/i });
  await expect(h1).toBeVisible();
  // H2 = Inloggen
  await expect(page.locator("h2").filter({ hasText: /inloggen/i })).toBeVisible();
  // Bonus: Alt-tekst STM logo (toegankelijkheid)
  await expect(page.locator("img[alt='STM logo']")).toBeVisible();
});
