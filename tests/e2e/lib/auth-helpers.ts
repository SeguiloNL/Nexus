// Shared helpers voor Playwright E2E tests
// Belangrijk: test ALLEEN op locale dev server met SERVER action toegestane AUTH_SECRET =
// in productie zou je aparte test-credentials of een auth-token cookie gebruiken.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

// Seed credentials (uit prisma/seed.mjs: §4 Gebruikers upsert email veld)
export const TEST_USERS = {
  admin:    { email: "admin@nexus.local",       password: "Test1234!", role: "ADMIN"    },
  employee: { email: "medewerker@nexus.local",  password: "Test1234!", role: "EMPLOYEE" },
  viewer:   { email: "viewer@nexus.local",      password: "Test1234!", role: "VIEWER"   },
} as const;

export type TestUser = keyof typeof TEST_USERS;

/**
 * Inloggen via loginpagina (Next.js useFormState formulier).
 * Strategie:
 *  1. /login openen.
 *  2. Velden invullen (click + fill).
 *  3. Password-input Enter indrukken (betrouwbaarder dan button click op
 *     useFormState forms, geen wachttijden nodig tussen invullen/submit).
 *  4. Wachten op /dashboard URL (Playwright waitForURL — ingebouwd retry).
 *  5. Indien mislukt: 1x retry, daarna expliciete goto fallback.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  const { email, password } = TEST_USERS[user];

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    const emailInput = page.locator("input#email");
    const passwordInput = page.locator("input#password");
    await emailInput.waitFor({ state: "visible", timeout: 10_000 });
    await passwordInput.waitFor({ state: "visible", timeout: 10_000 });

    // Invullen: eerst click → fill. Gebruik GEEN pressSequentially;
    // useFormState re-renders wissen velden soms bij langzame input.
    await emailInput.click();
    await emailInput.fill(email);
    await passwordInput.click();
    await passwordInput.fill(password);

    // Laatste check: waarden staan er echt IN.
    await expect(emailInput).toHaveValue(email);
    await expect(passwordInput).toHaveValue(password);

    // Submit via Enter. (Volgt direct de 303/redirect van useFormState.)
    try {
      await Promise.all([
        page.waitForURL("**/dashboard", { timeout: 20_000, waitUntil: "domcontentloaded" }),
        passwordInput.press("Enter"),
      ]);
      break; // SUCCESS, geen retry nodig.
    } catch {
      // waitForURL timeout → waarschijnlijk redirect mislukt (dev server).
      // Fallback: expliciete navigatie.
      if (attempt === 1) break; // al laatste poging.
    }
  }

  // Fallback als URL nog niet /dashboard is.
  if (!/\/dashboard(\?|$)/.test(page.url())) {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  }

  // Final assert: Dashboard H1 zichtbaar.
  const dashboardH1 = page
    .getByRole("heading", { level: 1 })
    .filter({ hasText: /dashboard/i });
  try {
    await dashboardH1.waitFor({ state: "visible", timeout: 20_000 });
  } catch (err) {
    const alert = page.locator('[role="alert"]');
    let alertText = "";
    if (await alert.isVisible().catch(() => false)) alertText = ` — [alert] ${await alert.textContent()}`;
    const emailVal = await page.locator("input#email").inputValue().catch(() => "");
    throw new Error(
      `loginAs ${user}: Dashboard H1 niet zichtbaar. URL: ${page.url()}${alertText} — (emailveld waarde="${emailVal}")`,
      { cause: err as Error }
    );
  }
}

/**
 * Dashboard statistieken parsen (gebruikt in G.2.2 dashboard smoke test)
 */
export async function readDashboardStatCard(page: Page, labelMatch: RegExp): Promise<string> {
  // Statistieken in UI zijn `<a>` tags (cards) met labels zoals "Actieve abonnementen".
  const loc = page.getByRole("link", { name: labelMatch });
  await loc.waitFor({ state: "visible" });
  const text = (await loc.textContent()) ?? "";
  return text;
}
