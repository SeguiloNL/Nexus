# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: g01-login.spec.ts >> G.2.1 — Login voor 3 rollen >> Login als EMPLOYEE (medewerker@nexus.local) → redirected naar Dashboard met profielknop
- Location: tests/e2e/g01-login.spec.ts:12:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: loginAs employee: Dashboard H1 niet zichtbaar. URL: http://localhost:3001/login — (emailveld waarde="")
```

# Page snapshot

```yaml
- generic [active] [ref=f3e1]:
  - generic [ref=f3e3]:
    - generic [ref=f3e4]:
      - heading "Nexus" [level=1] [ref=f3e5]
      - paragraph [ref=f3e6]: Activation & Subscription Manager
    - generic [ref=f3e7]:
      - heading "Inloggen" [level=2] [ref=f3e8]
      - generic [ref=f3e9]:
        - generic [ref=f3e10]:
          - generic [ref=f3e11]: E-mailadres
          - textbox "E-mailadres" [ref=f3e12]:
            - /placeholder: naam@voorbeeld.nl
        - generic [ref=f3e13]:
          - generic [ref=f3e14]: Wachtwoord
          - textbox "Wachtwoord" [ref=f3e15]:
            - /placeholder: ••••••••
        - button "Inloggen" [ref=f3e16] [cursor=pointer]
    - paragraph [ref=f3e17]: Neem contact op met je beheerder voor accountgegevens.
    - paragraph [ref=f3e18]: "Seed credentials (na db seeden): admin@nexus.local / Test1234!"
  - alert [ref=f3e19]
```

# Test source

```ts
  1  | // Shared helpers voor Playwright E2E tests
  2  | // Belangrijk: test ALLEEN op locale dev server met SERVER action toegestane AUTH_SECRET =
  3  | // in productie zou je aparte test-credentials of een auth-token cookie gebruiken.
  4  | 
  5  | import type { Page } from "@playwright/test";
  6  | import { expect } from "@playwright/test";
  7  | 
  8  | // Seed credentials (uit prisma/seed.mjs: §4 Gebruikers upsert email veld)
  9  | export const TEST_USERS = {
  10 |   admin:    { email: "admin@nexus.local",       password: "Test1234!", role: "ADMIN"    },
  11 |   employee: { email: "medewerker@nexus.local",  password: "Test1234!", role: "EMPLOYEE" },
  12 |   viewer:   { email: "viewer@nexus.local",      password: "Test1234!", role: "VIEWER"   },
  13 | } as const;
  14 | 
  15 | export type TestUser = keyof typeof TEST_USERS;
  16 | 
  17 | /**
  18 |  * Inloggen via loginpagina (Next.js useFormState formulier).
  19 |  * Strategie:
  20 |  *  1. /login openen.
  21 |  *  2. Velden invullen (click + fill).
  22 |  *  3. Password-input Enter indrukken (betrouwbaarder dan button click op
  23 |  *     useFormState forms, geen wachttijden nodig tussen invullen/submit).
  24 |  *  4. Wachten op /dashboard URL (Playwright waitForURL — ingebouwd retry).
  25 |  *  5. Indien mislukt: 1x retry, daarna expliciete goto fallback.
  26 |  */
  27 | export async function loginAs(page: Page, user: TestUser): Promise<void> {
  28 |   const { email, password } = TEST_USERS[user];
  29 | 
  30 |   for (let attempt = 0; attempt < 2; attempt++) {
  31 |     await page.goto("/login", { waitUntil: "domcontentloaded" });
  32 | 
  33 |     const emailInput = page.locator("input#email");
  34 |     const passwordInput = page.locator("input#password");
  35 |     await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  36 |     await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
  37 | 
  38 |     // Invullen: eerst click → fill. Gebruik GEEN pressSequentially;
  39 |     // useFormState re-renders wissen velden soms bij langzame input.
  40 |     await emailInput.click();
  41 |     await emailInput.fill(email);
  42 |     await passwordInput.click();
  43 |     await passwordInput.fill(password);
  44 | 
  45 |     // Laatste check: waarden staan er echt IN.
  46 |     await expect(emailInput).toHaveValue(email);
  47 |     await expect(passwordInput).toHaveValue(password);
  48 | 
  49 |     // Submit via Enter. (Volgt direct de 303/redirect van useFormState.)
  50 |     try {
  51 |       await Promise.all([
  52 |         page.waitForURL("**/dashboard", { timeout: 20_000, waitUntil: "domcontentloaded" }),
  53 |         passwordInput.press("Enter"),
  54 |       ]);
  55 |       break; // SUCCESS, geen retry nodig.
  56 |     } catch {
  57 |       // waitForURL timeout → waarschijnlijk redirect mislukt (dev server).
  58 |       // Fallback: expliciete navigatie.
  59 |       if (attempt === 1) break; // al laatste poging.
  60 |     }
  61 |   }
  62 | 
  63 |   // Fallback als URL nog niet /dashboard is.
  64 |   if (!/\/dashboard(\?|$)/.test(page.url())) {
  65 |     await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  66 |   }
  67 | 
  68 |   // Final assert: Dashboard H1 zichtbaar.
  69 |   const dashboardH1 = page
  70 |     .getByRole("heading", { level: 1 })
  71 |     .filter({ hasText: /dashboard/i });
  72 |   try {
  73 |     await dashboardH1.waitFor({ state: "visible", timeout: 20_000 });
  74 |   } catch (err) {
  75 |     const alert = page.locator('[role="alert"]');
  76 |     let alertText = "";
  77 |     if (await alert.isVisible().catch(() => false)) alertText = ` — [alert] ${await alert.textContent()}`;
  78 |     const emailVal = await page.locator("input#email").inputValue().catch(() => "");
> 79 |     throw new Error(
     |           ^ Error: loginAs employee: Dashboard H1 niet zichtbaar. URL: http://localhost:3001/login — (emailveld waarde="")
  80 |       `loginAs ${user}: Dashboard H1 niet zichtbaar. URL: ${page.url()}${alertText} — (emailveld waarde="${emailVal}")`,
  81 |       { cause: err as Error }
  82 |     );
  83 |   }
  84 | }
  85 | 
  86 | /**
  87 |  * Dashboard statistieken parsen (gebruikt in G.2.2 dashboard smoke test)
  88 |  */
  89 | export async function readDashboardStatCard(page: Page, labelMatch: RegExp): Promise<string> {
  90 |   // Statistieken in UI zijn `<a>` tags (cards) met labels zoals "Actieve abonnementen".
  91 |   const loc = page.getByRole("link", { name: labelMatch });
  92 |   await loc.waitFor({ state: "visible" });
  93 |   const text = (await loc.textContent()) ?? "";
  94 |   return text;
  95 | }
  96 | 
```