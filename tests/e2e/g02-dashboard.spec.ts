import { test, expect } from "@playwright/test";
import { loginAs } from "./lib/auth-helpers";

/**
 * E2E Flow 2: Dashboard layout
 * Doel: bevestigen dat nadat we als ADMIN ingelogd zijn:
 *   a) H1 "Dashboard" bestaat
 *   b) "Recente activaties" H2 bestaat + Tabel rij met min. 1 order (ACT- of CLI-TEST-)
 *   c) Stat-card "Actieve abonnementen" bevat euro-teken en een aantal
 *   d) Sidebar toont Dashboard direct + 4 ingeklapte categorieën met alle originele item-links
 *
 * De waardes worden NIET exact afgetoetst (seed kan verschillen na CLI tests).
 * We checken alleen HEURISTIEKEN zodat test niet flaky is.
 */
test.describe("G.2.2 — Dashboard smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("H1 + Recente activaties tabel (minimaal 1 order rij) + gegroepeerde sidebar", async ({ page }) => {
    // a) H1
    await expect(page.getByRole("heading", { level: 1, name: /dashboard/i })).toBeVisible();

    // b) H2 Recente activaties + tabelrij met (ACT- of CLI-TEST-)
    await expect(page.getByRole("heading", { level: 2, name: /recente activaties/i })).toBeVisible();
    // Zoek 1 zichtbare order-link (bevat bijv. ACT-2026-000001 of CLI-TEST-1789...)
    const orderLink = page.getByRole("link", { name: /^(ACT|CLI-TEST)-/ });
    await expect(orderLink.first()).toBeVisible();

    // c) Actieve abonnementen card: bevat € (euro) en een digit
    const subCard = page.getByRole("link", { name: /actieve abonnementen/i });
    await expect(subCard).toBeVisible();
    const subCardText = (await subCard.textContent()) ?? "";
    expect(subCardText).toMatch(/€/);
    expect(subCardText).toMatch(/\d/);

    // d) Sidebar: Dashboard direct bereikbaar, categorieën gegroepeerd en standaard ingeklapt
    const nav = page.locator("nav").first();
    const groupLabels = ["Klantbeheer", "SIM & Data", "Commercieel", "Beheer"];
    for (const label of groupLabels) {
      const toggle = nav.getByRole("button", { name: label, exact: true });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await expect(nav.locator("a").filter({ hasText: /^dashboard$/i }).first()).toBeVisible();

    // e) Uitklappen: alle originele menu-items blijven bereikbaar (max. 2 klikken)
    for (const label of groupLabels) {
      await nav.getByRole("button", { name: label, exact: true }).click();
    }
    for (const label of [
      /^dashboard$/i,
      /klanten/i,
      /trackers/i,
      /sim[- ]kaarten/i,
      /voertuigen/i,
      /producten/i,
      /abonnementen/i,
      /activaties/i,
      /gebruikers/i,
      /auditlog/i,
      /instellingen/i,
    ]) {
      await expect(nav.locator("a").filter({ hasText: label }).first()).toBeVisible();
    }
  });
});
