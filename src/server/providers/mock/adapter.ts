/**
 * Mock Provider Adapter (test-only / dev-sample)
 * -----------------------------------------------
 * DOEL: Aantonen dat een tweede leverancier zonder wijzigingen
 *       aan bestaande adapters of services toegevoegd kan worden.
 *       Wordt alleen in het registry geregistreerd wanneer
 *       NODE_ENV === 'test'. NIET presenteren als werkende
 *       leverancierskoppeling.
 *
 * RESTRICTIE: Bevat GEEN imports van simhuis/* files.
 */

import { PROVIDER_CAPABILITIES_NONE, type SimProviderCapabilities } from "../capabilities";
import { ProviderCapabilityNotSupportedError } from "../errors";
import type {
  ProviderActivateOptions,
  ProviderActivateResult,
  ProviderAssetActionResult,
  ProviderDefaultProducts,
  ProviderPrecheckResult,
  ProviderPurgeResult,
  ProviderSimLifecycle,
  ProviderSimStatus,
  ProviderSubscribeOptions,
  ProviderTestConnectionResult,
  ProviderWebhookResult,
  SimProviderAdapter,
} from "../types";

const CAPABILITIES: SimProviderCapabilities = {
  ...PROVIDER_CAPABILITIES_NONE,
  listSims: true,
  getSimStatus: true,
  getSimStatusFast: true,
  activateSim: true,
  deactivateSim: true,
  suspendSim: true,
  unsuspendSim: true,
  subscribeToProduct: true,
  precheckProductAvailability: true,
  getAssetByIccid: true,
  // Let op: purgeAsset = NIET ondersteund. Dient als voorbeeld hoe
  // een capability-fout gehandeld wordt in de centrale laag.
  purgeAsset: false,
  syncUsage: true,
  testConnection: true,
  supportsDefaultProducts: true,
  supportsWebhooks: true,
  supportsIdempotency: false,
};

type InMemorySim = {
  iccid: string;
  eid?: string;
  msisdn?: string;
  subscriberId?: string;
  status: ProviderSimLifecycle;
  productName?: string;
  dataUsedBytes: bigint;
  dataLimitBytes: bigint;
};

function initialSims(): InMemorySim[] {
  const base: Omit<InMemorySim, "iccid" | "msisdn" | "subscriberId">[] = [
    { status: "active", productName: "Mock 5GB M2M", dataUsedBytes: 480_000_000n, dataLimitBytes: 5_368_709_120n },
    { status: "active", productName: "Mock 5GB M2M", dataUsedBytes: 120_000_000n, dataLimitBytes: 5_368_709_120n },
    { status: "suspended", productName: "Mock 1GB Lite",  dataUsedBytes: 800_000_000n, dataLimitBytes: 1_073_741_824n },
    { status: "inactive",  productName: "Mock 1GB Lite",  dataUsedBytes: 0n,              dataLimitBytes: 1_073_741_824n },
    { status: "active", productName: "Mock 10GB XL",  dataUsedBytes: 2_500_000_000n, dataLimitBytes: 10_737_418_240n },
    { status: "provisioning", productName: "Mock 5GB M2M", dataUsedBytes: 0n, dataLimitBytes: 5_368_709_120n },
    { status: "active", productName: "Mock 5GB M2M", dataUsedBytes: 3_000_000_000n, dataLimitBytes: 5_368_709_120n },
    { status: "active", productName: "Mock 100GB Pool", dataUsedBytes: 15_000_000_000n, dataLimitBytes: 107_374_182_400n },
    { status: "terminated", productName: "Mock 1GB Lite",  dataUsedBytes: 900_000_000n, dataLimitBytes: 1_073_741_824n },
    { status: "active", productName: "Mock 5GB M2M", dataUsedBytes: 1_000_000_000n, dataLimitBytes: 5_368_709_120n },
  ];
  return base.map((row, i) => ({
    iccid: `89000000000000000${90 + i}`,
    msisdn: `+319700${String(1000 + i).padStart(4, "0")}`,
    subscriberId: `MOCK-SUB-${String(10_000 + i)}`,
    ...row,
  }));
}

export class MockAdapter implements SimProviderAdapter {
  public readonly providerKey = "mock";
  public readonly displayName = "Mock Provider";
  public readonly capabilities = CAPABILITIES;

  private sims: InMemorySim[] = initialSims();
  private connected = true;
  private configured = true;

  // Test-only API — wordt NIET naar de UI blootgesteld
  public _reset(): void { this.sims = initialSims(); this.connected = true; this.configured = true; }
  public _setConnected(ok: boolean): void { this.connected = ok; }
  public _setConfigured(cfg: boolean): void { this.configured = cfg; }

  async isConfigured(): Promise<boolean> {
    return this.configured;
  }

  // ----------------------------------------
  // Conversie intern → ProviderSimStatus
  // ----------------------------------------
  private toStatus(s: InMemorySim): ProviderSimStatus {
    return {
      iccid: s.iccid,
      msisdn: s.msisdn ?? null,
      subscriberId: s.subscriberId ?? null,
      productName: s.productName ?? null,
      status: s.status,
      dataUsedBytes: s.dataUsedBytes,
      dataLimitBytes: s.dataLimitBytes,
    };
  }

  private find(iccid: string): InMemorySim | undefined {
    return this.sims.find((s) => s.iccid === iccid);
  }

  // ----------------------------------------
  // Lijst / Status
  // ----------------------------------------
  async listSims(): Promise<ProviderSimStatus[]> {
    return this.sims.map((s) => this.toStatus(s));
  }

  async getSimStatus(iccid: string): Promise<ProviderSimStatus | null> {
    const s = this.find(iccid);
    return s ? this.toStatus(s) : null;
  }

  async getSimStatusFast(iccid: string): Promise<ProviderSimLifecycle> {
    return this.find(iccid)?.status ?? null;
  }

  // ----------------------------------------
  // Mutaties
  // ----------------------------------------
  async activateSim(options: ProviderActivateOptions): Promise<ProviderActivateResult> {
    const s = this.find(options.iccid);
    if (!s) {
      return { ok: false, safeMessage: `ICCID ${options.iccid} onbekend bij Mock.` };
    }
    s.status = "active";
    return { ok: true, confirmedStatus: "active", externalId: s.subscriberId ?? null };
  }

  async deactivateSim(iccid: string): Promise<ProviderAssetActionResult> {
    const s = this.find(iccid);
    if (!s) return { ok: false, safeMessage: `ICCID ${iccid} onbekend.` };
    s.status = "inactive";
    return { ok: true, confirmedStatus: "inactive", accountIdUsed: s.subscriberId ?? null };
  }

  async suspendSim(iccid: string): Promise<ProviderAssetActionResult> {
    const s = this.find(iccid);
    if (!s) return { ok: false, safeMessage: `ICCID ${iccid} onbekend.` };
    s.status = "suspended";
    return { ok: true, confirmedStatus: "suspended", accountIdUsed: s.subscriberId ?? null };
  }

  async unsuspendSim(iccid: string): Promise<ProviderAssetActionResult> {
    const s = this.find(iccid);
    if (!s) return { ok: false, safeMessage: `ICCID ${iccid} onbekend.` };
    s.status = "active";
    return { ok: true, confirmedStatus: "active", accountIdUsed: s.subscriberId ?? null };
  }

  async subscribeToProduct(
    iccid: string,
    options: ProviderSubscribeOptions,
  ): Promise<ProviderAssetActionResult> {
    const s = this.find(iccid);
    if (!s) return { ok: false, safeMessage: `ICCID ${iccid} onbekend.` };
    s.productName = options.productId;
    s.status = "active";
    return {
      ok: true,
      confirmedStatus: "active",
      accountIdUsed: options.subscriberAccountId,
      externalId: options.productId,
    };
  }

  /** Expliciet niet ondersteund — capability=false — guard moet dit onderscheppen */
  async purgeAsset(iccid: string): Promise<ProviderPurgeResult> {
    throw new ProviderCapabilityNotSupportedError(this.providerKey, "purgeAsset");
  }

  // ----------------------------------------
  // Precheck / asset / usage / default products / connection test
  // ----------------------------------------
  async precheckProductAvailability(_iccid: string, productId: string): Promise<ProviderPrecheckResult> {
    const allowed = ["Mock 5GB M2M", "Mock 1GB Lite", "Mock 10GB XL", "Mock 100GB Pool"];
    if (allowed.includes(productId)) return { ok: true, productName: productId, availableForIccid: true };
    return {
      ok: false,
      productName: productId,
      availableForIccid: false,
      safeMessage: `Product ${productId} is niet in het Mock-aanbod.`,
    };
  }

  async getAssetByIccid(iccid: string): Promise<{ accountId: string | null; externalId?: string | null; raw?: unknown } | null> {
    const s = this.find(iccid);
    if (!s) return null;
    return {
      accountId: s.subscriberId ?? null,
      externalId: `MOCK-ASSET-${s.iccid}`,
      raw: s,
    };
  }

  async syncUsage(iccidList?: string[]): Promise<ProviderSimStatus[]> {
    // Simuleer: verbruik neemt telkens 1MB toe (demo)
    for (const s of this.sims) {
      s.dataUsedBytes += 1_000_000n;
    }
    const all = this.sims.map((s) => this.toStatus(s));
    if (!iccidList || iccidList.length === 0) return all;
    const set = new Set(iccidList);
    return all.filter((s) => set.has(s.iccid));
  }

  async testConnection(): Promise<ProviderTestConnectionResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    const latency = Date.now() - start;
    if (this.connected) {
      return { ok: true, status: 200, latencyMs: latency, endpoint: "https://mock.local/v1/ping" };
    }
    return { ok: false, status: 503, latencyMs: latency, safeError: "Mock endpoint is offline." };
  }

  async getDefaultProducts(): Promise<ProviderDefaultProducts> {
    return {
      defaultOfferId: "MOCK-OFFER-5GB",
      defaultPlanId: "MOCK-PLAN-STANDARD",
      defaultProductName: "Mock 5GB M2M",
      resellerId: "MOCK-RESELLER-001",
    };
  }

  async handleWebhook(
    payload: unknown,
    _headers: Record<string, string | string[] | undefined>,
    signature?: string,
  ): Promise<ProviderWebhookResult> {
    // Simpele demo: als signature "mock-signature" retourneer handled=true
    const p = payload as { eventId?: string; eventType?: string; iccid?: string; subscriberId?: string } | null;
    const handled = signature === "mock-signature" || !!p?.eventId;
    return {
      ok: true,
      eventId: p?.eventId ?? null,
      eventType: p?.eventType ?? null,
      iccid: p?.iccid ?? null,
      subscriberId: p?.subscriberId ?? null,
      handled,
    };
  }
}
