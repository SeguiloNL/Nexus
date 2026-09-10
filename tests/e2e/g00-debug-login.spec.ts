import { test } from "@playwright/test";

test("G.0 DEBUG — Raw login (geen helpers) met screenshots + URL logs", async ({ page }, testInfo) => {
  const email = "admin@nexus.local";
  const password = "Test1234!";

  console.log("DEBUG [1/6] goto /login");
  await page.goto("/login", { waitUntil: "networkidle", timeout: 20_000 });
  console.log("DEBUG URL na goto:", page.url());

  console.log("DEBUG [2/6] invullen velden");
  const emailInput = page.locator("input#email");
  const passwordInput = page.locator("input#password");
  await emailInput.waitFor({ state: "visible", timeout: 8_000 });
  await passwordInput.waitFor({ state: "visible", timeout: 8_000 });
  await emailInput.click();
  await emailInput.fill(email);
  await passwordInput.click();
  await passwordInput.fill(password);
  console.log("DEBUG email value:", await emailInput.inputValue());
  console.log("DEBUG password value:", (await passwordInput.inputValue()).slice(0, 4) + "***");

  await testInfo.attach("voor-submit.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  console.log("DEBUG [3/6] submit BUTTON CLICK + wacht 10s");
  const submit = page.locator('button[type="submit"]:has-text("Inloggen")');
  await submit.waitFor({ state: "visible", timeout: 8_000 });
  try {
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST", { timeout: 20_000 }),
      submit.click(),
    ]);
    console.log("DEBUG POST response:", resp.url(), "HTTP", resp.status());
  } catch (e) {
    console.log("DEBUG GEEN POST response binnen 20s:", (e as Error).message);
  }

  await page.waitForTimeout(10_000);
  console.log("DEBUG URL na wachten:", page.url());

  const alert = page.locator('[role="alert"]');
  if (await alert.isVisible().catch(() => false)) {
    console.log("DEBUG role=alert zichtbaar:", await alert.textContent());
  } else {
    console.log("DEBUG role=alert NIET zichtbaar");
  }
  console.log("DEBUG title:", await page.title());
  console.log("DEBUG h1(s):", await page.locator("h1").allInnerTexts());
  console.log("DEBUG h2(s):", await page.locator("h2").allInnerTexts());

  await testInfo.attach("na-wachten.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  // Exporteer HAR-like: pagina HTML.
  await testInfo.attach("na-wachten.html", {
    body: await page.content(),
    contentType: "text/html",
  });

  // Zet test altijd op OK (we debuggen, we testen niet).
});
