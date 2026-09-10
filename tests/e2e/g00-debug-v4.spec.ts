import { test } from "@playwright/test";

test("G.0 DEBUG v4 — HTML dump + cookies + state search NA submit", async ({ page }, testInfo) => {
  const email = "admin@nexus.local";
  const password = "Test1234!";

  await page.goto("/login", { waitUntil: "domcontentloaded" });

  const emailInput = page.locator("input#email");
  const passwordInput = page.locator("input#password");
  await emailInput.waitFor({ state: "visible", timeout: 8_000 });
  await passwordInput.waitFor({ state: "visible", timeout: 8_000 });
  await emailInput.click();
  await emailInput.fill(email);
  await passwordInput.click();
  await passwordInput.fill(password);

  const submit = page.locator('button[type="submit"]:has-text("Inloggen")');

  // Before submit: wat zijn de cookies?
  console.log("DEBUG cookies VOOR submit:");
  for (const c of await page.context().cookies()) {
    console.log("  -", c.name, "=", c.value.slice(0, 20), "domain=", c.domain);
  }

  await submit.click();
  await page.waitForTimeout(8_000);

  console.log("DEBUG URL NA submit:", page.url());
  console.log("DEBUG mainTitle:", await page.title());

  // Wat is nu de HTML? Zoek naar role="alert" EN naar "AuthError" / "signIn" / "fail"
  const html = await page.content();
  const alertMatches = [...html.matchAll(/role="alert"[^>]*>([\s\S]*?)<\//g)].map(
    (m) => m[1]
  );
  console.log(
    `DEBUG role="alert" count: ${alertMatches.length}. Inhoud:`,
    JSON.stringify(alertMatches)
  );

  for (const needle of ["AuthError", "signIn() fail", "Onverwachte fout", "Onjuiste", "dashboard"]) {
    const idx = html.indexOf(needle);
    console.log(`DEBUG needle "${needle}":`, idx >= 0 ? `Gevonden op index ${idx}` : "NIET GEVONDEN");
    if (idx >= 0) {
      console.log("  → context:", html.slice(Math.max(0, idx - 30), idx + needle.length + 80));
    }
  }

  console.log("DEBUG cookies NA submit:");
  for (const c of await page.context().cookies()) {
    console.log("  -", c.name, "=", c.value.slice(0, 30), "domain=", c.domain, "httpOnly=", c.httpOnly);
  }

  // Sla HTML op als attachment zodat we later kunnen nakijken
  await testInfo.attach("na-submit.html", { body: html, contentType: "text/html" });
  await testInfo.attach("na-submit.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
