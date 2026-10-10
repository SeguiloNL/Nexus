/**
 * Simhuis Adapter
 * ----------------
 * Wrapper rond de bestaande Simhuis-integratie (src/server/integrations/simhuis/*).
 *
 * GEEN code duplicatie van de originele service — alle logica leeft nog in de
 * originele Simhuis service en client. Deze adapter vertaalt alleen types en
 * voert de capability / activeringsguards uit.
 */

import {
  activateSim as simhuisActivateSim,
  deactivateSim as simhuisDeactivateSim,
  getAssetByIccid as simhuisGetAssetByIccid,
  getSimStatus as simhuisGetSimStatus,
  getSimStatusFast as simhuisGetSimStatusFast,
  listAllSims as simhuisListAllSims,
  precheckProductAvailability as simhuisPrecheckProductAvailability,
  purgeSimhuisAsset,
  subscribeSimhuisAsset,
  suspendSimhuisAsset,
  unsuspendSimhuisAsset,
  toSimStatus as simhuisToSimStatus,
} from "@/server/integrations/simhuis/service";
import { simhuisClient, SimhuisApiError } from "@/server/integrations/simhuis/client";
import type {
  SimhuisAssetActionResult,
  SimhuisPurgeResult,
  SimhuisSimStatus,
  SimhuisSubscribeResult,
  UsageSource,
  SimhuisBundleUsage,
} from "@/server/integrations/simhuis/types";
import { getSimhuisSettings } from "@/server/services/app-setting.service";

import { PROVIDER_CAPABILITIES_NONE, type SimProviderCapabilities } from "../capabilities";
import {
  ProviderApiError,
  ProviderAuthenticationError,
  ProviderCapabilityNotSupportedError,
  ProviderError,
  ProviderTimeoutError,
} from "../errors";
import type {
  ProviderActivateOptions,
  ProviderActivateResult,
  ProviderAssetActionResult,
  ProviderBundleUsage,
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
import { providerRegistry } from "../registry";

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
  purgeAsset: true,
  syncUsage: true,
  testConnection: true,
  supportsDefaultProducts: true,
  // Simhuis biedt geen idempotency-keys en geen webhooks vandaag
  supportsIdempotency: false,
  supportsWebhooks: false,
};

export class SimhuisAdapter implements SimProviderAdapter {
  public readonly providerKey = "simhuis";
  public readonly displayName = "Simhuis";
  public readonly capabilities = CAPABILITIES;

  // ------------------------------------------------------------
  // Configuratie
  // ------------------------------------------------------------
  async isConfigured(): Promise<boolean> {
    // 1) Client singleton (DB + env fallback)
    if (await simhuisClient.isConfigured()) return true;
    // 2) AppSetting fallback
    return (await getSimhuisSettings()) !== null;
  }

  // ------------------------------------------------------------
  // Conversie helpers
  // ------------------------------------------------------------
  private mapBundle(b: SimhuisBundleUsage | null | undefined): ProviderBundleUsage | null {
    if (!b) return null;
    const toBig = (v: number | null | undefined): bigint | number | null =>
      v === null || v === undefined ? null : BigInt(v);
    return {
      bundleId: b.bundleId ?? null,
      localProductId: b.localProductId ?? null,
      localProductName: b.localProductName ?? null,
      productName: b.productName ?? null,
      sharedDataPoolId: b.sharedDataPoolId ?? null,
      dataUsedBytes: toBig(b.dataUsedBytes),
      remainingBytes: toBig(b.remainingBytes),
      initialSizeBytes: toBig(b.initialSizeBytes),
      smsUsedCount: b.smsUsedCount ?? null,
      periodStart: b.periodStart ?? null,
      periodEnd: b.periodEnd ?? null,
      isActiveNow: b.isActiveNow ?? null,
      isExpired: b.isExpired ?? null,
      isFuture: b.isFuture ?? null,
      subscriptionIndex: b.subscriptionIndex,
      bundleIndex: b.bundleIndex,
      rawBundle: b.rawBundle,
    };
  }

  private mapStatus(raw: SimhuisSimStatus): ProviderSimStatus {
    const toBig = (v: number | null | undefined): bigint | number | null =>
      v === null || v === undefined ? null : BigInt(v);
    const bundles = (raw.usageBundleUsages ?? []).map((b) => this.mapBundle(b)).filter(
      (b): b is ProviderBundleUsage => b !== null,
    );
    const status: ProviderSimLifecycle = (() => {
      const s = String(raw.status ?? "").toLowerCase();
      if (s === "active" || s === "inactive" || s === "suspended" || s === "terminated" || s === "provisioning") {
        return s as ProviderSimLifecycle;
      }
      return null;
    })();
    return {
      iccid: raw.iccid,
      eid: raw.eid ?? null,
      imsi: raw.imsi ?? null,
      msisdn: raw.msisdn ?? null,
      subscriberId: raw.subscriberId ?? null,
      simName: raw.simName ?? raw.displayName ?? raw.assetName ?? raw.label ?? null,
      displayName: raw.displayName ?? raw.assetName ?? null,
      group: raw.group ?? raw.groupName ?? raw.groupId ?? null,
      poolName: raw.poolName ?? null,
      batchName: raw.batchName ?? null,
      productName: raw.productName ?? raw.offerName ?? null,
      productCode: raw.productCode ?? null,
      productType: raw.productType ?? raw.productCategory ?? null,
      status,
      ip: raw.ip ?? null,
      network: raw.network ?? null,
      dataUsedBytes: toBig(raw.dataUsedBytes),
      dataLimitBytes: toBig(raw.dataLimitBytes),
      lowestDataLimitBytes: toBig(raw.lowestDataLimitBytes),
      smsUsedCount: raw.smsUsedCount ?? null,
      smsLimitCount: raw.smsLimitCount ?? null,
      lowestSmsLimitCount: raw.lowestSmsLimitCount ?? null,
      activatedAt: raw.activatedAt ?? raw.activationDate ?? null,
      subscriptionDate: raw.subscriptionDate ?? null,
      usageSource: (raw.usageSource ?? "NONE") as UsageSource | "NONE",
      usageBundleId: raw.usageBundleId ?? null,
      usageLocalProductId: raw.usageLocalProductId ?? null,
      usageLocalProductName: raw.usageLocalProductName ?? null,
      usagePeriodStart: raw.usagePeriodStart ?? null,
      usagePeriodEnd: raw.usagePeriodEnd ?? null,
      usageRetrievedAt: raw.usageRetrievedAt ?? null,
      usageCdrQueryStart: raw.usageCdrQueryStart ?? null,
      usageCdrQueryEnd: raw.usageCdrQueryEnd ?? null,
      usageBundleUsages: bundles,
      usageSelectionNote: raw.usageSelectionNote ?? null,
      raw: raw.raw,
    };
  }

  private wrapSimhuisErr(err: unknown, action: string, iccid?: string): never {
    const prefix = iccid ? `iccid=${iccid} :: ` : "";
    if (err instanceof SimhuisApiError) {
      const statusCode = err.statusCode ?? 0;
      if (statusCode === 401 || statusCode === 403) {
        throw new ProviderAuthenticationError(this.providerKey);
      }
      // Veilige boodschap: bevat nooit credentials
      const safe = `Actie “${action}” mislukt (HTTP ${statusCode}).`;
      throw new ProviderApiError(this.providerKey, safe, statusCode, {
        detail: { action, iccid, message: err.message },
      });
    }
    // Timeout of netwerkfout (gesimuleerd via boodschap)
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network|fetch failed/i.test(msg)) {
      throw new ProviderTimeoutError(this.providerKey, action);
    }
    // Fallback: generieke provider error
    throw new ProviderError("PROVIDER_REJECTED", `${prefix}Actie “${action}” is mislukt.`, {
      cause: err,
      detail: { action, iccid, message: msg },
    });
  }

  // ------------------------------------------------------------
  // LIJST / STATUS
  // ------------------------------------------------------------
  async listSims(): Promise<ProviderSimStatus[]> {
    try {
      const rows = await simhuisListAllSims();
      return rows.map((r) => this.mapStatus(r));
    } catch (err) {
      return this.wrapSimhuisErr(err, "listSims");
    }
  }

  async getSimStatus(iccid: string): Promise<ProviderSimStatus | null> {
    try {
      const s = await simhuisGetSimStatus(iccid);
      if (!s) return null;
      return this.mapStatus(s);
    } catch (err) {
      // 404 voor niet-gevonden ICCID: terug naar null
      if (err instanceof SimhuisApiError && (err.statusCode === 404 || /not found/i.test(err.message))) {
        return null;
      }
      return this.wrapSimhuisErr(err, "getSimStatus", iccid);
    }
  }

  async getSimStatusFast(iccid: string): Promise<ProviderSimLifecycle> {
    try {
      const raw = await simhuisGetSimStatusFast(iccid);
      if (!raw) return null;
      const s = String(raw.status ?? "").toLowerCase();
      if (s === "active" || s === "inactive" || s === "suspended" || s === "terminated" || s === "provisioning") {
        return s as ProviderSimLifecycle;
      }
      return null;
    } catch (err) {
      return this.wrapSimhuisErr(err, "getSimStatusFast", iccid);
    }
  }

  // ------------------------------------------------------------
  // MUTATIES — Altijd eerst guardActivated
  // ------------------------------------------------------------
  async activateSim(options: ProviderActivateOptions): Promise<ProviderActivateResult> {
    await providerRegistry.guardActivated(this.providerKey);
    try {
      // Vul default offer/plan/reseller in wanneer niet expliciet meegegeven
      let offerId = options.offerId ?? null;
      let planId = options.planId ?? null;
      let resellerId = options.resellerId ?? null;
      if (!offerId || !planId || !resellerId) {
        const s = await getSimhuisSettings();
        if (s) {
          offerId = offerId ?? s.defaultOfferId ?? null;
          planId = planId ?? s.defaultPlanId ?? null;
          resellerId = resellerId ?? s.resellerId ?? null;
        }
      }
      const result = await simhuisActivateSim({
        iccid: options.iccid,
        offerId,
        planId,
        resellerId,
        customerRef: options.customerRef ?? null,
      });
      return {
        ok: true,
        confirmedStatus: this.mapStatus(result).status,
        externalId: result.subscriberId ?? null,
        raw: result.raw,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, "activateSim", options.iccid);
    }
  }

  async deactivateSim(iccid: string): Promise<ProviderAssetActionResult> {
    await providerRegistry.guardActivated(this.providerKey);
    try {
      const r = (await simhuisDeactivateSim(iccid)) as unknown as SimhuisAssetActionResult;
      const status = this.stringToLifecycle((r as unknown as SimhuisSimStatus).status as string | undefined);
      return {
        ok: r.ok !== false,
        confirmedStatus: status,
        accountIdUsed: (r as SimhuisAssetActionResult).accountIdUsed ?? null,
        httpStatus: (r as SimhuisAssetActionResult).httpStatusPut,
        raw: r,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, "deactivateSim", iccid);
    }
  }

  async suspendSim(iccid: string): Promise<ProviderAssetActionResult> {
    await providerRegistry.guardActivated(this.providerKey);
    return this.assetAction(() => suspendSimhuisAsset(iccid), iccid, "suspendSim");
  }

  async unsuspendSim(iccid: string): Promise<ProviderAssetActionResult> {
    await providerRegistry.guardActivated(this.providerKey);
    return this.assetAction(() => unsuspendSimhuisAsset(iccid), iccid, "unsuspendSim");
  }

  async subscribeToProduct(
    iccid: string,
    options: ProviderSubscribeOptions,
  ): Promise<ProviderAssetActionResult> {
    await providerRegistry.guardActivated(this.providerKey);
    try {
      const r: SimhuisSubscribeResult = await subscribeSimhuisAsset(iccid, {
        productId: options.productId,
        subscriberAccountId: options.subscriberAccountId,
        startTime: options.startTime,
        ipPools: options.ipPools,
      });
      const status = this.stringToLifecycle(r.confirmedSimhuisStatus);
      return {
        ok: r.ok,
        confirmedStatus: status,
        accountIdUsed: r.accountIdUsed ?? null,
        httpStatus: r.httpStatusPut,
        externalId: r.confirmedLocalProductId ?? null,
        safeMessage: r.error?.detail,
        raw: r,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, "subscribeToProduct", iccid);
    }
  }

  async purgeAsset(iccid: string): Promise<ProviderPurgeResult> {
    await providerRegistry.guardActivated(this.providerKey);
    try {
      const r: SimhuisPurgeResult = await purgeSimhuisAsset(iccid);
      return {
        ok: r.ok,
        accountIdUsed: r.accountIdUsed ?? null,
        httpStatus: r.httpStatus,
        safeMessage: r.error?.detail,
        raw: r,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, "purgeAsset", iccid);
    }
  }

  private async assetAction(
    fn: () => Promise<SimhuisAssetActionResult>,
    iccid: string,
    action: string,
  ): Promise<ProviderAssetActionResult> {
    try {
      const r: SimhuisAssetActionResult = await fn();
      const status = this.stringToLifecycle(r.confirmedSimhuisStatus);
      return {
        ok: r.ok,
        confirmedStatus: status,
        accountIdUsed: r.accountIdUsed ?? null,
        httpStatus: r.httpStatusPut,
        safeMessage: r.error?.detail,
        raw: r,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, action, iccid);
    }
  }

  private stringToLifecycle(s: string | null | undefined): ProviderSimLifecycle {
    const x = String(s ?? "").toLowerCase();
    if (x === "active" || x === "inactive" || x === "suspended" || x === "terminated" || x === "provisioning") {
      return x as ProviderSimLifecycle;
    }
    return null;
  }

  // ------------------------------------------------------------
  // Precheck / asset / usage / default products / test connection
  // ------------------------------------------------------------
  async precheckProductAvailability(iccid: string, productId: string): Promise<ProviderPrecheckResult> {
    try {
      const r = await simhuisPrecheckProductAvailability(iccid, productId);
      return {
        ok: !!r && !!(r as unknown as { ok?: boolean }).ok !== false,
        productName: (r as unknown as { productName?: string | null }).productName ?? null,
        availableForIccid: (r as unknown as { available?: boolean }).available ?? true,
        raw: r,
      };
    } catch (err) {
      return this.wrapSimhuisErr(err, "precheckProductAvailability", iccid);
    }
  }

  async getAssetByIccid(iccid: string): Promise<{
    accountId: string | null;
    externalId?: string | null;
    raw?: unknown;
  } | null> {
    try {
      const r = await simhuisGetAssetByIccid(iccid);
      if (!r) return null;
      const rr = r as unknown as { accountId?: string | null; subscriberId?: string | null; assetId?: string | null };
      return {
        accountId: rr.accountId ?? null,
        externalId: rr.assetId ?? rr.subscriberId ?? null,
        raw: r,
      };
    } catch (err) {
      if (err instanceof SimhuisApiError && (err.statusCode === 404 || /not found/i.test(err.message))) {
        return null;
      }
      return this.wrapSimhuisErr(err, "getAssetByIccid", iccid);
    }
  }

  /**
   * syncUsage — alias voor listSims, want Simhuis listAllSims retourneert reeds
   * de verbruiksdata per SIM. Altijd de capability check.
   */
  async syncUsage(iccidList?: string[]): Promise<ProviderSimStatus[]> {
    const all = await this.listSims();
    if (!iccidList || iccidList.length === 0) return all;
    const set = new Set(iccidList);
    return all.filter((s) => set.has(s.iccid));
  }

  async testConnection(): Promise<ProviderTestConnectionResult> {
    try {
      const r = await simhuisClient.testConnection();
      return {
        ok: r.ok,
        status: r.status,
        latencyMs: r.latencyMs,
        endpoint: r.endpoint ?? null,
        safeError: r.ok ? undefined : r.error ?? "Verbinding met Simhuis mislukt.",
      };
    } catch (err) {
      if (err instanceof SimhuisApiError) {
        return {
          ok: false,
          status: err.statusCode,
          safeError: `HTTP ${err.statusCode} — authenticatie of endpoint ongeldig.`,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|ETIMEDOUT|ECONN/i.test(msg)) {
        return { ok: false, safeError: "Time-out — Simhuis-server onbereikbaar." };
      }
      return { ok: false, safeError: "Onbekende fout tijdens verbindingstest." };
    }
  }

  async getDefaultProducts(): Promise<ProviderDefaultProducts> {
    const s = await getSimhuisSettings();
    if (!s) return {};
    return {
      defaultOfferId: s.defaultOfferId ?? null,
      defaultPlanId: s.defaultPlanId ?? null,
      defaultProductName: s.defaultProductName ?? null,
      resellerId: s.resellerId ?? null,
    };
  }

  // ------------------------------------------------------------
  // Webhooks: Simhuis heeft vandaag geen webhook-interface
  // ------------------------------------------------------------
  async handleWebhook(
    _payload: unknown,
    _headers: Record<string, string | string[] | undefined>,
    _signature?: string,
  ): Promise<ProviderWebhookResult> {
    throw new ProviderCapabilityNotSupportedError(this.providerKey, "supportsWebhooks");
  }
}
