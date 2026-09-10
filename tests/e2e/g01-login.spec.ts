import { test, expect } from "@playwright/test";
import { loginAs, TEST_USERS } from "./lib/auth-helpers";

/**
 * E2E Flow 1: Inloggen (3 rollen: ADMIN / EMPLOYEE / VIEWER)
 * Doel: bevestigen dat de login-redirect NAAR /dashboard gaat en
 * dat de role-header (dropdown menu) de juiste e-mail toont.
 */
test.describe("G.2.1 — Login voor 3 rollen", () => {
  for (const user of Object.keys(TEST_USERS) as (keyof typeof TEST_USERS)[]) {
    const email = TEST_USERS[user].email;
    test(`Login als ${user.toUpperCase()} (${email}) → redirected naar Dashboard met profielknop`, async ({ page }) => {
      await loginAs(page, user);
      // Profielknop (dropdown rechts bovenin) MOET de e-mail bevatten.
      const profile = page.getByRole("button", { name: new RegExp(email, "i") });
      await expect(profile).toBeVisible();
      // Sidebar MOET altijd "Dashboard" link bevatten, ook voor VIEWER.
      await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    });
  }
});
