import { describe, it, expect, beforeEach } from "vitest";
import { MockAdapter } from "@/server/providers/mock/adapter";
import { ProviderCapabilityNotSupportedError } from "@/server/providers/errors";

// ============================================================================
// MockAdapter: voorbeeld "tweede leverancier" voor tests/ontwikkeling.
// Doel van deze test:
//  1. Aantonen dat een tweede adapter onafhankelijk werkt.
//  2. Bewijzen dat 0 imports van simhuis/* in de adapter zitten (concreet:
//     de MockAdapter kent geen Simhuis-typen of -client).
//  3. Dat capability guards correct werken (purgeAsset = false → gooien).
// ============================================================================

describe("MockAdapter (tweede leverancier, onafhankelijk van Simhuis)", () => {
  /** MockAdapter is een CLASS — maak per test een schone instantie. */
  let mock: InstanceType<typeof MockAdapter>;

  beforeEach(() => {
    mock = new MockAdapter();
  });

  it("heeft de verwachte providerKey 'mock'", () => {
    expect(mock.providerKey).toBe("mock");
  });

  it("heeft GEEN purgeAsset-capability", () => {
    expect(mock.capabilities.purgeAsset).toBe(false);
  });

  it("supportsWebhooks = true (testbaar mechanisme voor toekomst)", () => {
    expect(mock.capabilities.supportsWebhooks).toBe(true);
  });

  it("supportsIdempotency = false", () => {
    expect(mock.capabilities.supportsIdempotency).toBe(false);
  });

  it("testConnection geeft true standaard, false na _setConnected(false)", async () => {
    const r1 = await mock.testConnection();
    expect(r1.ok).toBe(true);

    mock._setConnected(false);
    const r2 = await mock.testConnection();
    expect(r2.ok).toBe(false);
    // ProviderTestConnectionResult gebruikt safeError, GEEN geheimen
    expect(r2.safeError).toBeDefined();
    expect(String(r2.safeError ?? "").toLowerCase()).not.toMatch(/password|wachtwoord|token|secret/);
  });

  it("listSims retourneert 10 seed-sims met herkenbare ICCID", async () => {
    const sims = await mock.listSims();
    expect(sims).toHaveLength(10);
    sims.forEach((s) => {
      expect(s.iccid).toMatch(/^89000000000000000/);
      // ProviderSimStatus gebruikt VELD `status`, niet `lifecycle`
      expect(typeof s.status).toBe("string");
    });
  });

  it("activateSim verandert status naar active", async () => {
    const iccid = "8900000000000000090";
    const r = await mock.activateSim({ iccid });
    expect(r.ok).toBe(true);
    expect(r.confirmedStatus).toBe("active");
    const status = await mock.getSimStatus(iccid);
    expect(status?.status).toBe("active");
  });

  it("suspendSim → suspended, unsuspendSim → active", async () => {
    const iccid = "8900000000000000091";
    await mock.activateSim({ iccid });
    const s1 = await mock.suspendSim(iccid);
    expect(s1.confirmedStatus).toBe("suspended");
    const s2 = await mock.unsuspendSim(iccid);
    expect(s2.confirmedStatus).toBe("active");
  });

  it("purgeAsset() gooit expliciet ProviderCapabilityNotSupportedError", async () => {
    expect.assertions(2);
    try {
      await mock.purgeAsset("8900000000000000090");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ProviderCapabilityNotSupportedError);
      expect(e.safeMessage).toMatch(/purgeAsset/);
    }
  });

  it("getDefaultProducts levert mock-defaults (onafhankelijk van Simhuis)", async () => {
    const d = await mock.getDefaultProducts?.();
    expect(d).toBeDefined();
    expect(String(d?.defaultProductName ?? "")).toMatch(/Mock/i);
  });

  it("isConfigured = false na _setConfigured(false)", async () => {
    mock._setConfigured(false);
    expect(await mock.isConfigured?.()).toBe(false);
    mock._setConfigured(true);
    expect(await mock.isConfigured?.()).toBe(true);
  });
});

// ============================================================================
// SANITY CHECK: bevestig dat MockAdapter bestand GEEN Simhuis imports bevat.
// Dit is een runtime/test-time bevestiging: de echte check wordt normaal
// door de TypeScript compiler gedaan, maar deze test documenteert het en
// stopt per ongeluk invoegen van Simhuis-afhankelijkheid.
// ============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

describe("MockAdapter: bouwval (file import scan)", () => {
  it("bevat GEEN imports van @/server/integrations/simhuis of `simhuisClient`", () => {
    const root = process.cwd();
    const target = path.resolve(
      root,
      "src/server/providers/mock/adapter.ts"
    );
    const src = fs.readFileSync(target, "utf-8");
    // Controle 1: imports vanuit simhuis-paden
    const importsFromSimhuis =
      /from\s+["'].*simhuis/.test(src) ||
      /import\s*\(.*simhuis/.test(src);
    expect(importsFromSimhuis).toBe(false);

    // Controle 2: directe symbolen (simhuisClient, simhuisActivateSim, enz.)
    const hasSimhuisSymbol =
      /\bsimhuisClient\b/.test(src) ||
      /\bsimhuisActivate\b/.test(src) ||
      /\bSimhuisSim\b/.test(src);
    expect(hasSimhuisSymbol).toBe(false);
  });
});
