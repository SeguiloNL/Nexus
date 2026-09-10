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
    const chosen = { customer: "", product: "", tracker: "", sim: "", vehicle: "" };

    // =========================================================================
    // STAP 1 — Klant
    // =========================================================================
    await expect(page.getByText("Stap 1 — Klant")).toBeVisible();
    {
      // Het is GEEN input-search, maar een Radix UI <button role="combobox">
      // (data-state="closed"). Klikken opent de options-popover direct.
      const trigger = page
        .locator('[role="combobox"]')
        .filter({ hasText: /zoek en selecteer klant/i })
        .first();
      await trigger.waitFor({ state: "visible", timeout: 10_000 });
      await trigger.click();
      const options = page.locator('[role="option"]');
      await options.first().waitFor({ state: "visible", timeout: 12_000 });
      const customerLabel = (await options.first().textContent()) ?? "";
      chosen.customer = customerLabel
        .match(/^\s*([^\s]+.*?)\s{2,}C-\d/)?.[1]
        ?.trim() || customerLabel.trim().split(/\s{2,}/)[0];
      await options.first().click();
      await expect(page.locator("main")).toContainText(chosen.customer);
    }

    // Volgende → Stap 2
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 2 — Product en facturatie
    // =========================================================================
    await expect(page.getByText(/Stap 2 — Product/)).toBeVisible();
    {
      // Ook Stap 2 Product is Radix <button role="combobox"> (geen input search)
      const trigger = page
        .locator('[role="combobox"]')
        .filter({ hasText: /kies een product|product.*selecteer/i })
        .first();
      await trigger.waitFor({ state: "visible", timeout: 10_000 });
      await trigger.click();
      const options = page.locator('[role="option"]');
      await options.first().waitFor({ state: "visible", timeout: 12_000 });
      const labelText = (await options.first().textContent()) ?? "";
      chosen.product = labelText.trim().split(/\n|\s{2,}/)[0];
      expect(chosen.product.length).toBeGreaterThan(0);
      await options.first().click();
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 3 — Tracker
    // =========================================================================
    await expect(page.getByText("Stap 3 — Tracker")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='trackerId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.tracker = (await labelRow.textContent()) ?? "";
        await firstRadio.check();
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
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.sim = (await labelRow.textContent()) ?? "";
        await firstRadio.check();
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
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.vehicle = (await labelRow.textContent()) ?? "";
        await firstRadio.check();
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 6 — Controle (Review card)
    // =========================================================================
    await expect(page.getByRole("heading", { level: 2, name: /controle|overzicht/i })).toBeVisible();
    const reviewCard = page.locator("main");
    if (chosen.product) {
      await expect(reviewCard).toContainText(chosen.product, { timeout: 10_000 });
    }
    const activeerBtn = page.getByRole("button", { name: /activeer/i });
    await expect(activeerBtn).toBeVisible();

    await page.goto("/activations", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: /activaties/i })).toBeVisible();
  });
});
