/**
 * Modulair Leverancierssysteem — Registry (singleton)
 * ----------------------------------------------------
 * Verantwoordelijk voor:
 *   - Registreren van adapters (per providerKey)
 *   - Lazy instantieren via factory
 *   - De 4 statussen bepalen (registered/configured/activated/connected)
 *   - Capability-guards vóór adapter-aanroepen
 *   - Legacy mapping (oude SIM.provider-string → providerKey)
 *   - ResolveForSim: SIM onafhankelijk van provider correct koppelen
 */

import { prisma } from "@/lib/prisma";
import { PROVIDER_CAPABILITIES_NONE, type SimProviderCapability, type SimProviderCapabilities } from "./capabilities";
import {
  ProviderCapabilityNotSupportedError,
  ProviderNotActivatedError,
  ProviderNotConfiguredError,
  ProviderError,
} from "./errors";
import type {
  RegisteredProviderInfo,
  RegisteredProviderStatus,
  SimProviderAdapter,
} from "./types";

// ============================================================
// Singleton guard — Hot Module Reload safe
// ============================================================
const GLOBAL_REGISTRY_KEY = "__nexus_provider_registry" as const;

type AdapterFactory = () => SimProviderAdapter | Promise<SimProviderAdapter>;

// ============================================================
// Registry class
// ============================================================
export class SimProviderRegistry {
  private factories = new Map<string, AdapterFactory>();
  private instances = new Map<string, SimProviderAdapter>();

  // --- Registratie --------------------------------------------------------
  register(providerKey: string, factory: AdapterFactory): this {
    if (this.factories.has(providerKey)) {
      throw new ProviderError(
        "GENERIC",
        `Er is al een provider geregistreerd met key “${providerKey}”.`,
      );
    }
    this.factories.set(providerKey, factory);
    return this;
  }

  isRegistered(providerKey: string): boolean {
    return this.factories.has(providerKey);
  }

  // --- Instantie (lazy) --------------------------------------------------
  async get(providerKey: string): Promise<SimProviderAdapter | null> {
    if (!this.factories.has(providerKey)) return null;
    const cached = this.instances.get(providerKey);
    if (cached) return cached;
    const factory = this.factories.get(providerKey)!;
    const adapter = await factory();
    this.instances.set(providerKey, adapter);
    return adapter;
  }

  async require(providerKey: string): Promise<SimProviderAdapter> {
    const adapter = await this.get(providerKey);
    if (!adapter) {
      throw new ProviderError(
        "GENERIC",
        `Leverancier “${providerKey}” is niet geregistreerd in de provider registry.`,
      );
    }
    return adapter;
  }

  // --- Capability guard --------------------------------------------------
  /**
   * Controleert of de adapter de capability heeft. Gooit
   * ProviderCapabilityNotSupportedError indien niet.
   */
  requireCapability(
    adapter: SimProviderAdapter,
    capability: SimProviderCapability,
  ): asserts adapter is SimProviderAdapter & Record<string, unknown> {
    if (!adapter.capabilities[capability]) {
      throw new ProviderCapabilityNotSupportedError(adapter.providerKey, capability);
    }
  }

  // --- 4-statussen logica ------------------------------------------------
  /**
   * Controleert of de provider is geconfigureerd (credentials aanwezig).
   * Eerst adapter.isConfigured() indien geimplementeerd, anders generieke
   * fallback via AppSetting prefix of env vars.
   */
  async isConfigured(providerKey: string): Promise<boolean> {
    const adapter = await this.get(providerKey);
    if (!adapter) return false;
    if (typeof adapter.isConfigured === "function") return adapter.isConfigured();
    return this.isConfiguredFallback(providerKey);
  }

  private async isConfiguredFallback(providerKey: string): Promise<boolean> {
    // Generieke fallback: {key}.baseUrl + {key}.username + {key}.password (DB)
    // of omgevingsvariabelen {KEY}_BASE_URL + {KEY}_USERNAME + {KEY}_PASSWORD.
    const prefixDB = `${providerKey}.`;
    const envPrefix = providerKey.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const envKeys = [`${envPrefix}_BASE_URL`, `${envPrefix}_USERNAME`, `${envPrefix}_PASSWORD`] as const;
    const dbKeys = [`${prefixDB}baseUrl`, `${prefixDB}username`, `${prefixDB}password`] as const;

    // DB check (indien van toepassing)
    const rows = await prisma.appSetting.findMany({ where: { key: { in: dbKeys as unknown as string[] } } });
    const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
    const dbBase = map.get(dbKeys[0])?.trim() || "";
    const dbUser = map.get(dbKeys[1])?.trim() || "";
    const dbPass = map.get(dbKeys[2]) || "";
    if (dbBase && dbUser && dbPass) return true;

    // Env fallback
    const env = (k: string) => (process.env[k] || "").trim();
    if (env(envKeys[0]) && env(envKeys[1]) && process.env[envKeys[2]]) return true;

    return false;
  }

  /** Activeringsstatus ophalen uit SimProvider-tabel. */
  async isActivated(providerKey: string): Promise<boolean> {
    const row = await prisma.simProvider.findUnique({
      where: { providerKey },
      select: { active: true },
    });
    return !!row?.active;
  }

  /** Guard — gooit indien active=false. */
  async guardActivated(providerKey: string): Promise<void> {
    const on = await this.isActivated(providerKey);
    if (!on) throw new ProviderNotActivatedError(providerKey);
  }

  /** Adapter + config + activering gecombineerd. */
  async requireActivated(providerKey: string): Promise<SimProviderAdapter> {
    const adapter = await this.require(providerKey);
    if (!(await this.isConfigured(providerKey))) {
      throw new ProviderNotConfiguredError(providerKey);
    }
    await this.guardActivated(providerKey);
    return adapter;
  }

  // --- Legacy / SIM resolve ---------------------------------------------
  /**
   * Oude SIM.provider vrije tekst → providerKey.
   * Fallback default is simhuis indien leeg of onbekend.
   */
  legacyResolve(providerString: string | null | undefined): string {
    if (!providerString) return "simhuis";
    const s = providerString.trim().toLowerCase();
    if (!s) return "simhuis";
    if (s.includes("simhuis")) return "simhuis";
    // Gereserveerde woorden: later kunnen we hier naar meer providers mappen
    return s;
  }

  /**
   * Resolve de adapter voor een SIM-record.
   *   1. Indien sim.providerKey gezet: gebruik die
   *   2. Anders legacyResolve(sim.provider)
   */
  async resolveForSim(sim: {
    providerKey?: string | null;
    provider?: string | null;
  }): Promise<SimProviderAdapter> {
    const key = sim.providerKey || this.legacyResolve(sim.provider);
    return this.require(key);
  }

  // --- Meta / UI --------------------------------------------------------
  /** Lijst van alle providers met hun 4-statussen + capabilities. */
  async listAll(): Promise<RegisteredProviderInfo[]> {
    const keys = Array.from(this.factories.keys());
    const rows = await prisma.simProvider.findMany({
      where: { providerKey: { in: keys } },
    });
    const rowMap = new Map(rows.map((r) => [r.providerKey, r]));

    const result: RegisteredProviderInfo[] = [];
    for (const key of keys) {
      const adapter = await this.get(key);
      const row = rowMap.get(key);
      const registered = true;
      const configured = adapter ? await this.isConfigured(key) : false;
      const activated = !!row?.active;
      const connected = row?.lastConnectionOk ?? null;
      let status: RegisteredProviderStatus = "registered";
      if (configured) status = "configured";
      if (activated) status = "activated";
      if (connected === true) status = "connected";

      result.push({
        providerKey: key,
        displayName: adapter?.displayName || row?.displayName || key,
        status,
        registered,
        configured,
        activated,
        connected,
        lastConnectionCheckedAt: row?.lastConnectionCheckedAt ?? null,
        lastConnectionLatencyMs: row?.lastConnectionLatencyMs ?? null,
        lastConnectionErrorSafe: row?.lastConnectionErrorSafe ?? null,
        capabilities:
          (adapter?.capabilities as SimProviderCapabilities) || PROVIDER_CAPABILITIES_NONE,
      });
    }
    return result;
  }

  /** Huidige capabilities van adapter. */
  async getCapabilities(providerKey: string): Promise<SimProviderCapabilities> {
    const adapter = await this.get(providerKey);
    if (!adapter) return { ...PROVIDER_CAPABILITIES_NONE };
    return adapter.capabilities as SimProviderCapabilities;
  }

  /**
   * Noteer het resultaat van de laatste verbindingstest in de SimProvider tabel.
   * Alleen metadata, geen adapter-acties.
   */
  async updateConnectionStatus(
    providerKey: string,
    payload: {
      ok: boolean;
      checkedAt: Date;
      latencyMs?: number | null;
      safeError?: string | null;
    },
  ): Promise<void> {
    await prisma.simProvider.upsert({
      where: { providerKey },
      create: {
        providerKey,
        displayName: providerKey,
        active: false,
        lastConnectionOk: payload.ok,
        lastConnectionCheckedAt: payload.checkedAt,
        lastConnectionLatencyMs: payload.latencyMs ?? undefined,
        lastConnectionErrorSafe: payload.safeError ?? undefined,
      },
      update: {
        lastConnectionOk: payload.ok,
        lastConnectionCheckedAt: payload.checkedAt,
        lastConnectionLatencyMs: payload.latencyMs ?? undefined,
        lastConnectionErrorSafe: payload.safeError ?? undefined,
      },
    });
  }
}

// ============================================================
// Singleton instantie (HMR-safe)
// ============================================================
declare global {
  // eslint-disable-next-line no-var
  var __nexus_provider_registry: SimProviderRegistry | undefined;
}

export const providerRegistry: SimProviderRegistry =
  globalThis.__nexus_provider_registry ?? new SimProviderRegistry();

if (process.env.NODE_ENV !== "production") {
  globalThis.__nexus_provider_registry = providerRegistry;
}

// ============================================================
// Initialisatie
// ============================================================
/**
 * Eenmalig tijdens server-start de adapters registreren.
 * Idempotent: veilige aanroep meerdere malen (guards).
 */
export async function initializeProviderRegistry(): Promise<void> {
  if (providerRegistry.isRegistered("simhuis")) return;
  // Lazy imports zodat test-registraties Simhuis volledig kunnen overslaan
  const { SimhuisAdapter } = await import("./simhuis/adapter");
  providerRegistry.register("simhuis", () => new SimhuisAdapter());

  if (process.env.NODE_ENV === "test") {
    const { MockAdapter } = await import("./mock/adapter");
    if (!providerRegistry.isRegistered("mock")) {
      providerRegistry.register("mock", () => new MockAdapter());
    }
  }
}
