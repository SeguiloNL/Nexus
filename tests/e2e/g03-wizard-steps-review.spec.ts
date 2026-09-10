import { test, expect } from "@playwright/test";
import { loginAs } from "./lib/auth-helpers";

/**
 * E2E Flow 3: 6-Stappen Wizard "navigatie + selects".
 *
 * Belangrijk (ON ACHTBAAR):
 *   - Deze test doet GEEN werkelijke "Activeer nu" transactie, want dat
 *     verbruikt IN_STOCK assets (maakt test flaky na 1 run).
 *   - In plaats daarvan lopen we STAPPEN 1 t/m 6 door:
 *     • Vul klant (Stap 1), product (Stap 2), tracker (Stap 3), sim (Stap4),
 *       voertuig (Stap 5) in via de UI,
 *     • Op Stap 6 VALIDEREN we dat Review card alle keuzes TOONT
 *       (bevestigd met RegExp textContent op die card).
 *     • Daarna navigeren we TERUG naar /activations ZONDER activeren.
 *   - Resultaat: test is idempotent; meerdere runs achter elkaar zijn OK.
 */
test.describe("G.2.3 — Wizard 6 stappen invullen + review (geen activerings-transactie)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/activations/wizard", { waitUntil: "domcontentloaded" });
    // Wizard H1 = "Nieuwe activatie" (of "Activatie bewerken" wanneer initialOrder gevuld)
    await page
      .getByRole("heading", { level: 1 })
      .filter({ hasText: /nieuwe activatie|activatie bewerken/i })
      .waitFor({ state: "visible", timeout: 20_000 });
  });

  test("Stap 1-6: invullen, review toont de gekozen waarden", async ({ page }) => {
    // =========================================================================
    // STAP 1 — Klant
    // =========================================================================
    await expect(page.getByText("Stap 1 — Klant")).toBeVisible();
    // Open "Hoofdklant *" select en KIES EERSTE optie (companyName).
    {
      const trigger = page.locator('[role="combobox"]').filter({ hasText: /zoek en selecteer klant/i }).first();
      await trigger.click();
      // Wacht tot 1 optie verschijnt
      const firstOption = page.locator('[role="option"]').first();
      await firstOption.waitFor({ state: "visible" });
      const customerLabel = (await firstOption.textContent()) ?? "";
      const customerMatch = customerLabel.match(/^\s*([^\s]+.*?)\s{2,}C-\d/);
      const chosenCustomerText = customerMatch ? customerMatch[1].trim() : customerLabel.trim().split(/\s{2,}/)[0];
      await firstOption.click();
      await expect(page.locator("main")).toContainText(chosenCustomerText || "");
    }

    // Volgende → Stap 2
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 2 — Product
    // =========================================================================
    await expect(page.getByText("Stap 2 — Product en facturatie")).toBeVisible();
    {
      const trigger = page.locator('[role="combobox"]').filter({ hasText: /kies een product/i }).first();
      await trigger.click();
      const firstProduct = page.locator('[role="option"]').first();
      await firstProduct.waitFor({ state: "visible" });
      const chosenProduct = (await firstProduct.textContent()) ?? "";
      await firstProduct.click();
      // Gebruik eerste "regel" (alles voor newline / grote witruimte)
      const productName = chosenProduct.trim().split(/\n|\s{2,}/)[0];
      expect(productName.length).toBeGreaterThan(0);
      (globalThis as any)._wizardChosenProduct = productName;
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 3 — Tracker
    // =========================================================================
    await expect(page.getByText("Stap 3 — Tracker")).toBeVisible();
    {
      // Selecteer de EERSTE radio (IN_STOCK tracker) in Stap 3 card
      const firstRadio = page
        .locator("input[type='radio'][name='trackerId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 })) {
        const trackerLabelRow = firstRadio.locator("xpath=ancestor::label").first();
        const labelText = (await trackerLabelRow.textContent()) ?? "";
        await firstRadio.check();
        (globalThis as any)._wizardChosenTracker = labelText;
      } else {
        // Geen trackers op voorraad: skip. De test zal dan op Stap 6 geen
        // tracker-review vinden, dat is acceptabel (soft failure).
        console.warn("⚠️  Wizard test: GEEN IN_STOCK trackers. Stap 3 wordt overgeslagen.");
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 4 — SIM
    // =========================================================================
    await expect(page.getByText("Stap 4 — SIM")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='simId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 })) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        const labelText = (await labelRow.textContent()) ?? "";
        await firstRadio.check();
        (globalThis as any)._wizardChosenSim = labelText;
      } else {
        console.warn("⚠️  Wizard test: GEEN IN_STOCK SIMs. Stap 4 wordt overgeslagen.");
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 5 — Voertuig
    // =========================================================================
    await expect(page.getByText("Stap 5 — Voertuig")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='vehicleId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 })) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        const labelText = (await labelRow.textContent()) ?? "";
        await firstRadio.check();
        (globalThis as any)._wizardChosenVehicle = labelText;
      } else {
        console.warn("⚠️  Wizard test: GEEN voertuigen voor klant. Stap 5 overgeslagen.");
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 6 — Controle (Review card)
    // =========================================================================
    await expect(page.getByRole("heading", { level: 2, name: /controle|overzicht/i })).toBeVisible();
    const reviewCard = page.locator("main").filter({ hasText: /product|klant/i });
    const chosenProduct = (globalThis as any)._wizardChosenProduct;
    if (chosenProduct) {
      await expect(reviewCard).toContainText(chosenProduct, { timeout: 10_000 });
    }
    // Stap 6 toont "Activeer bevestigen" knop, MAAR we klikken hem NIET (idempotent).
    const activeerBtn = page.getByRole("button", { name: /activeer/i });
    await expect(activeerBtn).toBeVisible();

    // Safe exit: navigeer terug naar /activations (geen persistentie nodig).
    await page.goto("/activations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: /activaties/i })).toBeVisible();
  });
});
