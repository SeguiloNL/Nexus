/**
 * Modulair Leverancierssysteem — Generieke (interne) types
 * ---------------------------------------------------------
 * De centrale applicatie praat ALLEEN via deze types met adapters.
 * Leveranciersspecifieke responses leven alleen binnen de adapter
 * en worden hiernaartoe vertaald.
 */

import type { SimProviderCapabilities } from './capabilities';

// ------------------------------------------------------------
// Provider SIM status — het universele equivalent van
// SimhuisSimStatus, maar zonder Simhuis-specifieke velden.
// ------------------------------------------------------------
export type ProviderSimLifecycle =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'terminated'
  | 'provisioning'
  | null;

export interface ProviderBundleUsage {
  bundleId?: string | null;
  localProductId?: string | null;
  localProductName?: string | null;
  productName?: string | null;
  sharedDataPoolId?: string | null;
  dataUsedBytes?: bigint | number | null;
  remainingBytes?: bigint | number | null;
  initialSizeBytes?: bigint | number | null;
  smsUsedCount?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  isActiveNow?: boolean | null;
  isExpired?: boolean | null;
  isFuture?: boolean | null;
  subscriptionIndex?: number;
  bundleIndex?: number;
  rawBundle?: unknown;
}

export interface ProviderSimStatus {
  iccid: string;
  eid?: string | null;
  imsi?: string | null;
  msisdn?: string | null;
  subscriberId?: string | null;
  simName?: string | null;
  displayName?: string | null;
  group?: string | null;
  poolName?: string | null;
  batchName?: string | null;
  productName?: string | null;
  productCode?: string | null;
  productType?: string | null;
  status: ProviderSimLifecycle;
  ip?: string | null;
  network?: string | null;
  dataUsedBytes?: bigint | number | null;
  dataLimitBytes?: bigint | number | null;
  lowestDataLimitBytes?: bigint | number | null;
  smsUsedCount?: number | null;
  smsLimitCount?: number | null;
  lowestSmsLimitCount?: number | null;
  activatedAt?: string | null;
  subscriptionDate?: string | null;
  usageSource?: 'BUNDLE_COUNTER' | 'CDR_STATS' | 'UNKNOWN' | 'NONE';
  usageBundleId?: string | null;
  usageLocalProductId?: string | null;
  usageLocalProductName?: string | null;
  usagePeriodStart?: string | null;
  usagePeriodEnd?: string | null;
  usageRetrievedAt?: string | null;
  usageCdrQueryStart?: string | null;
  usageCdrQueryEnd?: string | null;
  usageBundleUsages?: ProviderBundleUsage[] | null;
  usageSelectionNote?: string | null;
  /** Provider-specifieke response, nooit naar UI of logs sturen. */
  raw?: unknown;
}

// ------------------------------------------------------------
// Acties / Resultaten
// ------------------------------------------------------------
export interface ProviderActivateOptions {
  iccid: string;
  offerId?: string | null;
  planId?: string | null;
  resellerId?: string | null;
  customerRef?: string | null;
}

export interface ProviderActivateResult {
  ok: boolean;
  confirmedStatus?: ProviderSimLifecycle;
  httpStatus?: number;
  externalId?: string | null;
  safeMessage?: string | null;
  raw?: unknown;
}

export interface ProviderSubscribeOptions {
  productId: string;
  subscriberAccountId: string;
  startTime?: string;
  ipPools?: string[] | Record<string, string>;
}

export interface ProviderAssetActionResult {
  ok: boolean;
  confirmedStatus?: ProviderSimLifecycle;
  accountIdUsed?: string | null;
  httpStatus?: number;
  externalId?: string | null;
  safeMessage?: string | null;
  raw?: unknown;
}

export interface ProviderPurgeResult {
  ok: boolean;
  accountIdUsed?: string | null;
  httpStatus?: number;
  safeMessage?: string | null;
  raw?: unknown;
}

export interface ProviderPrecheckResult {
  ok: boolean;
  productName?: string | null;
  availableForIccid?: boolean;
  safeMessage?: string | null;
  raw?: unknown;
}

export interface ProviderTestConnectionResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  endpoint?: string | null;
  safeError?: string | null;
}

export interface ProviderDefaultProducts {
  defaultOfferId?: string | null;
  defaultPlanId?: string | null;
  defaultProductName?: string | null;
  resellerId?: string | null;
}

/**
 * Het "schone" Webhook-resultaat. De adapter returned dit na validatie
 * van signature en parsing van payload. De centrale laag gebruikt het
 * eventId voor eventuele LRU-deduplicatie wanneer idempotency=false.
 */
export interface ProviderWebhookResult {
  ok: boolean;
  eventId?: string | null;
  eventType?: string | null;
  iccid?: string | null;
  subscriberId?: string | null;
  handled: boolean;
  safeMessage?: string | null;
  raw?: unknown;
}

// ------------------------------------------------------------
// Registry info (meta) — voor UI / listAll().
// ------------------------------------------------------------
export type RegisteredProviderStatus = 'registered' | 'configured' | 'activated' | 'connected';

export interface RegisteredProviderInfo {
  providerKey: string;
  displayName: string;
  status: RegisteredProviderStatus;
  registered: boolean;
  configured: boolean;
  activated: boolean;
  connected: boolean | null;
  lastConnectionCheckedAt?: Date | null;
  lastConnectionLatencyMs?: number | null;
  lastConnectionErrorSafe?: string | null;
  capabilities: SimProviderCapabilities;
}

// ------------------------------------------------------------
// Central Interface
// ------------------------------------------------------------
export interface SimProviderAdapter {
  readonly providerKey: string;
  readonly displayName: string;
  readonly capabilities: Readonly<SimProviderCapabilities>;

  /** Lijst alle SIMs van de provider. Alleen listSims=true. */
  listSims?(): Promise<ProviderSimStatus[]>;

  /** Volledige status voor 1 ICCID. */
  getSimStatus?(iccid: string): Promise<ProviderSimStatus | null>;

  /** Snelle status (alleen lifecycle) — optioneel, default = getSimStatus. */
  getSimStatusFast?(iccid: string): Promise<ProviderSimLifecycle>;

  /** Activeer SIM. */
  activateSim?(options: ProviderActivateOptions): Promise<ProviderActivateResult>;

  /** Deactiveer SIM. */
  deactivateSim?(iccid: string): Promise<ProviderAssetActionResult>;

  /** Schors SIM. */
  suspendSim?(iccid: string): Promise<ProviderAssetActionResult>;

  /** Hef schorsing op. */
  unsuspendSim?(iccid: string): Promise<ProviderAssetActionResult>;

  /** Abonneer SIM op product. */
  subscribeToProduct?(iccid: string, options: ProviderSubscribeOptions): Promise<ProviderAssetActionResult>;

  /** Controleer of product beschikbaar is voor deze SIM. */
  precheckProductAvailability?(iccid: string, productId: string): Promise<ProviderPrecheckResult>;

  /** Haal asset record op via ICCID (assetId / accountId). */
  getAssetByIccid?(iccid: string): Promise<{ accountId: string | null; externalId?: string | null; raw?: unknown } | null>;

  /** Purge asset (destructief). */
  purgeAsset?(iccid: string): Promise<ProviderPurgeResult>;

  /** Sync verbruik — geeft array van statuses per ICCID. */
  syncUsage?(iccidList?: string[]): Promise<ProviderSimStatus[]>;

  /** Controleert of de benodigde configuratie (credentials) aanwezig is. */
  isConfigured?(): Promise<boolean>;

  /** Test verbinding. MAG ALLEEN LEEZEN, GEEN MUTATIES. */
  testConnection?(): Promise<ProviderTestConnectionResult>;

  /** Eventuele default producten per provider. */
  getDefaultProducts?(): Promise<ProviderDefaultProducts>;

  /** Handler voor inkomende webhooks — signature-validatie leeft in de adapter. */
  handleWebhook?(payload: unknown, headers: Record<string, string | string[] | undefined>, signature?: string): Promise<ProviderWebhookResult>;
}
