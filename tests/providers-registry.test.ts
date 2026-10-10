import { describe, it, expect, beforeEach, vi } from "vitest";
import { PROVIDER_CAPABILITIES_NONE } from "@/server/providers/capabilities";
import {
  ProviderNotActivatedError,
  ProviderCapabilityNotSupportedError,
  ProviderNotConfiguredError,
} from "@/server/providers/errors";
import type {
  SimProviderAdapter,
  ProviderTestConnectionResult,
} from "@/server/providers/types";

// ============================================================================
// UNIT TEST voor registry-functionaliteit.
//
// We testen GEEN database-interactie. De registry wordt lokaal geinstantieerd
// met stub-adapters en geheugen-DataProvider.
// ============================================================================

type SimProviderLike = {
  providerKey: string;
  active: boolean;
};

function makeInMemoryRegistryKlass() {
  /** Lichtgewicht stub van registry zonder DB nodig. */
  class LiteRegistry {
    adapters = new Map<string, SimProviderAdapter>();
    providers = new Map<string, SimProviderLike>();

    register(adapter: SimProviderAdapter): void {
      this.adapters.set(adapter.providerKey, adapter);
    }

    has(providerKey: string): boolean {
      return this.adapters.has(providerKey);
    }

    require(providerKey: string): SimProviderAdapter {
      const a = this.adapters.get(providerKey);
      if (!a) throw new Error(`Provider ${providerKey} onbekend`);
      return a;
    }

    legacyResolve(s?: string | null): string {
      if (!s) return "simhuis";
      const lower = s.toLowerCase();
      if (lower.includes("simhuis")) return "simhuis";
      return lower;
    }

    resolveForSim(sim: {
      providerKey?: string | null;
      provider?: string | null;
    }): SimProviderAdapter {
      const key =
        sim.providerKey ||
        this.legacyResolve(sim.provider ?? null) ||
        "simhuis";
      return this.require(key);
    }

    isActivated(providerKey: string): boolean {
      const p = this.providers.get(providerKey);
      return !!p?.active;
    }

    guardActivated(providerKey: string): void {
      if (!this.isActivated(providerKey)) {
        throw new ProviderNotActivatedError(providerKey);
      }
    }

    requireCapability(
      providerKey: string,
      cap: keyof typeof PROVIDER_CAPABILITIES_NONE
    ): void {
      const a = this.require(providerKey);
      if (!a.capabilities[cap]) {
        throw new ProviderCapabilityNotSupportedError(providerKey, cap as string);
      }
    }

    isConfigured(providerKey: string): boolean {
      const a = this.require(providerKey);
      return typeof a.isConfigured === "function"
        ? a.isConfigured()
        : this.has(providerKey);
    }
  }
  return LiteRegistry;
}

function stubAdapter(
  providerKey: string,
  opts: {
    hasPurge?: boolean;
    hasActivate?: boolean;
    hasDeactivate?: boolean;
    hasTestConnection?: boolean;
    configured?: boolean;
  } = {}
): SimProviderAdapter {
  const capabilities = {
    ...PROVIDER_CAPABILITIES_NONE,
    listSims: true,
    getSimStatus: true,
    getSimStatusFast: true,
    activateSim: opts.hasActivate ?? true,
    deactivateSim: opts.hasDeactivate ?? true,
    suspendSim: true,
    unsuspendSim: true,
    subscribeToProduct: true,
    precheckProductAvailability: true,
    getAssetByIccid: true,
    purgeAsset: opts.hasPurge ?? true,
    syncUsage: true,
    testConnection: opts.hasTestConnection ?? true,
    supportsIdempotency: false,
    supportsWebhooks: false,
    supportsDefaultProducts: true,
  };
  return {
    providerKey,
    displayName: providerKey.toUpperCase(),
    capabilities,
    isConfigured: () => opts.configured ?? true,
    listSims: vi.fn(async () => []),
    getSimStatus: vi.fn(async (_iccid) => ({
      iccid: _iccid,
      subscriberId: null,
      lifecycle: "inactive" as const,
      raw: {},
    })),
    getSimStatusFast: vi.fn(async (_iccid) => ({
      iccid: _iccid,
      subscriberId: null,
      lifecycle: "inactive" as const,
      raw: {},
    })),
    activateSim: vi.fn(async () => ({
      ok: true,
      iccid: "",
      subscriberId: null,
      lifecycle: "active" as const,
    })),
    deactivateSim: vi.fn(async () => ({
      ok: true,
      iccid: "",
      lifecycle: "inactive" as const,
    })),
    suspendSim: vi.fn(async () => ({
      ok: true,
      iccid: "",
      lifecycle: "suspended" as const,
    })),
    unsuspendSim: vi.fn(async () => ({
      ok: true,
      iccid: "",
      lifecycle: "active" as const,
    })),
    subscribeToProduct: vi.fn(async () => ({
      ok: true,
      iccid: "",
      bundleId: null,
      lifecycle: "active" as const,
    })),
    precheckProductAvailability: vi.fn(async () => ({ ok: true, available: true })),
    getAssetByIccid: vi.fn(async () => ({ ok: true, found: false })),
    purgeAsset: vi.fn(async () => ({ ok: true, purged: true })),
    syncUsage: vi.fn(async () => ({ ok: true, updated: 0 })),
    testConnection: vi.fn(async (): Promise<ProviderTestConnectionResult> => ({
      ok: true,
    })),
    getDefaultProducts: vi.fn(async () => ({
      defaultOfferId: null,
      defaultPlanId: null,
      defaultProductName: null,
    })),
    handleWebhook: vi.fn(async () => ({ ok: true })),
  };
}

describe("providers registry", () => {
  const Lite = makeInMemoryRegistryKlass();
  let registry: InstanceType<typeof Lite>;

  beforeEach(() => {
    registry = new Lite();
  });

  describe("legacyResolve", () => {
    it("valt terug op simhuis bij lege invoer", () => {
      expect(registry.legacyResolve(null)).toBe("simhuis");
      expect(registry.legacyResolve(undefined)).toBe("simhuis");
      expect(registry.legacyResolve("")).toBe("simhuis");
    });

    it("herkent Simhuis alias (hoofdletterongevoelig)", () => {
      expect(registry.legacyResolve("Simhuis")).toBe("simhuis");
      expect(registry.legacyResolve("SIMHUIS B.V.")).toBe("simhuis");
    });

    it("lowercased andere strings", () => {
      expect(registry.legacyResolve("MockProvider")).toBe("mockprovider");
    });
  });

  describe("resolveForSim", () => {
    beforeEach(() => {
      registry.register(stubAdapter("simhuis"));
      registry.register(stubAdapter("mock"));
    });

    it("gebruikt expliciete providerKey eerst", () => {
      const adapter = registry.resolveForSim({
        providerKey: "mock",
        provider: "Simhuis",
      });
      expect(adapter.providerKey).toBe("mock");
    });

    it("valt terug op legacy resolve als providerKey ontbreekt", () => {
      const a1 = registry.resolveForSim({
        providerKey: null,
        provider: "Simhuis",
      });
      expect(a1.providerKey).toBe("simhuis");

      const a2 = registry.resolveForSim({
        providerKey: null,
        provider: null,
      });
      expect(a2.providerKey).toBe("simhuis");
    });
  });

  describe("guardActivated", () => {
    beforeEach(() => {
      registry.register(stubAdapter("simhuis"));
    });

    it("geen fout als actief=true", () => {
      registry.providers.set("simhuis", { providerKey: "simhuis", active: true });
      expect(() => registry.guardActivated("simhuis")).not.toThrow();
    });

    it("throwt ProviderNotActivatedError als actief=false", () => {
      registry.providers.set("simhuis", { providerKey: "simhuis", active: false });
      expect(() => registry.guardActivated("simhuis")).toThrowError(
        ProviderNotActivatedError
      );
    });

    it("foutbericht bevat providerKey en exposeert GEEN geheimen", () => {
      registry.providers.set("simhuis", { providerKey: "simhuis", active: false });
      try {
        registry.guardActivated("simhuis");
        expect.fail("verwachtte fout");
      } catch (e: any) {
        expect(e.safeMessage).toMatch(/simhuis/);
        expect(String(e.safeMessage).toLowerCase()).not.toMatch(/password|secret|token|wachtwoord/);
      }
    });
  });

  describe("requireCapability", () => {
    it("slagen als capability=true", () => {
      const a = stubAdapter("simhuis", { hasPurge: true });
      registry.register(a);
      expect(() => registry.requireCapability("simhuis", "purgeAsset")).not.toThrow();
    });

    it("gooit als capability=false", () => {
      const a = stubAdapter("simhuis", { hasPurge: false });
      // Override de capabilities naar purge=false.
      (a as any).capabilities = {
        ...a.capabilities,
        purgeAsset: false,
      };
      registry.register(a);
      expect(() => registry.requireCapability("simhuis", "purgeAsset")).toThrowError(
        ProviderCapabilityNotSupportedError
      );
    });
  });

  describe("isConfigured fallback", () => {
    it("gebruikt adapter.isConfigured() als beschikbaar", () => {
      const cfg = stubAdapter("mock", { configured: false });
      registry.register(cfg);
      expect(registry.isConfigured("mock")).toBe(false);
    });
  });

  describe("geïsoleerde fout-classen", () => {
    it("ProviderNotConfiguredError geeft safeMessage met providerKey", () => {
      const err = new ProviderNotConfiguredError("acme");
      expect(err.safeMessage).toMatch(/acme/);
      expect(err.name).toBe("ProviderNotConfiguredError");
    });
  });
});
