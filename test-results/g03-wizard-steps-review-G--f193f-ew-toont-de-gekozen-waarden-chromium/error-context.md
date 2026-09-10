# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: g03-wizard-steps-review.spec.ts >> G.2.3 — Wizard 6 stappen invullen + review (geen activerings-transactie) >> Stap 1-6: invullen, review toont de gekozen waarden
- Location: tests/e2e/g03-wizard-steps-review.spec.ts:29:3

# Error details

```
TimeoutError: locator.waitFor: Timeout 12000ms exceeded.
Call log:
  - waiting for locator('[role="option"]').first() to be visible

```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e2]:
    - complementary [ref=f1e3]:
      - generic [ref=f1e4]:
        - generic [ref=f1e5]: "N"
        - generic [ref=f1e6]:
          - generic [ref=f1e7]: Nexus
          - generic [ref=f1e8]: Subscription & Activation Manager
      - navigation [ref=f1e9]:
        - link "Dashboard" [ref=f1e10] [cursor=pointer]:
          - /url: /dashboard
        - link "Klanten" [ref=f1e17] [cursor=pointer]:
          - /url: /customers
        - link "Trackers" [ref=f1e24] [cursor=pointer]:
          - /url: /trackers
        - link "SIM-kaarten" [ref=f1e29] [cursor=pointer]:
          - /url: /sims
        - link "Voertuigen" [ref=f1e33] [cursor=pointer]:
          - /url: /vehicles
        - link "Producten" [ref=f1e39] [cursor=pointer]:
          - /url: /products
        - link "Abonnementen" [ref=f1e47] [cursor=pointer]:
          - /url: /subscriptions
        - link "Activaties" [ref=f1e52] [cursor=pointer]:
          - /url: /activations
        - link "Gebruikers" [ref=f1e57] [cursor=pointer]:
          - /url: /users
        - link "Auditlog" [ref=f1e64] [cursor=pointer]:
          - /url: /audit-log
        - link "Instellingen" [ref=f1e70] [cursor=pointer]:
          - /url: /settings
    - generic [ref=f1e75]:
      - banner [ref=f1e76]:
        - link "Zoeken ⌘K" [ref=f1e78] [cursor=pointer]:
          - /url: /search
          - generic [ref=f1e79]: Zoeken
          - generic [ref=f1e80]: ⌘K
        - generic [ref=f1e81]:
          - generic [ref=f1e82]: Beheerder
          - button "A Administrator admin@nexus.local" [ref=f1e85] [cursor=pointer]:
            - generic [ref=f1e86]: A
            - generic [ref=f1e87]:
              - generic [ref=f1e88]: Administrator
              - generic [ref=f1e89]: admin@nexus.local
      - main [ref=f1e90]:
        - generic [ref=f1e91]:
          - generic [ref=f1e92]:
            - generic [ref=f1e93]:
              - link "Terug" [ref=f1e94] [cursor=pointer]:
                - /url: /activations
              - generic [ref=f1e95]:
                - heading "Nieuwe activatie" [level=1] [ref=f1e96]
                - paragraph [ref=f1e97]: Klant, product en assets selecteren, dan activeren.
            - button "Opslaan als concept" [ref=f1e99] [cursor=pointer]
          - navigation "Stappen" [ref=f1e100]:
            - list [ref=f1e101]:
              - listitem [ref=f1e102]:
                - 'button "Stap 1: Klant Kies een klant." [ref=f1e103] [cursor=pointer]':
                  - generic [ref=f1e107]:
                    - generic [ref=f1e108]: "Stap 1:"
                    - text: Klant
                  - generic [ref=f1e109]: Kies een klant.
              - listitem [ref=f1e110]:
                - 'button "Stap 2: Product Kies product." [ref=f1e111] [cursor=pointer]':
                  - generic [ref=f1e115]:
                    - generic [ref=f1e116]: "Stap 2:"
                    - text: Product
                  - generic [ref=f1e117]: Kies product.
              - listitem [ref=f1e118]:
                - 'button "Stap 3: Tracker Kies tracker (IN_STOCK/RESERVED)." [ref=f1e119] [cursor=pointer]':
                  - generic [ref=f1e123]:
                    - generic [ref=f1e124]: "Stap 3:"
                    - text: Tracker
                  - generic [ref=f1e125]: Kies tracker (IN_STOCK/RESERVED).
              - listitem [ref=f1e126]:
                - 'button "Stap 4: SIM Kies SIM (IN_STOCK/RESERVED)." [ref=f1e127] [cursor=pointer]':
                  - generic [ref=f1e131]:
                    - generic [ref=f1e132]: "Stap 4:"
                    - text: SIM
                  - generic [ref=f1e133]: Kies SIM (IN_STOCK/RESERVED).
              - listitem [ref=f1e134]:
                - 'button "Stap 5: Voertuig" [ref=f1e135] [cursor=pointer]':
                  - generic [ref=f1e142]:
                    - generic [ref=f1e143]: "Stap 5:"
                    - text: Voertuig
              - listitem [ref=f1e144]:
                - 'button "Stap 6: Controle" [ref=f1e145] [cursor=pointer]':
                  - generic [ref=f1e151]:
                    - generic [ref=f1e152]: "Stap 6:"
                    - text: Controle
          - generic [ref=f1e154]:
            - generic [ref=f1e155]:
              - generic [ref=f1e156]: Stap 1 — Klant
              - generic [ref=f1e157]: Kies een hoofdklant en optioneel een subklant.
            - generic [ref=f1e158]:
              - generic [ref=f1e159]:
                - text: Hoofdklant *
                - combobox [active] [ref=f1e160] [cursor=pointer]:
                  - generic: Zoek en selecteer klant...
              - generic [ref=f1e163]:
                - text: Subklant (optioneel)
                - combobox [disabled] [ref=f1e164]:
                  - generic: Kies eerst hoofdklant
          - generic [ref=f1e167]:
            - button "Vorige" [disabled]
            - generic [ref=f1e168]: Stap 1 van 6
            - button "Volgende" [ref=f1e169] [cursor=pointer]
    - region "Notifications alt+T"
  - alert [ref=f1e170]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | import { loginAs } from "./lib/auth-helpers";
  3   | 
  4   | /**
  5   |  * E2E Flow 3: 6-Stappen Wizard "navigatie + selects".
  6   |  *
  7   |  * Belangrijk (ON ACHTBAAR):
  8   |  *   - Deze test doet GEEN werkelijke "Activeer nu" transactie, want dat
  9   |  *     verbruikt IN_STOCK assets (maakt test flaky na 1 run).
  10  |  *   - In plaats daarvan lopen we STAPPEN 1 t/m 6 door:
  11  |  *     • Vul klant (Stap 1), product (Stap 2), tracker (Stap 3), sim (Stap4),
  12  |  *       voertuig (Stap 5) in via de UI,
  13  |  *     • Op Stap 6 VALIDEREN we dat Review card alle keuzes TOONT
  14  |  *       (bevestigd met RegExp textContent op die card).
  15  |  *     • Daarna navigeren we TERUG naar /activations ZONDER activeren.
  16  |  *   - Resultaat: test is idempotent; meerdere runs achter elkaar zijn OK.
  17  |  */
  18  | test.describe("G.2.3 — Wizard 6 stappen invullen + review (geen activerings-transactie)", () => {
  19  |   test.beforeEach(async ({ page }) => {
  20  |     await loginAs(page, "admin");
  21  |     await page.goto("/activations/wizard", { waitUntil: "domcontentloaded" });
  22  |     // Wizard H1 = "Nieuwe activatie" (of "Activatie bewerken" wanneer initialOrder gevuld)
  23  |     await page
  24  |       .getByRole("heading", { level: 1 })
  25  |       .filter({ hasText: /nieuwe activatie|activatie bewerken/i })
  26  |       .waitFor({ state: "visible", timeout: 20_000 });
  27  |   });
  28  | 
  29  |   test("Stap 1-6: invullen, review toont de gekozen waarden", async ({ page }) => {
  30  |     const chosen = { customer: "", product: "", tracker: "", sim: "", vehicle: "" };
  31  | 
  32  |     // =========================================================================
  33  |     // STAP 1 — Klant
  34  |     // =========================================================================
  35  |     await expect(page.getByText("Stap 1 — Klant")).toBeVisible();
  36  |     {
  37  |       // Het is GEEN input-search, maar een Radix UI <button role="combobox">
  38  |       // (data-state="closed"). Klikken opent de options-popover direct.
  39  |       const trigger = page
  40  |         .locator('[role="combobox"]')
  41  |         .filter({ hasText: /zoek en selecteer klant/i })
  42  |         .first();
  43  |       await trigger.waitFor({ state: "visible", timeout: 10_000 });
  44  |       await trigger.click();
  45  |       const options = page.locator('[role="option"]');
> 46  |       await options.first().waitFor({ state: "visible", timeout: 12_000 });
      |                             ^ TimeoutError: locator.waitFor: Timeout 12000ms exceeded.
  47  |       const customerLabel = (await options.first().textContent()) ?? "";
  48  |       chosen.customer = customerLabel
  49  |         .match(/^\s*([^\s]+.*?)\s{2,}C-\d/)?.[1]
  50  |         ?.trim() || customerLabel.trim().split(/\s{2,}/)[0];
  51  |       await options.first().click();
  52  |       await expect(page.locator("main")).toContainText(chosen.customer);
  53  |     }
  54  | 
  55  |     // Volgende → Stap 2
  56  |     await page.getByRole("button", { name: /volgende/i }).click();
  57  | 
  58  |     // =========================================================================
  59  |     // STAP 2 — Product en facturatie
  60  |     // =========================================================================
  61  |     await expect(page.getByText(/Stap 2 — Product/)).toBeVisible();
  62  |     {
  63  |       // Ook Stap 2 Product is Radix <button role="combobox"> (geen input search)
  64  |       const trigger = page
  65  |         .locator('[role="combobox"]')
  66  |         .filter({ hasText: /kies een product|product.*selecteer/i })
  67  |         .first();
  68  |       await trigger.waitFor({ state: "visible", timeout: 10_000 });
  69  |       await trigger.click();
  70  |       const options = page.locator('[role="option"]');
  71  |       await options.first().waitFor({ state: "visible", timeout: 12_000 });
  72  |       const labelText = (await options.first().textContent()) ?? "";
  73  |       chosen.product = labelText.trim().split(/\n|\s{2,}/)[0];
  74  |       expect(chosen.product.length).toBeGreaterThan(0);
  75  |       await options.first().click();
  76  |     }
  77  |     await page.getByRole("button", { name: /volgende/i }).click();
  78  | 
  79  |     // =========================================================================
  80  |     // STAP 3 — Tracker
  81  |     // =========================================================================
  82  |     await expect(page.getByText("Stap 3 — Tracker")).toBeVisible();
  83  |     {
  84  |       const firstRadio = page
  85  |         .locator("input[type='radio'][name='trackerId']")
  86  |         .first();
  87  |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  88  |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  89  |         chosen.tracker = (await labelRow.textContent()) ?? "";
  90  |         await firstRadio.check();
  91  |       }
  92  |     }
  93  |     await page.getByRole("button", { name: /volgende/i }).click();
  94  | 
  95  |     // =========================================================================
  96  |     // STAP 4 — SIM
  97  |     // =========================================================================
  98  |     await expect(page.getByText("Stap 4 — SIM")).toBeVisible();
  99  |     {
  100 |       const firstRadio = page
  101 |         .locator("input[type='radio'][name='simId']")
  102 |         .first();
  103 |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  104 |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  105 |         chosen.sim = (await labelRow.textContent()) ?? "";
  106 |         await firstRadio.check();
  107 |       }
  108 |     }
  109 |     await page.getByRole("button", { name: /volgende/i }).click();
  110 | 
  111 |     // =========================================================================
  112 |     // STAP 5 — Voertuig
  113 |     // =========================================================================
  114 |     await expect(page.getByText("Stap 5 — Voertuig")).toBeVisible();
  115 |     {
  116 |       const firstRadio = page
  117 |         .locator("input[type='radio'][name='vehicleId']")
  118 |         .first();
  119 |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  120 |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  121 |         chosen.vehicle = (await labelRow.textContent()) ?? "";
  122 |         await firstRadio.check();
  123 |       }
  124 |     }
  125 |     await page.getByRole("button", { name: /volgende/i }).click();
  126 | 
  127 |     // =========================================================================
  128 |     // STAP 6 — Controle (Review card)
  129 |     // =========================================================================
  130 |     await expect(page.getByRole("heading", { level: 2, name: /controle|overzicht/i })).toBeVisible();
  131 |     const reviewCard = page.locator("main");
  132 |     if (chosen.product) {
  133 |       await expect(reviewCard).toContainText(chosen.product, { timeout: 10_000 });
  134 |     }
  135 |     const activeerBtn = page.getByRole("button", { name: /activeer/i });
  136 |     await expect(activeerBtn).toBeVisible();
  137 | 
  138 |     await page.goto("/activations", { waitUntil: "domcontentloaded" });
  139 |     await expect(page.getByRole("heading", { level: 1, name: /activaties/i })).toBeVisible();
  140 |   });
  141 | });
  142 | 
```