import { test, expect } from "@playwright/test";
import { loginAs } from "./lib/auth-helpers";

/**
 * E2E Flow 2: Dashboard layout
 * Doel: bevestigen dat nadat we als ADMIN ingelogd zijn:
 *   a) H1 "Dashboard" bestaat
 *   b) "Recente activaties" H2 bestaat + Tabel rij met min. 1 order (ACT- of CLI-TEST-)
 *   c) Stat-card "Actieve abonnementen" bevat euro-teken en een aantal
 *   d) Alle 10 sidebar-menu links zijn aanwezig (Dashboard, Klanten, ..., Instellingen)
 *
 * De waardes worden NIET exact afgetoetst (seed kan verschillen na CLI tests).
 * We checken alleen HEURISTIEKEN zodat test niet flaky is.
 */
test.describe("G.2.2 — Dashboard smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("H1 + Recente activaties tabel (minimaal 1 order rij) + 10 sidebalkoppen", async ({ page }) => {
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

    // d) 10 sidebar links (Dashboard, Klanten, Trackers, SIM-kaarten, Voertuigen,
    //    Producten, Abonnementen, Activaties, Gebruikers, Auditlog, Instellingen)
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
      await expect(page.locator("nav a").filter({ hasText: label }).first()).toBeVisible();
    }
  });
});
