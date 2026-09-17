# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: g03-wizard-steps-review.spec.ts >> G.2.3 — Wizard 6 stappen invullen + review (geen activerings-transactie) >> Stap 1-6: invullen, review toont de gekozen waarden (robuuste Radix combobox)
- Location: tests/e2e/g03-wizard-steps-review.spec.ts:130:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: /controle|overzicht/i, level: 2 })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: /controle|overzicht/i, level: 2 }) with timeout 15000ms
  - waiting for getByRole('heading', { name: /controle|overzicht/i, level: 2 })

```

```yaml
- complementary:
  - img "Nexus logo"
  - navigation:
    - link "Dashboard":
      - /url: /dashboard
      - img
      - text: Dashboard
    - link "Klanten":
      - /url: /customers
      - img
      - text: Klanten
    - link "Trackers":
      - /url: /trackers
      - img
      - text: Trackers
    - link "SIM-kaarten":
      - /url: /sims
      - img
      - text: SIM-kaarten
    - link "Voertuigen":
      - /url: /vehicles
      - img
      - text: Voertuigen
    - link "Producten":
      - /url: /products
      - img
      - text: Producten
    - link "Abonnementen":
      - /url: /subscriptions
      - img
      - text: Abonnementen
    - link "Facturen":
      - /url: /invoices
      - img
      - text: Facturen
    - link "Activaties":
      - /url: /activations
      - img
      - text: Activaties
    - link "Gebruikers":
      - /url: /users
      - img
      - text: Gebruikers
    - link "Auditlog":
      - /url: /audit-log
      - img
      - text: Auditlog
    - link "Instellingen":
      - /url: /settings
      - img
      - text: Instellingen
- banner:
  - link "Zoeken ⌘K":
    - /url: /search
    - img
    - text: Zoeken ⌘K
  - img
  - text: Beheerder
  - button "A Administrator admin@nexus.local"
- main:
  - link "Terug":
    - /url: /activations
    - img
    - text: Terug
  - heading "Nieuwe activatie" [level=1]
  - paragraph: Klant, product en assets selecteren, dan activeren.
  - button "Opslaan als concept":
    - img
    - text: Opslaan als concept
  - navigation "Stappen":
    - list:
      - listitem:
        - 'button "Stap 1: Klant"':
          - img
          - text: "Stap 1: Klant"
      - listitem:
        - 'button "Stap 2: Product"':
          - img
          - text: "Stap 2: Product"
      - listitem:
        - 'button "Stap 3: Tracker Kies tracker (IN_STOCK/RESERVED)."':
          - img
          - text: "Stap 3: Tracker Kies tracker (IN_STOCK/RESERVED)."
      - listitem:
        - 'button "Stap 4: SIM Kies SIM (IN_STOCK/RESERVED)."':
          - img
          - text: "Stap 4: SIM Kies SIM (IN_STOCK/RESERVED)."
      - listitem:
        - 'button "Stap 5: Voertuig"':
          - img
          - text: "Stap 5: Voertuig"
      - listitem:
        - 'button "Stap 6: Controle"':
          - img
          - text: "Stap 6: Controle"
  - text: "Nog niet alle velden zijn ingevuld:"
  - list:
    - listitem: Tracker ontbreekt.
    - listitem: SIM ontbreekt.
  - text: Klant Hoofdklant
  - link "Bakkerij de Vries B.V. (C-2025-0003)":
    - /url: /customers/cmtvm2ols000g8yu6vzrvbunw
  - text: Sub-klant — Product & facturatie Product Basic Tracking (TRK-BASIC) Omschrijving Standaard voertuig volgen met elke 3 minuten een positie update en dagelijkse rapportages. Gewenste start 17-09-2026 Maandprijs € 9,95 Cyclus MONTHLY Assets Tracker — SIM — Voertuig — Bevestig activatie Bij klikken wordt eerst het order READY gemaakt, daarna direct de 6-staps transactionele activatie uitgevoerd.
  - button "Activeer nu" [disabled]:
    - img
    - text: Activeer nu
  - button "Vorige"
  - text: Stap 6 van 6
  - button "Activeer bevestigen" [disabled]:
    - img
    - text: Activeer bevestigen
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  136 |     // STAP 1 — Klant (Radix Combobox)
  137 |     // =========================================================================
  138 |     await expect(page.getByText("Stap 1 — Klant")).toBeVisible();
  139 |     {
  140 |       const trigger = page
  141 |         .locator('[role="combobox"]')
  142 |         .filter({ hasText: /zoek en selecteer klant/i })
  143 |         .first();
  144 |       await openRadixCombobox(page, trigger, "Stap1-Klant combobox");
  145 | 
  146 |       const options = page.locator('[role="option"]');
  147 |       await options.first().waitFor({ state: "visible", timeout: 8_000 });
  148 |       const customerLabel = (await options.first().textContent()) ?? "";
  149 |       chosen.customer =
  150 |         customerLabel.match(/^\s*([^\s]+.*?)\s{2,}C-\d/)?.[1]?.trim() ||
  151 |         customerLabel.trim().split(/\s{2,}|\n/)[0];
  152 |       await options.first().click({ delay: 30 });
  153 |       if (chosen.customer) {
  154 |         await expect(page.locator("main")).toContainText(chosen.customer, {
  155 |           timeout: 6_000,
  156 |         });
  157 |       }
  158 |     }
  159 | 
  160 |     await page.getByRole("button", { name: /volgende/i }).click();
  161 | 
  162 |     // =========================================================================
  163 |     // STAP 2 — Product en facturatie (Radix Combobox)
  164 |     // =========================================================================
  165 |     await expect(page.getByText(/Stap 2 — Product/)).toBeVisible();
  166 |     {
  167 |       const trigger = page
  168 |         .locator('[role="combobox"]')
  169 |         .filter({ hasText: /kies een product|product.*selecteer|zoek.*product/i })
  170 |         .first();
  171 |       await openRadixCombobox(page, trigger, "Stap2-Product combobox");
  172 | 
  173 |       const options = page.locator('[role="option"]');
  174 |       await options.first().waitFor({ state: "visible", timeout: 8_000 });
  175 |       const labelText = (await options.first().textContent()) ?? "";
  176 |       chosen.product = labelText.trim().split(/\n|\s{2,}/)[0];
  177 |       expect(chosen.product.length).toBeGreaterThan(0);
  178 |       await options.first().click({ delay: 30 });
  179 |     }
  180 | 
  181 |     await page.getByRole("button", { name: /volgende/i }).click();
  182 | 
  183 |     // =========================================================================
  184 |     // STAP 3 — Tracker (Radio buttons)
  185 |     // =========================================================================
  186 |     await expect(page.getByText("Stap 3 — Tracker")).toBeVisible();
  187 |     {
  188 |       const firstRadio = page
  189 |         .locator("input[type='radio'][name='trackerId']")
  190 |         .first();
  191 |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  192 |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  193 |         chosen.tracker = (await labelRow.textContent()) ?? "";
  194 |         await firstRadio.check({ force: true });
  195 |       }
  196 |     }
  197 |     await page.getByRole("button", { name: /volgende/i }).click();
  198 | 
  199 |     // =========================================================================
  200 |     // STAP 4 — SIM (Radio buttons)
  201 |     // =========================================================================
  202 |     await expect(page.getByText("Stap 4 — SIM")).toBeVisible();
  203 |     {
  204 |       const firstRadio = page
  205 |         .locator("input[type='radio'][name='simId']")
  206 |         .first();
  207 |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  208 |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  209 |         chosen.sim = (await labelRow.textContent()) ?? "";
  210 |         await firstRadio.check({ force: true });
  211 |       }
  212 |     }
  213 |     await page.getByRole("button", { name: /volgende/i }).click();
  214 | 
  215 |     // =========================================================================
  216 |     // STAP 5 — Voertuig (Radio buttons)
  217 |     // =========================================================================
  218 |     await expect(page.getByText("Stap 5 — Voertuig")).toBeVisible();
  219 |     {
  220 |       const firstRadio = page
  221 |         .locator("input[type='radio'][name='vehicleId']")
  222 |         .first();
  223 |       if (await firstRadio.isEnabled({ timeout: 5_000 }).catch(() => false)) {
  224 |         const labelRow = firstRadio.locator("xpath=ancestor::label").first();
  225 |         chosen.vehicle = (await labelRow.textContent()) ?? "";
  226 |         await firstRadio.check({ force: true });
  227 |       }
  228 |     }
  229 |     await page.getByRole("button", { name: /volgende/i }).click();
  230 | 
  231 |     // =========================================================================
  232 |     // STAP 6 — Controle (Review card)
  233 |     // =========================================================================
  234 |     await expect(
  235 |       page.getByRole("heading", { level: 2, name: /controle|overzicht/i })
> 236 |     ).toBeVisible({ timeout: 15_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  237 |     const reviewCard = page.locator("main");
  238 |     if (chosen.product) {
  239 |       await expect(reviewCard).toContainText(chosen.product, { timeout: 10_000 });
  240 |     }
  241 |     const activeerBtn = page.getByRole("button", { name: /activeer/i });
  242 |     await expect(activeerBtn).toBeVisible();
  243 | 
  244 |     await page.goto("/activations", { waitUntil: "domcontentloaded" });
  245 |     await expect(
  246 |       page.getByRole("heading", { level: 1, name: /activaties/i })
  247 |     ).toBeVisible();
  248 |   });
  249 | });
  250 | 
```