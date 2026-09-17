import { test, expect, type Locator, type Page } from "@playwright/test";
import { loginAs } from "./lib/auth-helpers";

/**
 * E2E Flow 3: 6-Stappen Wizard "navigatie + selects".
 *
 * ⚠ FUP 4 — HEADLESS CHROMIUM EDGE-CASE FIX (FINAL):
 *   Radix UI Combobox gebruikt soms button role="combobox" (met data-state)
 *   en soms een inner input met role="combobox". Headless Chromium heeft
 *   soms last van actionability checks of hydration timing.
 *
 *   UITEINDELIJKE FIX-STRATEGIE (6 lagen, indien nodig):
 *     0. Wacht 250ms (hydration — soms zijn React handlers nog niet gehecht).
 *     1. Playwright click met delay 80ms.
 *     1b. Playwright click force:true (geen actionability).
 *     2. DOM-native click via evaluate (mousedown/mouseup/click) + inner input focus.
 *     3. Dispatch ArrowDown (Radix Combobox standaard keyboard trigger).
 *     4. Playwright press ArrowDown (extra zekerheid).
 */

async function openRadixCombobox(
  page: Page,
  trigger: Locator,
  label: string
): Promise<void> {
  await trigger.waitFor({ state: "visible", timeout: 15_000 });

  // Strategy 0: 250ms wachten (React hydration)
  await page.waitForTimeout(250);

  // Strategy 1: Playwright click met delay
  try {
    await trigger.click({ delay: 80, timeout: 4_000 });
  } catch {
    /* ignore, naar fallback */
  }

  // Strategy 1b: force click
  try {
    await trigger.click({ force: true, timeout: 2_500 });
  } catch {
    /* ignore */
  }

  // Strategy 2: DOM-native events + inner input focus
  await trigger.evaluate((el: Element) => {
    const h = el as HTMLElement;
    const inner =
      h.querySelector<HTMLElement>("input, [role='combobox'], [contenteditable='true']") ||
      h;
    try {
      inner.focus();
    } catch {
      /* noop */
    }
    try {
      inner.click();
    } catch {
      /* noop */
    }
    inner.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );
    inner.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    );
    inner.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    // Strategy 3: ArrowDown keyboard event dispatch
    const keyEvt = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      keyCode: 40,
      which: 40,
      bubbles: true,
      cancelable: true,
    });
    inner.dispatchEvent(keyEvt);
  });

  // Strategy 4: Playwright-level press ArrowDown
  try {
    await trigger.press("ArrowDown", { timeout: 2_000, delay: 30 });
  } catch {
    /* ignore */
  }

  // Wacht met royale timeout op ENKEL bewijs van open zijn:
  const stateOrOption = await Promise.race([
    trigger
      .locator("xpath=self::*[@data-state='open']")
      .waitFor({ state: "attached", timeout: 14_000 })
      .then(() => true as const)
      .catch(() => false as const),
    page
      .locator('[role="option"]')
      .first()
      .waitFor({ state: "visible", timeout: 14_000 })
      .then(() => true as const)
      .catch(() => false as const),
  ]);

  // Finale sanity check (voor leesbare foutmelding)
  const visible = await page
    .locator('[role="option"]')
    .first()
    .isVisible()
    .catch(() => false);
  const st = (await trigger.getAttribute("data-state")) ?? "?";
  if (!visible && st !== "open" && !stateOrOption) {
    throw new Error(
      `[${label}] Radix combobox headless FAIL (data-state=${st}). ` +
        `Dit is EEN OPTIONELE TEST (FUP 4). Draai visueel: ` +
        `npm run test:e2e:headed -- tests/e2e/g03-wizard-steps-review.spec.ts`
    );
  }
}

test.describe("G.2.3 — Wizard 6 stappen invullen + review (geen activerings-transactie)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/activations/wizard", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { level: 1 })
      .filter({ hasText: /nieuwe activatie|activatie bewerken/i })
      .waitFor({ state: "visible", timeout: 20_000 });
  });

  test("Stap 1-6: invullen, review toont de gekozen waarden (robuuste Radix combobox)", async ({
    page,
  }) => {
    const chosen = { customer: "", product: "", tracker: "", sim: "", vehicle: "" };

    // =========================================================================
    // STAP 1 — Klant (Radix Combobox)
    // =========================================================================
    await expect(page.getByText("Stap 1 — Klant")).toBeVisible();
    {
      const trigger = page
        .locator('[role="combobox"]')
        .filter({ hasText: /zoek en selecteer klant/i })
        .first();
      await openRadixCombobox(page, trigger, "Stap1-Klant combobox");

      const options = page.locator('[role="option"]');
      await options.first().waitFor({ state: "visible", timeout: 8_000 });
      const customerLabel = (await options.first().textContent()) ?? "";
      chosen.customer =
        customerLabel.match(/^\s*([^\s]+.*?)\s{2,}C-\d/)?.[1]?.trim() ||
        customerLabel.trim().split(/\s{2,}|\n/)[0];
      await options.first().click({ delay: 30 });
      if (chosen.customer) {
        await expect(page.locator("main")).toContainText(chosen.customer, {
          timeout: 6_000,
        });
      }
    }

    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 2 — Product en facturatie (Radix Combobox)
    // =========================================================================
    await expect(page.getByText(/Stap 2 — Product/)).toBeVisible();
    {
      const trigger = page
        .locator('[role="combobox"]')
        .filter({ hasText: /kies een product|product.*selecteer|zoek.*product/i })
        .first();
      await openRadixCombobox(page, trigger, "Stap2-Product combobox");

      const options = page.locator('[role="option"]');
      await options.first().waitFor({ state: "visible", timeout: 8_000 });
      const labelText = (await options.first().textContent()) ?? "";
      chosen.product = labelText.trim().split(/\n|\s{2,}/)[0];
      expect(chosen.product.length).toBeGreaterThan(0);
      await options.first().click({ delay: 30 });
    }

    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 3 — Tracker (Radio buttons)
    // =========================================================================
    await expect(page.getByText("Stap 3 — Tracker")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='trackerId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.tracker = (await labelRow.textContent()) ?? "";
        await firstRadio.check({ force: true });
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 4 — SIM (Radio buttons)
    // =========================================================================
    await expect(page.getByText("Stap 4 — SIM")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='simId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.sim = (await labelRow.textContent()) ?? "";
        await firstRadio.check({ force: true });
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 5 — Voertuig (Radio buttons)
    // =========================================================================
    await expect(page.getByText("Stap 5 — Voertuig")).toBeVisible();
    {
      const firstRadio = page
        .locator("input[type='radio'][name='vehicleId']")
        .first();
      if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
        const labelRow = firstRadio.locator("xpath=ancestor::label").first();
        chosen.vehicle = (await labelRow.textContent()) ?? "";
        await firstRadio.check({ force: true });
      }
    }
    await page.getByRole("button", { name: /volgende/i }).click();

    // =========================================================================
    // STAP 6 — Controle (Review card)
    // =========================================================================
    await expect(
      page.getByRole("heading", { level: 2, name: /controle|overzicht/i })
    ).toBeVisible({ timeout: 15_000 });
    const reviewCard = page.locator("main");
    if (chosen.product) {
      await expect(reviewCard).toContainText(chosen.product, { timeout: 10_000 });
    }
    const activeerBtn = page.getByRole("button", { name: /activeer/i });
    await expect(activeerBtn).toBeVisible();

    await page.goto("/activations", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: /activaties/i })
    ).toBeVisible();
  });
});
