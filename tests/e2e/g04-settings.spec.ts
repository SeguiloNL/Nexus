import { test, expect } from "@playwright/test";
import { loginAs } from "./lib/auth-helpers";

/**
 * E2E Flow 4: Instellingen-pagina (P2.5)
 *
 * Doel: bevestigen dat de /settings pagina werkt voor ADMIN, inclusief
 *   - 3 API-koppeling formulieren (Inserve, Simhuis, Navixy)
 *   - 3x "Verbinding testen" knoppen
 *   - 3x "Opslaan" knoppen
 *   - Source indicaties (badges: Database/.env/Niet geconfigureerd)
 *   - 4 info-cards: Systeeminformatie, Beveiliging, Database, Notificaties
 *
 * Robuuste selectors: we gebruiken GEEN heading-level of class-naam restricties,
 * want die veranderen vaak tussen shadcn/ui versies. Alleen hasText + role=button.
 */
test.describe("G.2.4 — Instellingen (Settings) smoke", () => {
  test.describe("ADMIN", () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, "admin");
    });

    test("ADMIN → /settings: 3 API-koppeling cards + 4 info-cards zichtbaar", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      expect(page.url()).toMatch(/\/settings$/);

      // 1. H1: Instellingen
      await expect(page.getByText(/^instellingen$/i).first()).toBeVisible();

      // 2. 3 API-koppeling titels (Case Insensitive)
      for (const title of ["Inserve API-koppeling", "Simhuis API-koppeling", "Navixy API-koppeling"]) {
        const loc = page.getByText(new RegExp(`^${title}$`, "i")).first();
        await expect(loc).toBeVisible({ timeout: 12_000 });
      }

      // 3. Info-card headers (4 stuks)
      for (const heading of [
        "Systeeminformatie",
        "Beveiliging",
        "Database",
        "Notificaties",
      ]) {
        await expect(
          page.getByText(new RegExp(`^${heading}$`, "i")).first()
        ).toBeVisible();
      }
    });

    test("ADMIN → /settings: Source-badges + 3× verbinding-testen + 3× opslaan", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });

      // 1. Source-badges: per integratie 1. We zoeken gewoon naar de tekst,
      //    zonder class/attribute restricties (werkte in run #1 ook).
      const allowedRe =
        /(Database \(WebGUI\)|Omgevingsvariabelen \(\.env\)|Niet geconfigureerd)/i;
      const anyBadgeText = page.locator("body *").filter({ hasText: allowedRe });
      await expect(anyBadgeText.first()).toBeVisible({ timeout: 12_000 });

      // 2. "Verbinding testen" knoppen: 3 stuks
      const testButtons = page.getByRole("button", {
        name: /verbinding testen/i,
      });
      await expect(testButtons).toHaveCount(3, { timeout: 12_000 });

      // 3. "Opslaan" knoppen: 3 stuks
      const saveButtons = page.getByRole("button", { name: /^opslaan$/i });
      await expect(saveButtons).toHaveCount(3);

      // 4. Systeem info: Applicatie en Versie velden bestaan
      await expect(page.getByText(/^applicatie$/i).first()).toBeVisible();
      await expect(page.getByText(/^versie$/i).first()).toBeVisible();
    });
  });

  test.describe("EMPLOYEE (readOnly modus) — FUP: employee view:setting vanaf vandaag", () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, "employee");
    });

    test("EMPLOYEE → /settings: 3× readOnly-melding + 0× Opslaan + 3× Verbinding-testen", async ({
      page,
    }) => {
      await page.goto("/settings", { waitUntil: "domcontentloaded" });

      // Employee heeft view:setting (vanaf FUP2) maar GEEN edit:setting → readOnly mode.
      const readOnlyMeldingen = page
        .getByText(/alleen .*beheerders.* kunnen .* api-instellingen wijzigen/i);
      await expect(readOnlyMeldingen).toHaveCount(3, { timeout: 12_000 });

      // Geen "Opslaan" knoppen
      const saveButtons = page.getByRole("button", { name: /^opslaan$/i });
      await expect(saveButtons).toHaveCount(0);

      // Wel "Verbinding testen" knoppen (view:setting is voldoende)
      const testButtons = page.getByRole("button", { name: /verbinding testen/i });
      await expect(testButtons).toHaveCount(3);

      // Info-cards + API-card titels moeten ook zichtbaar zijn.
      await expect(page.getByText(/^systeeminformatie$/i).first()).toBeVisible();
      for (const title of [
        "Inserve API-koppeling",
        "Simhuis API-koppeling",
        "Navixy API-koppeling",
      ]) {
        await expect(
          page.getByText(new RegExp(`^${title}$`, "i")).first()
        ).toBeVisible();
      }
    });
  });
});
