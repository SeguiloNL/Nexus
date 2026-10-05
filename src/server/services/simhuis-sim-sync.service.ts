import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import { listAllSims, getSimStatus, simhuisClient } from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import { SimStatus, type UserRole } from "@/types/enums";

type Ctx = { userId?: string; userRole?: UserRole; customerScope?: string[] };

type UsageFields = {
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  lowestDataLimitBytes: bigint | null;
  smsUsedCount: number | null;
  smsLimitCount: number | null;
  lowestSmsLimitCount: number | null;
  lastUsageSyncAt: Date | null;
  usageSource: string | null;
  usageBundleId: string | null;
  usageLocalProductId: string | null;
  usageLocalProductName: string | null;
  usagePeriodStart: Date | null;
  usagePeriodEnd: Date | null;
  usageRetrievedAt: Date | null;
  usageCdrQueryStart: Date | null;
  usageCdrQueryEnd: Date | null;
  usageBundleUsages: any;
  usageSelectionNote: string | null;
  activationDate: Date | null;
  reactivationDate: Date | null;
  subscriptionDate: Date | null;
};

function toDateOrNull(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  try {
    const d = raw instanceof Date ? raw : new Date(String(raw));
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function jsonSafeEq(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

type ProductSimFields = {
  product: string | null;
  productType: string | null;
  simName: string | null;
  simGroup: string | null;
};

type ApplyUsageResult = {
  changed: boolean;
  changedFields: Array<keyof UsageFields>;
  oldData: UsageFields;
  newData: UsageFields;
  hasAnyUsageData: boolean;
};

function buildUsageFieldsFromSimhuis(simhuis: SimhuisSimStatus): Omit<UsageFields, "lastUsageSyncAt"> {
  const dataUsedBytesVal = toBigIntOrNull(simhuis.dataUsedBytes);
  const dataLimitBytesVal = toBigIntOrNull(simhuis.dataLimitBytes);
  const lowestDataLimitBytesVal = toBigIntOrNull(simhuis.lowestDataLimitBytes);
  const smsUsedCountVal: number | null =
    typeof simhuis.smsUsedCount === "number" && Number.isFinite(simhuis.smsUsedCount)
      ? Math.round(simhuis.smsUsedCount)
      : null;
  const smsLimitCountVal: number | null =
    typeof simhuis.smsLimitCount === "number" && Number.isFinite(simhuis.smsLimitCount)
      ? Math.round(simhuis.smsLimitCount)
      : null;
  const lowestSmsLimitCountVal: number | null =
    typeof simhuis.lowestSmsLimitCount === "number" && Number.isFinite(simhuis.lowestSmsLimitCount)
      ? Math.round(simhuis.lowestSmsLimitCount)
      : null;

  const effDataLimitBytesVal: bigint | null =
    dataLimitBytesVal !== null ? dataLimitBytesVal : lowestDataLimitBytesVal;
  const effSmsLimitCountVal: number | null =
    smsLimitCountVal !== null ? smsLimitCountVal : lowestSmsLimitCountVal;
  const effLowestDataLimitBytesVal: bigint | null =
    lowestDataLimitBytesVal !== null ? lowestDataLimitBytesVal : dataLimitBytesVal;
  const effLowestSmsLimitCountVal: number | null =
    lowestSmsLimitCountVal !== null ? lowestSmsLimitCountVal : smsLimitCountVal;

  return {
    dataUsedBytes: dataUsedBytesVal,
    dataLimitBytes: effDataLimitBytesVal,
    lowestDataLimitBytes: effLowestDataLimitBytesVal,
    smsUsedCount: smsUsedCountVal,
    smsLimitCount: effSmsLimitCountVal,
    lowestSmsLimitCount: effLowestSmsLimitCountVal,
    usageSource: truncate((simhuis as any).usageSource ?? null, 30),
    usageBundleId: truncate((simhuis as any).usageBundleId ?? null, 200),
    usageLocalProductId: truncate((simhuis as any).usageLocalProductId ?? null, 200),
    usageLocalProductName: truncate((simhuis as any).usageLocalProductName ?? null, 300),
    usagePeriodStart: toDateOrNull((simhuis as any).usagePeriodStart),
    usagePeriodEnd: toDateOrNull((simhuis as any).usagePeriodEnd),
    usageRetrievedAt: toDateOrNull((simhuis as any).usageRetrievedAt),
    usageCdrQueryStart: toDateOrNull((simhuis as any).usageCdrQueryStart),
    usageCdrQueryEnd: toDateOrNull((simhuis as any).usageCdrQueryEnd),
    usageBundleUsages: (simhuis as any).usageBundleUsages ?? null,
    usageSelectionNote: truncate((simhuis as any).usageSelectionNote ?? null, 10000),
    activationDate: toDateOrNull((simhuis as any).activationDate),
    reactivationDate: toDateOrNull((simhuis as any).reactivationDate),
    subscriptionDate: toDateOrNull((simhuis as any).subscriptionDate),
  };
}

function applyUsageFieldsFromSimhuis(
  existing: UsageFields,
  simhuis: SimhuisSimStatus
): ApplyUsageResult {
  const oldData: UsageFields = {
    dataUsedBytes: existing.dataUsedBytes,
    dataLimitBytes: existing.dataLimitBytes,
    lowestDataLimitBytes: existing.lowestDataLimitBytes,
    smsUsedCount: existing.smsUsedCount,
    smsLimitCount: existing.smsLimitCount,
    lowestSmsLimitCount: existing.lowestSmsLimitCount,
    lastUsageSyncAt: existing.lastUsageSyncAt,
    usageSource: existing.usageSource,
    usageBundleId: existing.usageBundleId,
    usageLocalProductId: existing.usageLocalProductId,
    usageLocalProductName: existing.usageLocalProductName,
    usagePeriodStart: existing.usagePeriodStart,
    usagePeriodEnd: existing.usagePeriodEnd,
    usageRetrievedAt: existing.usageRetrievedAt,
    usageCdrQueryStart: existing.usageCdrQueryStart,
    usageCdrQueryEnd: existing.usageCdrQueryEnd,
    usageBundleUsages: existing.usageBundleUsages,
    usageSelectionNote: existing.usageSelectionNote,
    activationDate: existing.activationDate,
    reactivationDate: existing.reactivationDate,
    subscriptionDate: existing.subscriptionDate,
  };
  const parsed = buildUsageFieldsFromSimhuis(simhuis);
  const newData: UsageFields = {
    ...oldData,
    ...parsed,
  };
  const changedFields: Array<keyof UsageFields> = [];
  let changed = false;

  if (!bigIntEq(oldData.dataUsedBytes, newData.dataUsedBytes)) { changedFields.push("dataUsedBytes"); changed = true; }
  if (!bigIntEq(oldData.dataLimitBytes, newData.dataLimitBytes)) { changedFields.push("dataLimitBytes"); changed = true; }
  if (!bigIntEq(oldData.lowestDataLimitBytes, newData.lowestDataLimitBytes)) { changedFields.push("lowestDataLimitBytes"); changed = true; }
  if (oldData.smsUsedCount !== newData.smsUsedCount) { changedFields.push("smsUsedCount"); changed = true; }
  if (oldData.smsLimitCount !== newData.smsLimitCount) { changedFields.push("smsLimitCount"); changed = true; }
  if (oldData.lowestSmsLimitCount !== newData.lowestSmsLimitCount) { changedFields.push("lowestSmsLimitCount"); changed = true; }

  // usage* velden: NON-NULL PRESERVATION (nieuwere velden, nooit ongedaan maken met null)
  const usageMetadataKeys: Array<keyof UsageFields> = [
    "usageSource", "usageBundleId", "usageLocalProductId", "usageLocalProductName",
    "usagePeriodStart", "usagePeriodEnd", "usageRetrievedAt",
    "usageCdrQueryStart", "usageCdrQueryEnd", "usageSelectionNote",
    "activationDate", "reactivationDate", "subscriptionDate",
  ];
  for (const k of usageMetadataKeys) {
    const nv = (parsed as any)[k];
    if (nv !== null && nv !== undefined && !jsonSafeEq((oldData as any)[k], nv)) {
      (newData as any)[k] = nv;
      changedFields.push(k);
      changed = true;
    } else {
      (newData as any)[k] = (oldData as any)[k];
    }
  }
  if (parsed.usageBundleUsages !== null && parsed.usageBundleUsages !== undefined &&
      !jsonSafeEq(oldData.usageBundleUsages, parsed.usageBundleUsages)) {
    newData.usageBundleUsages = parsed.usageBundleUsages;
    changedFields.push("usageBundleUsages");
    changed = true;
  } else {
    newData.usageBundleUsages = oldData.usageBundleUsages;
  }

  const hasAnyUsageData =
    newData.dataUsedBytes !== null ||
    newData.dataLimitBytes !== null ||
    newData.lowestDataLimitBytes !== null ||
    newData.smsUsedCount !== null ||
    newData.smsLimitCount !== null ||
    newData.lowestSmsLimitCount !== null;

  if (hasAnyUsageData) {
    newData.lastUsageSyncAt = new Date();
    if (oldData.lastUsageSyncAt?.getTime() !== newData.lastUsageSyncAt.getTime()) {
      changedFields.push("lastUsageSyncAt");
      changed = true;
    }
  }

  return { changed, changedFields, oldData, newData, hasAnyUsageData };
}

function truncate(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function toBigIntOrNull(v: number | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  try {
    return BigInt(Math.round(v));
  } catch {
    return null;
  }
}

function bigIntEq(a: bigint | null | undefined, b: bigint | null | undefined): boolean {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return a === b;
}

function strEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return String(a) === String(b);
}

function buildProductSimFieldsFromSimhuis(simhuis: SimhuisSimStatus): ProductSimFields {
  return {
    product: truncate(
      simhuis.productName ?? simhuis.planName ?? simhuis.productCode ?? simhuis.offerName ?? null,
      200
    ),
    productType: truncate(
      simhuis.productType ?? simhuis.productCategory ?? simhuis.subscriptionType ?? simhuis.assetType ?? simhuis.simCategory ?? simhuis.category ?? null,
      150
    ),
    simName: truncate(simhuis.simName ?? simhuis.displayName ?? simhuis.assetName ?? simhuis.label ?? null, 200),
    simGroup: truncate(simhuis.groupName ?? simhuis.groupId ?? simhuis.poolName ?? simhuis.batchName ?? simhuis.group ?? null, 100),
  };
}

type ApplyProductResult = {
  changed: boolean;
  changedFields: Array<keyof ProductSimFields>;
  oldData: ProductSimFields;
  newData: ProductSimFields;
};

function applyProductSimFieldsFromSimhuis(
  existing: ProductSimFields,
  simhuis: SimhuisSimStatus
): ApplyProductResult {
  const oldData: ProductSimFields = {
    product: existing.product,
    productType: existing.productType,
    simName: existing.simName,
    simGroup: existing.simGroup,
  };
  const parsed = buildProductSimFieldsFromSimhuis(simhuis);
  const newData: ProductSimFields = { ...oldData };
  // Pas een Simhuis waarde ALLEEN toe als hij non-empty is (dus niet overschrijven met null)
  if (parsed.product && !strEq(oldData.product, parsed.product)) newData.product = parsed.product;
  if (parsed.productType && !strEq(oldData.productType, parsed.productType)) newData.productType = parsed.productType;
  if (parsed.simName && !strEq(oldData.simName, parsed.simName)) newData.simName = parsed.simName;
  if (parsed.simGroup && !strEq(oldData.simGroup, parsed.simGroup)) newData.simGroup = parsed.simGroup;

  const changedFields: Array<keyof ProductSimFields> = [];
  let changed = false;
  if (!strEq(oldData.product, newData.product)) { changedFields.push("product"); changed = true; }
  if (!strEq(oldData.productType, newData.productType)) { changedFields.push("productType"); changed = true; }
  if (!strEq(oldData.simName, newData.simName)) { changedFields.push("simName"); changed = true; }
  if (!strEq(oldData.simGroup, newData.simGroup)) { changedFields.push("simGroup"); changed = true; }
  return { changed, changedFields, oldData, newData };
}

const VALID_SIM_STATUSES: ReadonlySet<string> = new Set<string>(
  Object.values(SimStatus).map((s) => String(s))
);

function validateAndNormalizeSimStatus(
  value: string | null | undefined | SimStatus,
  context: string
): SimStatus {
  if (value === null || value === undefined) {
    console.warn(
      `[simhuis-sync] ⚠️ Status is leeg voor ${context}. Fallback naar IN_STOCK.`
    );
    return SimStatus.IN_STOCK;
  }
  const normalized = String(value).toUpperCase().replace(/\s+/g, "_");
  if (VALID_SIM_STATUSES.has(normalized)) {
    return normalized as SimStatus;
  }
  if (VALID_SIM_STATUSES.has(String(value))) {
    return value as SimStatus;
  }
  console.warn(
    `[simhuis-sync] ⚠️ Ongeldige SimStatus "${String(
      value
    )}" (normalized="${normalized}") voor ${context}. Geldige waardes: ${Array.from(
      VALID_SIM_STATUSES
    ).join(", ")}. Fallback naar IN_STOCK.`
  );
  return SimStatus.IN_STOCK;
}

const INVALID_IDENTIFIER_PLACEHOLDERS: ReadonlySet<string> = new Set<string>([
  // === Core identifiers: ALLE alias-vormen (case-insensitive) ===
  "iccid",
  "eid", "esimid", "esim_id", "esim", "esimprofileid", "esim_profile_id",
  "profileid", "profile_id", "e_s_sim_id", "esimd", "esim id", "eid id",
  "imsi",
  "msisdn", "phonenumber", "phone_number", "phone", "primarymsisdn",
  "primary_msisdn", "virtualmsisdn", "virtual_msisdn", "msisdnvirtual",
  "virtual_phone_number", "virtualphonenumber", "tel", "telephone", "mobile",
  "mobilenumber", "mobile_number", "cellnumber", "cell_number",
  "subscriberid", "subscriber_id", "subscriber", "subscriptionid",
  "subscription_id", "sub", "subid", "sub_id",
  "assetid", "asset_id", "asset", "deviceid", "device_id", "device",
  "id", "simid", "sim_id", "simcardid", "simcard_id", "simcard",
  // === Overige veldnamen die per ongeluk als waarde kunnen voorkomen ===
  "name", "label", "title", "displayname", "display_name",
  "simname", "sim_name", "sim card name", "simcardname", "sim_card_name",
  "assetname", "asset_name", "customername", "customer_name",
  "accountname", "account_name", "tenantname", "tenant_name",
  "group", "groupid", "group_id", "groupname", "group_name", "grouplabel",
  "pool", "poolid", "pool_id", "poolname", "pool_name",
  "batch", "batchid", "batch_id", "batchname", "batch_name",
  "product", "productname", "product_name", "productcode", "product_code",
  "productid", "producttype", "product_type", "productcategory",
  "product_category", "category", "type", "kind",
  "plantype", "plan_type", "plan", "planname", "plan_name",
  "tariff", "tariffname", "tariff_name", "rateplan", "rate_plan",
  "offer", "offername", "offer_name",
  "package", "packagename", "package_name",
  "bundle", "bundlename", "bundle_name",
  "status", "state", "lifecycle", "lifecycle_status",
  "lifecyclestatus", "simstatus", "sim_status", "simstate", "sim_state",
  "network", "carrier", "provider", "operator", "networkname", "network_name",
  "country", "countryiso", "country_iso",
  "ip", "ipaddress", "ip_address", "lastip", "last_ip",
  // === Usage velden (mogen als identifier nooit verschijnen) ===
  "dataused", "data_used", "datausage", "data_usage",
  "datalimit", "data_limit", "dataquota", "data_quota",
  "lowestdatalimit", "lowest_data_limit", "lowdatalimit", "low_data_limit",
  "datathreshold", "data_threshold", "dataalert", "data_alert",
  "smsused", "sms_used", "smsusage", "sms_usage", "smscount", "sms_count",
  "smslimit", "sms_limit", "smsquota", "sms_quota",
  "lowestsmslimit", "lowest_sms_limit", "lowsmslimit", "low_sms_limit",
  "smsthreshold", "sms_threshold", "smsalert", "sms_alert",
  // === Datum / tijd velden ===
  "activatedat", "activated_at", "activationdate", "activation_date",
  "createdat", "created_at", "provisionedat", "provisioned_at",
  "startdate", "start_date",
  // === Profiel / account-achtige ===
  "account", "accountid", "account_id", "customer", "customerid",
  "customer_id", "tenant", "tenantid", "tenant_id",
  "organization", "organizationid", "organization_id", "org", "orgid", "org_id",
  "reseller", "resellerid", "reseller_id",
  "profile", "profiletype", "profile_type",
  "simtype", "sim_type", "simcategory", "sim_category",
  "assettype", "asset_type", "subscriptiontype", "subscription_type",
  "servicetype", "service_type",
  // === Generieke placeholders ===
  "na", "n/a", "unknown", "none", "empty", "placeholder",
  "null", "undefined", "0", "000000000000000",
  "--", "---", "-",
  // === Value-achtige keys die als placeholder verschijnen ===
  "value", "val", "amount", "count", "total", "remaining",
  "usage", "quota", "allowance", "limit", "used",
]);

function isNotPlaceholder(s: string): boolean {
  const rawLower = s.toLowerCase().trim();
  if (!rawLower) return false;
  if (INVALID_IDENTIFIER_PLACEHOLDERS.has(rawLower)) return false;
  if (rawLower === "null" || rawLower === "undefined") return false;
  // Extra normalizatie: alle separators eruit halen en opnieuw checken
  const stripped = rawLower.replace(/[\s_./\-()]+/g, "");
  if (!stripped) return false;
  if (INVALID_IDENTIFIER_PLACEHOLDERS.has(stripped)) return false;
  return true;
}

// ============================================================
// Aggressieve logging counters voor health-check van sync-batch
// (tijdens hersynchronisatie na leegmaken DB willen we direct
//  zien of extractie goed gaat).
// ============================================================
type ExtractHealthCounters = {
  totalRaw: number;
  withIccidPlaceholder: number;
  withEidPlaceholder: number;
  withMsisdnPlaceholder: number;
  withValidIccid: number;
  withValidEid: number;
  withValidMsisdn: number;
  iccidPlaceholderSamples: string[];
  eidPlaceholderSamples: string[];
  msisdnPlaceholderSamples: string[];
  skippedReasonNoIccid: number;
  skippedReasonDeleted: number;
  skippedReasonLocked: number;
  skippedReasonNoChanges: number;
  skippedReasonPlaceholderIccid: number;
};

function normIccid(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s || !isNotPlaceholder(s)) return null;
  return s.length > 40 ? s.slice(0, 40) : s;
}

function normMsisdn(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const raw = String(v).replace(/\s+/g, "").trim();
  if (!raw || !isNotPlaceholder(raw)) return null;
  const s = raw.replace(/[^\d+]/g, "").trim();
  if (!s || !isNotPlaceholder(s)) return null;
  return s.length > 30 ? s.slice(0, 30) : s;
}

function normImsi(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s || !isNotPlaceholder(s)) return null;
  return s.length > 20 ? s.slice(0, 20) : s;
}

function normEid(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s || !isNotPlaceholder(s)) return null;
  return s.length > 40 ? s.slice(0, 40) : s;
}

function buildSimNotes(simhuis: SimhuisSimStatus): string | null {
  const parts: string[] = [];
  parts.push("Geïmporteerd vanuit Simhuis.");
  if (simhuis.planName) parts.push(`Plan: ${simhuis.planName}.`);
  if (simhuis.productName) parts.push(`Product: ${simhuis.productName}.`);
  if (simhuis.productType) parts.push(`Producttype: ${simhuis.productType}.`);
  if (simhuis.subscriberId) parts.push(`Subscriber ID: ${simhuis.subscriberId}.`);
  if (simhuis.eid) parts.push(`eSIM ID (EID): ${simhuis.eid}.`);
  if (simhuis.simName && simhuis.simName !== "unnamed") parts.push(`SIM Name: ${simhuis.simName}.`);
  if (simhuis.groupName) parts.push(`Groep: ${simhuis.groupName}.`);
  if (simhuis.groupId) parts.push(`Groep ID: ${simhuis.groupId}.`);
  return parts.join(" ");
}

export interface SimhuisSyncResult {
  totalInSimhuis: number;
  eligibleInSimhuis: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
  skippedUniqueIdentifiers: string[];
  lastSyncedAt: Date;
  durationMs: number;
}

export interface SimhuisUsageSyncResult {
  totalActiveInDb: number;
  totalInSimhuis: number;
  matched: number;
  updated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
  lastSyncedAt: Date;
  durationMs: number;
}

function isSimAvailableForStock(status: SimhuisSimStatus["status"]): boolean {
  if (!status) return false;
  const s = String(status).toLowerCase();
  return (
    s === "inactive" ||
    s === "disabled" ||
    s === "offline" ||
    s === "available" ||
    s === "ready"
  );
}

function mapSimhuisStatusToNexus(
  simhuisStatus: SimhuisSimStatus["status"],
  nexusCurrentStatus?: SimStatus | null
): { status: SimStatus; skipIfLocked: boolean } {
  const available = isSimAvailableForStock(simhuisStatus);
  if (available) {
    return { status: SimStatus.IN_STOCK, skipIfLocked: true };
  }
  const s = String(simhuisStatus ?? "").toLowerCase();
  if (s === "active" || s === "enabled" || s === "online") {
    return { status: SimStatus.ACTIVE, skipIfLocked: true };
  }
  if (s === "suspended" || s === "paused" || s === "barred") {
    return { status: SimStatus.SUSPENDED, skipIfLocked: false };
  }
  if (s === "terminated" || s === "deleted" || s === "cancelled" || s === "canceled") {
    return { status: SimStatus.CANCELLED, skipIfLocked: false };
  }
  if (s === "provisioning" || s === "activating" || s === "pending") {
    return { status: SimStatus.RESERVED, skipIfLocked: true };
  }
  return { status: SimStatus.IN_STOCK, skipIfLocked: true };
}

export async function syncAvailableSimsFromSimhuis(ctx: Ctx = {}): Promise<SimhuisSyncResult> {
  const configured = await simhuisClient.isConfigured();
  if (!configured) {
    throw new Error("Simhuis niet geconfigureerd (username en/of password ontbreekt).");
  }

  const startedAt = Date.now();
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errorCount = 0;

  // ============================================================
  // HEALTH COUNTERS: uitgebreide logging zodat we tijdens
  // hersynchronisatie DIRECT zien of extractie/dedup klopt.
  // ============================================================
  const h: ExtractHealthCounters = {
    totalRaw: 0,
    withIccidPlaceholder: 0,
    withEidPlaceholder: 0,
    withMsisdnPlaceholder: 0,
    withValidIccid: 0,
    withValidEid: 0,
    withValidMsisdn: 0,
    iccidPlaceholderSamples: [],
    eidPlaceholderSamples: [],
    msisdnPlaceholderSamples: [],
    skippedReasonNoIccid: 0,
    skippedReasonDeleted: 0,
    skippedReasonLocked: 0,
    skippedReasonNoChanges: 0,
    skippedReasonPlaceholderIccid: 0,
  };

  let allSimsFromSimhuis: SimhuisSimStatus[] = [];
  let simhuisFetchWarning: string | null = null;
  try {
    allSimsFromSimhuis = await listAllSims();
  } catch (e: any) {
    // WANNEER listAllSims() expliciet een Error gooit (wat NIEUWE code doet: enkel
    // in het ECHTE geval dat ook listSims discovery 0 items gaf EN Phase A 0 items had),
    // gooi gewoon door naar UI met duidelijke melding.
    const msg = (e?.message ?? String(e)).slice(0, 4000);
    throw new Error(`Ophalen SIMs van Simhuis mislukt: ${msg}`);
  }

  // Extra sanity: als listAllSims() GEEN fout gooide, MAAR ook 0 sims teruggaf,
  // zet dan een expliciete warning (voor UI) maar BLIJKBAAR gaat de rest van de flow
  // toch door (0 items), zodat health pre-scan zichtbaar blijft.
  if (allSimsFromSimhuis.length === 0) {
    simhuisFetchWarning =
      `[WAARSCHUWING] listAllSims() leverde 0 sims op. Controleer of /v3/esims + /v3/assets ` +
      `met Bearer-token bereikbaar zijn, en of Simhuis actuele data heeft.`;
    try {
      console.warn(`[simhuis-sync] ⚠️ ${simhuisFetchWarning}`);
    } catch { /* ignore */ }
  }

  const totalInSimhuis = allSimsFromSimhuis.length;
  h.totalRaw = totalInSimhuis;
  (h as any)._simhuisFetchWarning = simhuisFetchWarning;

  // === STAP 1: Pre-scan alle Simhuis-records op placeholder-waardes ===
  // (VOOR dat we in de big loop gaan, zodat we logging hebben als
  // extractie aan de kant van Simhuis mis lijkt te gaan).
  for (const s of allSimsFromSimhuis) {
    const rawIccid = typeof s.iccid === "string" ? s.iccid : "";
    const rawEid = typeof s.eid === "string" ? s.eid : "";
    const rawMsisdn = typeof s.msisdn === "string" ? s.msisdn : "";

    if (rawIccid) {
      if (isNotPlaceholder(rawIccid)) {
        h.withValidIccid++;
      } else {
        h.withIccidPlaceholder++;
        if (h.iccidPlaceholderSamples.length < 5) {
          h.iccidPlaceholderSamples.push(JSON.stringify(rawIccid));
        }
      }
    }
    if (rawEid) {
      if (isNotPlaceholder(rawEid)) {
        h.withValidEid++;
      } else {
        h.withEidPlaceholder++;
        if (h.eidPlaceholderSamples.length < 5) {
          h.eidPlaceholderSamples.push(JSON.stringify(rawEid));
        }
      }
    }
    if (rawMsisdn) {
      if (isNotPlaceholder(rawMsisdn)) {
        h.withValidMsisdn++;
      } else {
        h.withMsisdnPlaceholder++;
        if (h.msisdnPlaceholderSamples.length < 5) {
          h.msisdnPlaceholderSamples.push(JSON.stringify(rawMsisdn));
        }
      }
    }
  }

  // Eligible = sims MET een (ruwe) iccid truthy. Daarna doen we
  // binnen de lus nog een normIccid + placeholder-check!
  const eligible = allSimsFromSimhuis.filter((s) => s.iccid);

  // Log de pre-scan health: direct zichtbaar in server logs
  // (handig voor hersynchronisatie na leegmaken DB).
  const pct = (n: number, tot: number): string =>
    tot === 0 ? "0%" : `${((n / tot) * 100).toFixed(1)}%`;
  console.info(
    `[simhuis-sync] 🔍 HEALTH PRE-SCAN Simhuis batch | ` +
    `totaal=${totalInSimhuis} | ` +
    `eligible(iccid truthy)=${eligible.length} | ` +
    `✅ valid-iccid=${h.withValidIccid} (${pct(h.withValidIccid, totalInSimhuis)}) ` +
    `⚠️ iccid-placeholder=${h.withIccidPlaceholder} (${pct(h.withIccidPlaceholder, totalInSimhuis)}) ` +
    `✅ valid-eid=${h.withValidEid} ⚠️ eid-placeholder=${h.withEidPlaceholder} ` +
    `✅ valid-msisdn=${h.withValidMsisdn} ⚠️ msisdn-placeholder=${h.withMsisdnPlaceholder}`
  );
  if (h.iccidPlaceholderSamples.length > 0) {
    console.warn(
      `[simhuis-sync] ⚠️ ICCID PLACEHOLDER SAMPLES (Simhuis geeft veldnaam als waarde!): ${h.iccidPlaceholderSamples.join(", ")}`
    );
  }
  if (h.eidPlaceholderSamples.length > 0) {
    console.warn(
      `[simhuis-sync] ⚠️ EID PLACEHOLDER SAMPLES: ${h.eidPlaceholderSamples.join(", ")}`
    );
  }
  if (h.msisdnPlaceholderSamples.length > 0) {
    console.warn(
      `[simhuis-sync] ⚠️ MSISDN PLACEHOLDER SAMPLES: ${h.msisdnPlaceholderSamples.join(", ")}`
    );
  }
  // Kritische health check: als >25% van de sims placeholder-iccid heeft →
  // grote kans dat extractie mis gaat → log harde waarschuwing.
  if (h.withIccidPlaceholder > 0 && h.withIccidPlaceholder / totalInSimhuis > 0.25) {
    console.error(
      `[simhuis-sync] 🚨 KRITIEK: ${pct(h.withIccidPlaceholder, totalInSimhuis)} van alle SIMs heeft ` +
      `een PLACEHOLDER-ICCID! Simhuis retourneert waarschijnlijk de key/veldnaam in plaats van echte waarde. ` +
      `Dit is de bekende oorzaak van "0 aangemaakt ondanks 327 sims".`
    );
  }

  const byIccid = new Map(eligible.map((s) => [s.iccid, s]));
  const existingSims = await prisma.sIM.findMany({
    where: { iccid: { in: Array.from(byIccid.keys()) } },
    select: {
      id: true,
      iccid: true,
      status: true,
      provider: true,
      msisdn: true,
      imsi: true,
      eid: true,
      subscriberId: true,
      simName: true,
      simGroup: true,
      product: true,
      productType: true,
      simType: true,
      dataUsedBytes: true,
      dataLimitBytes: true,
      lowestDataLimitBytes: true,
      smsUsedCount: true,
      smsLimitCount: true,
      lowestSmsLimitCount: true,
      lastUsageSyncAt: true,
      notes: true,
      deletedAt: true,
      usageSource: true,
      usageBundleId: true,
      usageLocalProductId: true,
      usageLocalProductName: true,
      usagePeriodStart: true,
      usagePeriodEnd: true,
      usageRetrievedAt: true,
      usageCdrQueryStart: true,
      usageCdrQueryEnd: true,
      usageBundleUsages: true,
      usageSelectionNote: true,
      activationDate: true,
      reactivationDate: true,
      subscriptionDate: true,
    },
  });
  const existingByIccid = new Map(existingSims.map((s) => [s.iccid, s]));

  // ============================================================
  // Unique-key conflict preventie (VOORAF)
  // - eid en msisdn zijn UNIQUE in het schema.
  // - We bouwen eerst een map op van alle bestaande non-null waardes
  //   in de *hele* DB (ook niet-sync-targets), zodat we cross-sim
  //   conflicten vooraf kunnen afvangen.
  // - Daarna bijhouden we in deze batch welke waardes al "geclaimed"
  //   zijn tegen race conditions tussen parallelle updates.
  // ============================================================
  const ALL_EXISTING = await prisma.sIM.findMany({
    where: { deletedAt: null },
    select: { id: true, eid: true, msisdn: true },
  });
  const eidOwnerSimId = new Map<string, string>(); // eid -> sim.id
  const msisdnOwnerSimId = new Map<string, string>(); // msisdn -> sim.id
  for (const s of ALL_EXISTING) {
    if (s.eid) {
      const k = s.eid.trim().toLowerCase();
      if (k) eidOwnerSimId.set(k, s.id);
    }
    if (s.msisdn) {
      const k = s.msisdn.trim().toLowerCase();
      if (k) msisdnOwnerSimId.set(k, s.id);
    }
  }
  const claimedEidsLowerThisBatch = new Set<string>();
  const claimedMsisdnsLowerThisBatch = new Set<string>();
  const skippedIdentifiers: string[] = [];

  function resolveEidForSim(simId: string, proposedEid: string | null): string | null {
    if (!proposedEid) return null;
    const low = proposedEid.trim().toLowerCase();
    if (!low) return null;
    const existingOwner = eidOwnerSimId.get(low);
    if (existingOwner && existingOwner !== simId) {
      skippedIdentifiers.push(`EID "${proposedEid}" al in gebruik door SIM-id ${existingOwner} (claim voor ${simId} overgeslagen)`);
      return null;
    }
    if (claimedEidsLowerThisBatch.has(low)) {
      skippedIdentifiers.push(`EID "${proposedEid}" al geclaimd in deze batch (claim voor ${simId} overgeslagen)`);
      return null;
    }
    claimedEidsLowerThisBatch.add(low);
    return proposedEid;
  }
  function resolveMsisdnForSim(simId: string, proposedMsisdn: string | null): string | null {
    if (!proposedMsisdn) return null;
    const low = proposedMsisdn.trim().toLowerCase();
    if (!low) return null;
    const existingOwner = msisdnOwnerSimId.get(low);
    if (existingOwner && existingOwner !== simId) {
      skippedIdentifiers.push(`MSISDN "${proposedMsisdn}" al in gebruik door SIM-id ${existingOwner} (claim voor ${simId} overgeslagen)`);
      return null;
    }
    if (claimedMsisdnsLowerThisBatch.has(low)) {
      skippedIdentifiers.push(`MSISDN "${proposedMsisdn}" al geclaimd in deze batch (claim voor ${simId} overgeslagen)`);
      return null;
    }
    claimedMsisdnsLowerThisBatch.add(low);
    return proposedMsisdn;
  }

  const upsertPromises: Promise<unknown>[] = [];
  let auditCreatedEntries: Array<{ iccid: string; msisdn?: string | null; imsi?: string | null }> = [];
  let auditUpdatedEntries: Array<{ iccid: string; old: any; new: any }> = [];

  for (const simhuis of eligible) {
    const rawIccid = simhuis.iccid;
    const iccid = normIccid(rawIccid);
    if (!iccid) {
      skipped++;
      // Als de rawIccid (voor normalisatie) nog steeds truthy was →
      // placeholder of anderszins ongeldig.
      if (rawIccid && !isNotPlaceholder(String(rawIccid))) {
        h.skippedReasonPlaceholderIccid++;
      } else {
        h.skippedReasonNoIccid++;
      }
      continue;
    }
    try {
      const existing = existingByIccid.get(iccid);
      const mapped = mapSimhuisStatusToNexus(simhuis.status, existing?.status as any);
      const status = validateAndNormalizeSimStatus(
        mapped.status,
        `iccid=${iccid} simhuis.status=${String(simhuis.status ?? "<null>")}`
      );
      const skipIfLocked = mapped.skipIfLocked;

      const rawMsisdn = simhuis.msisdn;
      const rawImsi = simhuis.imsi;
      const rawEid = simhuis.eid;
      const rawSubscriberId = simhuis.subscriberId;
      const rawSimName = simhuis.simName;
      const rawGroupName = simhuis.groupName ?? simhuis.groupId;
      const rawProduct = simhuis.productName ?? simhuis.planName;
      const rawNetwork = simhuis.network;
      const rawPlanName = simhuis.planName;
      const rawProductType = simhuis.productType;
      const msisdnValRaw = normMsisdn(rawMsisdn);
      const imsiVal = normImsi(rawImsi);
      const eidValRaw = normEid(rawEid);

      // Unique-key conflict resolutie VOORAF (voorkomt Prisma unique constraint fouten)
      // - Bij bestaande SIM: gebruik existing.id als eigen-sim-identiteit
      // - Bij nieuwe SIM: gebruik ICCID als tijdelijke id (deze is per definitie uniek in de batch)
      const conflictSimId = existing ? existing.id : `__new_iccid_${iccid}__`;
      const msisdnVal = resolveMsisdnForSim(conflictSimId, msisdnValRaw);
      const eidVal = resolveEidForSim(conflictSimId, eidValRaw);

      const subscriberIdVal = truncate(rawSubscriberId, 100);
      const simNameVal = truncate(rawSimName, 200);
      const groupVal = truncate(rawGroupName, 100);
      const productVal = truncate(rawProduct, 200);
      const productTypeVal = truncate(rawProductType, 150);
      const networkVal = truncate(rawNetwork, 100);
      const planVal = truncate(rawPlanName, 500);
      const notesVal = buildSimNotes(simhuis);

      const dataUsedBytesVal = toBigIntOrNull(simhuis.dataUsedBytes);
      const dataLimitBytesVal = toBigIntOrNull(simhuis.dataLimitBytes);
      const lowestDataLimitBytesVal = toBigIntOrNull(simhuis.lowestDataLimitBytes);
      const smsUsedCountVal: number | null =
        typeof simhuis.smsUsedCount === "number" && Number.isFinite(simhuis.smsUsedCount)
          ? Math.round(simhuis.smsUsedCount)
          : null;
      const smsLimitCountVal: number | null =
        typeof simhuis.smsLimitCount === "number" && Number.isFinite(simhuis.smsLimitCount)
          ? Math.round(simhuis.smsLimitCount)
          : null;
      const lowestSmsLimitCountVal: number | null =
        typeof simhuis.lowestSmsLimitCount === "number" && Number.isFinite(simhuis.lowestSmsLimitCount)
          ? Math.round(simhuis.lowestSmsLimitCount)
          : null;
      const hasAnyUsage =
        dataUsedBytesVal !== null || dataLimitBytesVal !== null || lowestDataLimitBytesVal !== null ||
        smsUsedCountVal !== null || smsLimitCountVal !== null || lowestSmsLimitCountVal !== null;
      const lastUsageSyncAtVal = hasAnyUsage ? new Date() : null;
      const usageFields = buildUsageFieldsFromSimhuis(simhuis);

      if (existing) {
        const wasSoftDeleted = !!existing.deletedAt;
        if (skipIfLocked && !wasSoftDeleted && existing.status !== SimStatus.IN_STOCK && status === SimStatus.IN_STOCK) {
          skipped++;
          h.skippedReasonLocked++;
          continue;
        }
        const oldData: any = {
          status: existing.status,
          msisdn: existing.msisdn,
          imsi: existing.imsi,
          eid: existing.eid,
          subscriberId: existing.subscriberId,
          simName: existing.simName,
          simGroup: existing.simGroup,
          product: existing.product,
          productType: existing.productType,
          provider: existing.provider,
          simType: existing.simType,
          dataUsedBytes: existing.dataUsedBytes,
          dataLimitBytes: existing.dataLimitBytes,
          lowestDataLimitBytes: existing.lowestDataLimitBytes,
          smsUsedCount: existing.smsUsedCount,
          smsLimitCount: existing.smsLimitCount,
          lowestSmsLimitCount: existing.lowestSmsLimitCount,
          lastUsageSyncAt: existing.lastUsageSyncAt,
          notes: existing.notes,
          deletedAt: existing.deletedAt,
          usageSource: existing.usageSource ?? null,
          usageBundleId: existing.usageBundleId ?? null,
          usageLocalProductId: existing.usageLocalProductId ?? null,
          usageLocalProductName: existing.usageLocalProductName ?? null,
          usagePeriodStart: existing.usagePeriodStart ?? null,
          usagePeriodEnd: existing.usagePeriodEnd ?? null,
          usageRetrievedAt: existing.usageRetrievedAt ?? null,
          usageCdrQueryStart: existing.usageCdrQueryStart ?? null,
          usageCdrQueryEnd: existing.usageCdrQueryEnd ?? null,
          usageBundleUsages: (existing as any).usageBundleUsages ?? null,
          usageSelectionNote: (existing as any).usageSelectionNote ?? null,
          activationDate: (existing as any).activationDate ?? null,
          reactivationDate: (existing as any).reactivationDate ?? null,
          subscriptionDate: (existing as any).subscriptionDate ?? null,
        };
        const newData: Record<string, any> = { ...oldData };
        let changed = wasSoftDeleted;
        if (wasSoftDeleted) {
          newData.deletedAt = null;
        }
        if (existing.status !== status) { newData.status = status; changed = true; }
        if (msisdnVal && existing.msisdn !== msisdnVal) { newData.msisdn = msisdnVal; changed = true; }
        if (imsiVal && existing.imsi !== imsiVal) { newData.imsi = imsiVal; changed = true; }
        if (eidVal && existing.eid !== eidVal) { newData.eid = eidVal; changed = true; }
        if (subscriberIdVal && existing.subscriberId !== subscriberIdVal) { newData.subscriberId = subscriberIdVal; changed = true; }
        if (simNameVal && simNameVal !== "unnamed" && existing.simName !== simNameVal) { newData.simName = simNameVal; changed = true; }
        if (groupVal && existing.simGroup !== groupVal) { newData.simGroup = groupVal; changed = true; }
        if (productVal && existing.product !== productVal) { newData.product = productVal; changed = true; }
        if (productTypeVal && existing.productType !== productTypeVal) { newData.productType = productTypeVal; changed = true; }
        if (networkVal && existing.simType !== networkVal) { newData.simType = networkVal; changed = true; }
        if (notesVal && existing.notes !== notesVal) { newData.notes = notesVal; changed = true; }

        if (!bigIntEq(existing.dataUsedBytes, dataUsedBytesVal)) { newData.dataUsedBytes = dataUsedBytesVal; changed = true; }
        if (!bigIntEq(existing.dataLimitBytes, dataLimitBytesVal)) { newData.dataLimitBytes = dataLimitBytesVal; changed = true; }
        if (!bigIntEq(existing.lowestDataLimitBytes, lowestDataLimitBytesVal)) { newData.lowestDataLimitBytes = lowestDataLimitBytesVal; changed = true; }
        if (existing.smsUsedCount !== smsUsedCountVal) { newData.smsUsedCount = smsUsedCountVal; changed = true; }
        if (existing.smsLimitCount !== smsLimitCountVal) { newData.smsLimitCount = smsLimitCountVal; changed = true; }
        if (existing.lowestSmsLimitCount !== lowestSmsLimitCountVal) { newData.lowestSmsLimitCount = lowestSmsLimitCountVal; changed = true; }
        if (lastUsageSyncAtVal) { newData.lastUsageSyncAt = lastUsageSyncAtVal; changed = true; }

        const usageKeys = [
          'usageSource','usageBundleId','usageLocalProductId','usageLocalProductName',
          'usagePeriodStart','usagePeriodEnd','usageRetrievedAt','usageCdrQueryStart','usageCdrQueryEnd',
          'usageSelectionNote','activationDate','reactivationDate','subscriptionDate',
        ] as const;
        for (const k of usageKeys) {
          const nv = (usageFields as any)[k];
          if (nv !== null && nv !== undefined) {
            const ov = oldData[k];
            let fieldChanged = false;
            if (nv instanceof Date && ov instanceof Date) {
              fieldChanged = nv.getTime() !== ov.getTime();
            } else {
              fieldChanged = nv !== ov;
            }
            if (fieldChanged) {
              newData[k] = nv;
              changed = true;
            }
          }
        }
        if (usageFields.usageBundleUsages !== null && usageFields.usageBundleUsages !== undefined) {
          if (!jsonSafeEq(oldData.usageBundleUsages, usageFields.usageBundleUsages)) {
            newData.usageBundleUsages = usageFields.usageBundleUsages;
            changed = true;
          }
        }

        const providerTag = "Simhuis";
        if (!existing.provider?.toLowerCase().includes("simhuis")) {
          newData.provider = existing.provider ? truncate(`${existing.provider} + ${providerTag}`, 150) ?? providerTag : providerTag;
          changed = true;
        }
        if (!changed) {
          skipped++;
          h.skippedReasonNoChanges++;
          continue;
        }
        const validatedStatusForUpdate = validateAndNormalizeSimStatus(
          newData.status,
          `UPDATE${wasSoftDeleted ? "+RESTORE" : ""} iccid=${iccid} existingId=${existing.id}${wasSoftDeleted ? ` (was deletedAt=${String(existing.deletedAt)})` : ""}`
        );
        const p = prisma.sIM
          .update({
            where: { id: existing.id },
            data: {
              status: validatedStatusForUpdate,
              msisdn: newData.msisdn,
              imsi: newData.imsi,
              eid: newData.eid,
              subscriberId: newData.subscriberId,
              simName: newData.simName,
              simGroup: newData.simGroup,
              product: newData.product,
              productType: newData.productType,
              simType: newData.simType,
              provider: newData.provider,
              dataUsedBytes: newData.dataUsedBytes,
              dataLimitBytes: newData.dataLimitBytes,
              lowestDataLimitBytes: newData.lowestDataLimitBytes,
              smsUsedCount: newData.smsUsedCount,
              smsLimitCount: newData.smsLimitCount,
              lowestSmsLimitCount: newData.lowestSmsLimitCount,
              lastUsageSyncAt: newData.lastUsageSyncAt,
              notes: newData.notes,
              deletedAt: wasSoftDeleted ? null : undefined,
              usageSource: newData.usageSource,
              usageBundleId: newData.usageBundleId,
              usageLocalProductId: newData.usageLocalProductId,
              usageLocalProductName: newData.usageLocalProductName,
              usagePeriodStart: newData.usagePeriodStart,
              usagePeriodEnd: newData.usagePeriodEnd,
              usageRetrievedAt: newData.usageRetrievedAt,
              usageCdrQueryStart: newData.usageCdrQueryStart,
              usageCdrQueryEnd: newData.usageCdrQueryEnd,
              usageBundleUsages: newData.usageBundleUsages,
              usageSelectionNote: newData.usageSelectionNote,
              activationDate: newData.activationDate,
              reactivationDate: newData.reactivationDate,
              subscriptionDate: newData.subscriptionDate,
            },
          })
          .then(() => {
            if (wasSoftDeleted) {
              auditCreatedEntries.push({ iccid, msisdn: msisdnVal, imsi: imsiVal });
              created++;
            } else {
              auditUpdatedEntries.push({ iccid, old: oldData, new: newData });
              updated++;
            }
          })
          .catch((err) => {
            errorCount++;
            errors.push(`[${iccid}] ${wasSoftDeleted ? "Restore+Update" : "Update"} mislukt: ${err?.message ?? err}`);
          });
        upsertPromises.push(p);
      } else {
        const mappedNew = mapSimhuisStatusToNexus(simhuis.status, null);
        const statusForNew = validateAndNormalizeSimStatus(
          mappedNew.status,
          `CREATE iccid=${iccid} simhuis.status=${String(simhuis.status ?? "<null>")}`
        );
        const providerTag = "Simhuis";
        const p = prisma.sIM
          .create({
            data: {
              iccid,
              eid: eidVal,
              msisdn: msisdnVal,
              imsi: imsiVal,
              subscriberId: subscriberIdVal,
              simName: simNameVal && simNameVal !== "unnamed" ? simNameVal : undefined,
              simGroup: groupVal,
              product: productVal,
              productType: productTypeVal,
              provider: providerTag,
              simType: networkVal,
              status: statusForNew,
              dataUsedBytes: dataUsedBytesVal,
              dataLimitBytes: dataLimitBytesVal,
              lowestDataLimitBytes: lowestDataLimitBytesVal,
              smsUsedCount: smsUsedCountVal,
              smsLimitCount: smsLimitCountVal,
              lowestSmsLimitCount: lowestSmsLimitCountVal,
              lastUsageSyncAt: lastUsageSyncAtVal,
              notes: notesVal,
              usageSource: usageFields.usageSource,
              usageBundleId: usageFields.usageBundleId,
              usageLocalProductId: usageFields.usageLocalProductId,
              usageLocalProductName: usageFields.usageLocalProductName,
              usagePeriodStart: usageFields.usagePeriodStart,
              usagePeriodEnd: usageFields.usagePeriodEnd,
              usageRetrievedAt: usageFields.usageRetrievedAt,
              usageCdrQueryStart: usageFields.usageCdrQueryStart,
              usageCdrQueryEnd: usageFields.usageCdrQueryEnd,
              usageBundleUsages: usageFields.usageBundleUsages,
              usageSelectionNote: usageFields.usageSelectionNote,
              activationDate: usageFields.activationDate,
              reactivationDate: usageFields.reactivationDate,
              subscriptionDate: usageFields.subscriptionDate,
            },
          })
          .then(() => {
            auditCreatedEntries.push({ iccid, msisdn: msisdnVal, imsi: imsiVal });
            created++;
          })
          .catch((err) => {
            errorCount++;
            errors.push(`[${iccid}] Aanmaken mislukt: ${err?.message ?? err}`);
          });
        upsertPromises.push(p);
      }
    } catch (e: any) {
      errorCount++;
      errors.push(`[${iccid}] Onverwachte fout: ${e?.message ?? e}`);
    }
  }

  await Promise.all(upsertPromises);

  // ============================================================
  // FINAL SUMMARY LOGGING (zichtbaar in server logs én audit log).
  // Dit is cruciaal bij hersynchronisatie na leegmaken DB:
  // we willen direct zien dat 327 → 327 created in plaats van 0.
  // ============================================================
  const durationSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const skipBreakdownArr = [
    `placeholder-iccid=${h.skippedReasonPlaceholderIccid}`,
    `geen-iccid=${h.skippedReasonNoIccid}`,
    `deleted=${h.skippedReasonDeleted}`,
    `locked(skipIfLocked)=${h.skippedReasonLocked}`,
    `no-changes=${h.skippedReasonNoChanges}`,
  ];
  const skipBreakdownStr = skipBreakdownArr.join(", ");

  console.info(
    `[simhuis-sync] ✅ SYNC AFGEROND | ` +
    `⏱️ ${durationSec}s | ` +
    `Simhuis:${totalInSimhuis} eligible:${eligible.length} | ` +
    `✅ AANGEMAAKT:${created} 🔄 BIJGEWERKT:${updated} ⏭️ OVERGESLAGEN:${skipped} ❌ FOUTEN:${errorCount} | ` +
    `Skip-redenen: {${skipBreakdownStr}} | ` +
    `EID/MSISDN conflicten:${skippedIdentifiers.length}`
  );

  // Zet de samenvatting OOK in de errorMessages array, zodat deze
  // in de UI zichtbaar is onder het "foutmeldingen"-gebied.
  errors.unshift(
    `[SAMENVATTING] Sync ${durationSec}s: ${totalInSimhuis} van Simhuis → ` +
    `${created} aangemaakt, ${updated} bijgewerkt, ${skipped} overgeslagen (${skipBreakdownStr}), ` +
    `${errorCount} fouten, ${skippedIdentifiers.length} EID/MSISDN conflicten.`
  );
  // Als er veel placeholder-iccid's waren: zet die melding ERG HOOG in de UI output!
  if (h.skippedReasonPlaceholderIccid > 0) {
    errors.unshift(
      `[WAARSCHUWING] ${h.skippedReasonPlaceholderIccid} simkaarten OVERGESLAGEN omdat Simhuis ` +
      `de VELDNAAM (zoals "iccid", "eid", "esimId") als WAARDE teruggaf in plaats van echte identifiers. ` +
      `Samples: ${h.iccidPlaceholderSamples.join(", ") || "(geen)"}`
    );
  }
  if (h.withIccidPlaceholder > 0) {
    errors.unshift(
      `[HEALTH] Simhuis extractie: ${h.withIccidPlaceholder} placeholder-iccid, ` +
      `${h.withEidPlaceholder} placeholder-eid, ${h.withMsisdnPlaceholder} placeholder-msisdn ` +
      `(van in totaal ${totalInSimhuis}).`
    );
  }

  // Voeg een informatieve melding toe voor elke overgeslagen unique identifier
  // (geen harde fout, maar wel zichtbaar voor gebruiker)
  if (skippedIdentifiers.length > 0) {
    const summary = `[INFO] ${skippedIdentifiers.length} unieke EID/MSISDN waarde(s) overgeslagen ivm. conflict/duplicaat.`;
    errors.push(summary);
    const detailLimit = Math.min(skippedIdentifiers.length, 20);
    for (let i = 0; i < detailLimit; i++) {
      errors.push(`  └─ ${skippedIdentifiers[i]}`);
    }
    if (skippedIdentifiers.length > detailLimit) {
      errors.push(`  └─ ... en ${skippedIdentifiers.length - detailLimit} meer (zie audit log)`);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const userId = ctx.userId;
      const finishedAt = new Date();
      const durationMs = Date.now() - startedAt;
      const meta = {
        scope: "simhuis_sim_sync",
        totalInSimhuis,
        eligibleCount: eligible.length,
        created,
        updated,
        skipped,
        errors: errorCount,
        skippedIdentifiersCount: skippedIdentifiers.length,
        skippedIdentifiersSample: skippedIdentifiers.slice(0, 100),
        // Health counters (extractie kwaliteit, skip breakdown)
        health: {
          extractValidIccidCount: h.withValidIccid,
          extractPlaceholderIccidCount: h.withIccidPlaceholder,
          extractPlaceholderIccidSamples: h.iccidPlaceholderSamples,
          extractValidEidCount: h.withValidEid,
          extractPlaceholderEidCount: h.withEidPlaceholder,
          extractPlaceholderEidSamples: h.eidPlaceholderSamples,
          extractValidMsisdnCount: h.withValidMsisdn,
          extractPlaceholderMsisdnCount: h.withMsisdnPlaceholder,
          extractPlaceholderMsisdnSamples: h.msisdnPlaceholderSamples,
          skippedBreakdown: {
            placeholderIccid: h.skippedReasonPlaceholderIccid,
            noIccid: h.skippedReasonNoIccid,
            deleted: h.skippedReasonDeleted,
            lockedSkipIfLocked: h.skippedReasonLocked,
            noChanges: h.skippedReasonNoChanges,
          },
        },
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
      };
      if (auditCreatedEntries.length > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `sync_simhuis_batch_${Date.now()}`,
          action: "BATCH_CREATE",
          userId: userId ?? "SYSTEM",
          oldValues: { source: "simhuis_sync", count: auditCreatedEntries.length },
          newValues: { items: auditCreatedEntries.slice(0, 100), total: auditCreatedEntries.length },
          metadata: meta,
          timestamp: finishedAt,
        });
      }
      if (auditUpdatedEntries.length > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `sync_simhuis_batch_${Date.now()}_upd`,
          action: "BATCH_UPDATE",
          userId: userId ?? "SYSTEM",
          oldValues: { source: "simhuis_sync", count: auditUpdatedEntries.length },
          newValues: { items: auditUpdatedEntries.slice(0, 100), total: auditUpdatedEntries.length },
          metadata: meta,
          timestamp: finishedAt,
        });
      }
      if (errorCount > 0 || skippedIdentifiers.length > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `sync_simhuis_batch_${Date.now()}_err`,
          action: "BATCH_ERROR",
          userId: userId ?? "SYSTEM",
          oldValues: { errorCount, skippedIdentifiersCount: skippedIdentifiers.length },
          newValues: {
            errorMessages: errors.slice(0, 80),
            skippedIdentifiers: skippedIdentifiers.slice(0, 100),
          },
          metadata: meta,
          timestamp: finishedAt,
        });
      }
    });
  } catch (auditErr) {
    console.error("[simhuis-sim-sync] Audit logging failed:", auditErr);
  }

  return {
    totalInSimhuis,
    eligibleInSimhuis: eligible.length,
    created,
    updated,
    skipped,
    errors: errorCount,
    errorMessages: errors,
    skippedUniqueIdentifiers: skippedIdentifiers,
    lastSyncedAt: new Date(),
    durationMs: Date.now() - startedAt,
  };
}

// ============================================================
// Usage-only sync (snelle variant, hourly)
// - Alleen voor ACTIVE SIMs (status = ACTIVE in DB)
// - Alleen data/SMS velden bijwerken (GEEN create, GEEN status-wijzigingen,
//   GEEN SIM-veld-discovery)
// - Gebruikt listAllSims() (1-2 API calls voor alle SIMs tegelijk)
//   in plaats van per-SIM discovery; veel sneller.
// ============================================================
export async function syncActiveSimsUsageFromSimhuis(
  ctx: Ctx = {}
): Promise<SimhuisUsageSyncResult> {
  const configured = await simhuisClient.isConfigured();
  if (!configured) {
    throw new Error(
      "Simhuis niet geconfigureerd (username en/of password ontbreekt)."
    );
  }

  const startedAt = Date.now();
  const errors: string[] = [];
  let updated = 0;
  let skipped = 0;
  let errorCount = 0;

  // 1. Haal alle ACTIVE en recent ACTIVE SIMs op uit de lokale DB.
  //    (We nemen ook SUSPENDED/RESERVED op met bestaande usage-data zodat
  //    die niet ineens lege waarden krijgen; alleen CANCELLED / RETIRED /
  //    IN_STOCK zonder data slaan we over.)
  //    Plus: als customerScope gegeven is, filter op assignments binnen de scope.
  const hasScope = ctx.customerScope && ctx.customerScope.length > 0;
  let customerScopeAssignment: any = undefined;
  if (hasScope) {
    customerScopeAssignment = {
      assignments: {
        some: {
          subscription: {
            customerId: { "in": ctx.customerScope! },
          },
        },
      },
    };
  }

  const targetSims = await prisma.sIM.findMany({
    where: {
      deletedAt: null,
      ...customerScopeAssignment,
      OR: [
        { status: SimStatus.ACTIVE },
        { status: SimStatus.SUSPENDED },
        { status: SimStatus.RESERVED },
        {
          AND: [
            { dataUsedBytes: { not: null } },
            {
              status: {
                notIn: [SimStatus.CANCELLED, SimStatus.RETIRED],
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      iccid: true,
      status: true,
      dataUsedBytes: true,
      dataLimitBytes: true,
      lowestDataLimitBytes: true,
      smsUsedCount: true,
      smsLimitCount: true,
      lowestSmsLimitCount: true,
      lastUsageSyncAt: true,
      usageSource: true,
      usageBundleId: true,
      usageLocalProductId: true,
      usageLocalProductName: true,
      usagePeriodStart: true,
      usagePeriodEnd: true,
      usageRetrievedAt: true,
      usageCdrQueryStart: true,
      usageCdrQueryEnd: true,
      usageBundleUsages: true,
      usageSelectionNote: true,
      activationDate: true,
      reactivationDate: true,
      subscriptionDate: true,
    },
  });

  const totalActiveInDb = targetSims.length;
  const byIccid = new Map(targetSims.map((s) => [s.iccid, s]));

  // 2. Vraag alle SIMs met 1 call op bij Simhuis.
  let allSimsFromSimhuis: SimhuisSimStatus[] = [];
  try {
    allSimsFromSimhuis = await listAllSims();
  } catch (e: any) {
    throw new Error(
      `Ophalen SIMs van Simhuis mislukt: ${e?.message ?? e}`
    );
  }
  const totalInSimhuis = allSimsFromSimhuis.length;

  // 3. Alleen diegene die in de lokale target set zitten
  //    (per ICCID normaal-vorm voor de zekerheid).
  const matchedFromSimhuis: Array<{
    iccid: string;
    simhuis: SimhuisSimStatus;
  }> = [];
  for (const s of allSimsFromSimhuis) {
    const n = normIccid(s.iccid);
    if (!n) continue;
    if (byIccid.has(n)) {
      matchedFromSimhuis.push({ iccid: n, simhuis: s });
    }
  }
  const matched = matchedFromSimhuis.length;

  // 4. 💥 NIEUW: Voor elke SIM waar dataUsed/smsUsed NOG NULL is:
  //    ROEP getSimStatus(iccid) AAN! Die bevat Winning Combo + Phase A.5 per-SIM usage endpoints!
  //    Gebruik SEMAPHORE (concurrency limit = 3) om Simhuis API niet te overspoelen!
  const needsPerSimCalls = matchedFromSimhuis.filter(({ simhuis }) => {
    const du = typeof simhuis.dataUsedBytes === 'number';
    const su = typeof simhuis.smsUsedCount === 'number';
    return !du || !su; // 1 van de 2 mist → per-SIM usage endpoints proberen!
  });
  if (needsPerSimCalls.length > 0) {
    const bulkHasUsageCount = Number(matched) - needsPerSimCalls.length;
    console.info(
      `[simhuis-usage-sync] 💡 listAllSims bulk heeft usage data voor ${bulkHasUsageCount}/${matched} SIMs. ` +
      `${needsPerSimCalls.length} SIMs missen (deels) usage → per-SIM discovery met Phase A.5 endpoints! (concurrency=3)`
    );
    const PER_SIM_CONCURRENCY = 3;
    const PER_SIM_TOTAL_TIMEOUT_MS = 120_000; // 2 min max voor gehele bulk
    const startedAtPerSim = Date.now();
    let cursor = 0;
    let perSimOk = 0;
    let perSimFailed = 0;
    let perSimSkipped = 0;
    const runNext = async () => {
      while (cursor < needsPerSimCalls.length && (Date.now() - startedAtPerSim) < PER_SIM_TOTAL_TIMEOUT_MS) {
        const idx = cursor++;
        const { iccid, simhuis: baseSimhuis } = needsPerSimCalls[idx];
        const short = iccid.slice(-6);
        try {
          // Roep getSimStatus aan! Die bevat:
          //  ✅ Winning Combo STAP 0 (bulk + catch-22 fix + 401 retry!)
          //  ✅ Phase A.5 4 usage endpoints Swagger-bevestigd!
          //  ✅ Bundles extractie + enrich!
          const detailed = await getSimStatus(iccid);
          if (detailed) {
            const merged: SimhuisSimStatus = { ...baseSimhuis };
            let hasMergeImprovement = false;
            for (const f of [
              'dataUsedBytes','smsUsedCount','dataLimitBytes','lowestDataLimitBytes','smsLimitCount','lowestSmsLimitCount',
              'productName','productType','simName','groupName','groupId','status','msisdn','eid',
              'usageSource','usageBundleId','usageLocalProductId','usageLocalProductName',
              'usagePeriodStart','usagePeriodEnd','usageRetrievedAt','usageCdrQueryStart','usageCdrQueryEnd',
              'usageBundleUsages','usageSelectionNote',
              'activationDate','reactivationDate','subscriptionDate',
            ] as const) {
              const detailVal = (detailed as any)[f];
              const baseVal = (baseSimhuis as any)[f];
              const improve =
                detailVal !== null && detailVal !== undefined &&
                (baseVal === null || baseVal === undefined ||
                 (f === 'productName' && typeof detailVal === 'string' && /cardcentri|mii|imeifplmn/i.test(String(baseVal)) && !/cardcentri|mii|imeifplmn/i.test(detailVal)) ||
                 (typeof baseVal === 'string' && baseVal.length === 0)
                );
              if (improve) { (merged as any)[f] = detailVal; hasMergeImprovement = true; }
            }
            if (hasMergeImprovement) {
              // Overschrijf in matchedFromSimhuis & bySimhuis!
              const globalIdx = matchedFromSimhuis.findIndex(x => x.iccid === iccid);
              if (globalIdx !== -1) matchedFromSimhuis[globalIdx] = { iccid, simhuis: merged };
              perSimOk++;
              const newDU = (merged as any).dataUsedBytes;
              const newProd = (merged as any).productName;
              if ((idx + 1) % 25 === 0 || idx === needsPerSimCalls.length - 1) {
                console.info(`[simhuis-usage-sync] 🔄 [${idx + 1}/${needsPerSimCalls.length}] Per-SIM ...${short}: dataUsed=${newDU !== null && newDU !== undefined ? (Number(newDU) / 1024 / 1024).toFixed(1) + ' MB' : 'NULL'}, product=${newProd ?? 'NULL'} (progress ok=${perSimOk} fail=${perSimFailed})`);
              }
            } else {
              perSimSkipped++;
            }
          } else { perSimSkipped++; }
        } catch (perr) {
          perSimFailed++;
          const msg = perr instanceof Error ? perr.message : String(perr);
          errors.push(`[${iccid}] Per-SIM Phase A.5 mislukt: ${msg}`);
          if ((idx + 1) % 10 === 0) {
            console.warn(`[simhuis-usage-sync] ❌ [${idx + 1}/${needsPerSimCalls.length}] Per-SIM fail: ...${short}: ${msg} (ok=${perSimOk} fail=${perSimFailed})`);
          }
        }
      }
    };
    // Spawn N workers
    const workers = Array.from({ length: PER_SIM_CONCURRENCY }, () => runNext());
    await Promise.all(workers);
    const perSimTook = (Date.now() - startedAtPerSim);
    const timedOut = (Date.now() - startedAtPerSim) >= PER_SIM_TOTAL_TIMEOUT_MS;
    console.info(
      `[simhuis-usage-sync] 🔄 Per-SIM Phase A.5 DAGBOEK: ${needsPerSimCalls.length} candidates. ` +
      `succes-update=${perSimOk}, skip-geen-verbetering=${perSimSkipped}, error=${perSimFailed}, ` +
      `time-out=${timedOut}, duur=${perSimTook}ms. ` +
      `${timedOut ? '⚠️ Let op: time-out bereikt — verbruik is mogelijk voor een deel van SIMs nog niet geüpdatet!' : ''}`
    );
  } else {
    console.info(`[simhuis-usage-sync] 💡 listAllSims bulk heeft COMPLETE usage data voor ALLE ${matched} SIMs! Per-SIM calls niet nodig.`);
  }

  // 5. Update parallel per match. (was #4, nu #5)
  const updatePromises: Promise<unknown>[] = [];
  const auditUsageUpdates: Array<{
    iccid: string;
    old: any;
    new: any;
  }> = [];

  for (const { iccid, simhuis } of matchedFromSimhuis) {
    try {
      const existing = byIccid.get(iccid)!;

      const dataUsedBytesVal = toBigIntOrNull(simhuis.dataUsedBytes);
      const dataLimitBytesVal = toBigIntOrNull(simhuis.dataLimitBytes);
      const lowestDataLimitBytesVal = toBigIntOrNull(
        simhuis.lowestDataLimitBytes
      );
      const smsUsedCountVal: number | null =
        typeof simhuis.smsUsedCount === "number" &&
        Number.isFinite(simhuis.smsUsedCount)
          ? Math.round(simhuis.smsUsedCount)
          : null;
      const smsLimitCountVal: number | null =
        typeof simhuis.smsLimitCount === "number" &&
        Number.isFinite(simhuis.smsLimitCount)
          ? Math.round(simhuis.smsLimitCount)
          : null;
      const lowestSmsLimitCountVal: number | null =
        typeof simhuis.lowestSmsLimitCount === "number" &&
        Number.isFinite(simhuis.lowestSmsLimitCount)
          ? Math.round(simhuis.lowestSmsLimitCount)
          : null;

      const usageFields = buildUsageFieldsFromSimhuis(simhuis);

      const oldData: any = {
        dataUsedBytes: existing.dataUsedBytes,
        dataLimitBytes: existing.dataLimitBytes,
        lowestDataLimitBytes: existing.lowestDataLimitBytes,
        smsUsedCount: existing.smsUsedCount,
        smsLimitCount: existing.smsLimitCount,
        lowestSmsLimitCount: existing.lowestSmsLimitCount,
        lastUsageSyncAt: existing.lastUsageSyncAt,
        usageSource: existing.usageSource ?? null,
        usageBundleId: existing.usageBundleId ?? null,
        usageLocalProductId: existing.usageLocalProductId ?? null,
        usageLocalProductName: existing.usageLocalProductName ?? null,
        usagePeriodStart: existing.usagePeriodStart ?? null,
        usagePeriodEnd: existing.usagePeriodEnd ?? null,
        usageRetrievedAt: existing.usageRetrievedAt ?? null,
        usageCdrQueryStart: existing.usageCdrQueryStart ?? null,
        usageCdrQueryEnd: existing.usageCdrQueryEnd ?? null,
        usageBundleUsages: (existing as any).usageBundleUsages ?? null,
        usageSelectionNote: (existing as any).usageSelectionNote ?? null,
        activationDate: (existing as any).activationDate ?? null,
        reactivationDate: (existing as any).reactivationDate ?? null,
        subscriptionDate: (existing as any).subscriptionDate ?? null,
      };

      let changed = false;
      const newData: any = { ...oldData };
      if (!bigIntEq(existing.dataUsedBytes, dataUsedBytesVal)) {
        newData.dataUsedBytes = dataUsedBytesVal;
        changed = true;
      }
      if (!bigIntEq(existing.dataLimitBytes, dataLimitBytesVal)) {
        newData.dataLimitBytes = dataLimitBytesVal;
        changed = true;
      }
      if (!bigIntEq(existing.lowestDataLimitBytes, lowestDataLimitBytesVal)) {
        newData.lowestDataLimitBytes = lowestDataLimitBytesVal;
        changed = true;
      }
      if (existing.smsUsedCount !== smsUsedCountVal) {
        newData.smsUsedCount = smsUsedCountVal;
        changed = true;
      }
      if (existing.smsLimitCount !== smsLimitCountVal) {
        newData.smsLimitCount = smsLimitCountVal;
        changed = true;
      }
      if (existing.lowestSmsLimitCount !== lowestSmsLimitCountVal) {
        newData.lowestSmsLimitCount = lowestSmsLimitCountVal;
        changed = true;
      }

      const usageKeys = [
        'usageSource','usageBundleId','usageLocalProductId','usageLocalProductName',
        'usagePeriodStart','usagePeriodEnd','usageRetrievedAt','usageCdrQueryStart','usageCdrQueryEnd',
        'usageSelectionNote','activationDate','reactivationDate','subscriptionDate',
      ] as const;
      for (const k of usageKeys) {
        const nv = (usageFields as any)[k];
        if (nv !== null && nv !== undefined) {
          const ov = oldData[k];
          let fieldChanged = false;
          if (nv instanceof Date && ov instanceof Date) {
            fieldChanged = nv.getTime() !== ov.getTime();
          } else {
            fieldChanged = nv !== ov;
          }
          if (fieldChanged) {
            newData[k] = nv;
            changed = true;
          }
        }
      }
      if (usageFields.usageBundleUsages !== null && usageFields.usageBundleUsages !== undefined) {
        if (!jsonSafeEq(oldData.usageBundleUsages, usageFields.usageBundleUsages)) {
          newData.usageBundleUsages = usageFields.usageBundleUsages;
          changed = true;
        }
      }

      const hasAnyUsageData =
        newData.dataUsedBytes !== null ||
        newData.dataLimitBytes !== null ||
        newData.lowestDataLimitBytes !== null ||
        newData.smsUsedCount !== null ||
        newData.smsLimitCount !== null ||
        newData.lowestSmsLimitCount !== null;
      if (hasAnyUsageData) {
        newData.lastUsageSyncAt = new Date();
        changed = true;
      }

      if (!changed) {
        skipped++;
        continue;
      }

      const p = prisma.sIM
        .update({
          where: { id: existing.id },
          data: {
            dataUsedBytes: newData.dataUsedBytes,
            dataLimitBytes: newData.dataLimitBytes,
            lowestDataLimitBytes: newData.lowestDataLimitBytes,
            smsUsedCount: newData.smsUsedCount,
            smsLimitCount: newData.smsLimitCount,
            lowestSmsLimitCount: newData.lowestSmsLimitCount,
            lastUsageSyncAt: newData.lastUsageSyncAt,
            usageSource: newData.usageSource,
            usageBundleId: newData.usageBundleId,
            usageLocalProductId: newData.usageLocalProductId,
            usageLocalProductName: newData.usageLocalProductName,
            usagePeriodStart: newData.usagePeriodStart,
            usagePeriodEnd: newData.usagePeriodEnd,
            usageRetrievedAt: newData.usageRetrievedAt,
            usageCdrQueryStart: newData.usageCdrQueryStart,
            usageCdrQueryEnd: newData.usageCdrQueryEnd,
            usageBundleUsages: newData.usageBundleUsages,
            usageSelectionNote: newData.usageSelectionNote,
            activationDate: newData.activationDate,
            reactivationDate: newData.reactivationDate,
            subscriptionDate: newData.subscriptionDate,
          },
        })
        .then(() => {
          auditUsageUpdates.push({ iccid, old: oldData, new: newData });
          updated++;
        })
        .catch((err) => {
          errorCount++;
          errors.push(`[${iccid}] Usage update mislukt: ${err?.message ?? err}`);
        });
      updatePromises.push(p);
    } catch (e: any) {
      errorCount++;
      errors.push(
        `[${iccid}] Onverwachte fout in usage-sync: ${e?.message ?? e}`
      );
    }
  }

  await Promise.all(updatePromises);

  // 5. Audit logging (apart van de grote sync)
  try {
    await prisma.$transaction(async (tx) => {
      const userId = ctx.userId;
      const finishedAt = new Date();
      const durationMs = Date.now() - startedAt;
      const meta = {
        scope: "simhuis_usage_sync",
        totalActiveInDb,
        totalInSimhuis,
        matched,
        updated,
        skipped,
        errors: errorCount,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs,
      };
      if (auditUsageUpdates.length > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `usage_sync_simhuis_batch_${Date.now()}`,
          action: "BATCH_UPDATE",
          userId: userId ?? "SYSTEM",
          oldValues: { source: "simhuis_usage_sync", count: auditUsageUpdates.length },
          newValues: {
            items: auditUsageUpdates.slice(0, 100),
            total: auditUsageUpdates.length,
          },
          metadata: meta,
          timestamp: finishedAt,
        });
      }
      if (errorCount > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `usage_sync_simhuis_batch_${Date.now()}_err`,
          action: "BATCH_ERROR",
          userId: userId ?? "SYSTEM",
          oldValues: { errorCount },
          newValues: { errorMessages: errors.slice(0, 50) },
          metadata: meta,
          timestamp: finishedAt,
        });
      }
    });
  } catch (auditErr) {
    console.error("[simhuis-usage-sync] Audit logging failed:", auditErr);
  }

  return {
    totalActiveInDb,
    totalInSimhuis,
    matched,
    updated,
    skipped,
    errors: errorCount,
    errorMessages: errors,
    lastSyncedAt: new Date(),
    durationMs: Date.now() - startedAt,
  };
}

// ============================================================
// Per-SIM usage sync (handmatige knop op SIM-detailpagina)
// - 1 SIM per keer
// - Eerst per-SIM discovery via getSimStatus(iccid)
// - Fallback: listAllSims() als dat mislukt
// ============================================================
export type PerSimUsageSyncResult = {
  simId: string;
  iccid: string;
  updated: 0 | 1;
  changedFields: string[];
  hasAnyUsageData: boolean;
  source: "per-sim-discovery" | "list-fallback";
  fetchedAt: Date;
  durationMs: number;
  errorMessage?: string;
  simhuisFields?: {
    dataUsedBytes: number | null;
    dataLimitBytes: number | null;
    lowestDataLimitBytes: number | null;
    smsUsedCount: number | null;
    smsLimitCount: number | null;
    lowestSmsLimitCount: number | null;
    productName: string | null;
    productType: string | null;
    simName: string | null;
    groupName: string | null;
    usageSource: string | null;
    usageBundleId: string | null;
    usageLocalProductId: string | null;
    usageLocalProductName: string | null;
    usagePeriodStart: Date | null;
    usagePeriodEnd: Date | null;
    usageRetrievedAt: Date | null;
    usageCdrQueryStart: Date | null;
    usageCdrQueryEnd: Date | null;
    usageBundleUsages: unknown | null;
    usageSelectionNote: string | null;
    activationDate: Date | null;
    reactivationDate: Date | null;
    subscriptionDate: Date | null;
  };
};

export async function syncUsageForSingleSim(
  simId: string,
  ctx: Ctx = {}
): Promise<PerSimUsageSyncResult> {
  const startedAt = Date.now();
  const configured = await simhuisClient.isConfigured();
  if (!configured) {
    throw new Error("Simhuis niet geconfigureerd.");
  }

  const hasScope = ctx.customerScope && ctx.customerScope.length > 0;
  let customerScopeAssignment: any = undefined;
  if (hasScope) {
    customerScopeAssignment = {
      assignments: {
        some: {
          subscription: {
            customerId: { "in": ctx.customerScope! },
          },
        },
      },
    };
  }

  const sim = await prisma.sIM.findFirst({
    where: { id: simId, deletedAt: null, ...customerScopeAssignment },
    select: {
      id: true,
      iccid: true,
      dataUsedBytes: true,
      dataLimitBytes: true,
      lowestDataLimitBytes: true,
      smsUsedCount: true,
      smsLimitCount: true,
      lowestSmsLimitCount: true,
      lastUsageSyncAt: true,
      product: true,
      productType: true,
      simName: true,
      simGroup: true,
      usageSource: true,
      usageBundleId: true,
      usageLocalProductId: true,
      usageLocalProductName: true,
      usagePeriodStart: true,
      usagePeriodEnd: true,
      usageRetrievedAt: true,
      usageCdrQueryStart: true,
      usageCdrQueryEnd: true,
      usageBundleUsages: true,
      usageSelectionNote: true,
      activationDate: true,
      reactivationDate: true,
      subscriptionDate: true,
    },
  });
  if (!sim) {
    throw new Error(`SIM met id ${simId} niet gevonden of valt niet binnen je toegang.`);
  }
  if (!sim.iccid) {
    throw new Error(`SIM heeft geen ICCID — kan Simhuis niet opvragen.`);
  }
  const normalizedIccid = normIccid(sim.iccid);
  if (!normalizedIccid) {
    throw new Error(`SIM ICCID ongeldig: ${sim.iccid}`);
  }

  let simhuisStatus: SimhuisSimStatus | null = null;
  let errorMessage: string | undefined;
  let source: PerSimUsageSyncResult["source"] = "per-sim-discovery";

  // POGING 1: Per-SIM endpoints (sneller, want alleen 1 SIM)
  try {
    simhuisStatus = await getSimStatus(normalizedIccid);
  } catch (e: any) {
    errorMessage = e?.message ?? String(e);
  }

  // POGING 2: Fallback listAllSims + filter op iccid
  //    Activeer NIET alleen op !simhuisStatus, maar OOK wanneer de geretourneerde
  //    simhuisStatus duidelijk incompleet is (geen dataUsed EN geen dataLimit EN geen product).
  //    Simhuis geeft per-SIM endpoints soms 403/405 terwijl listAllSims WEL de data heeft.
  let fallbackNeeded = !simhuisStatus;
  if (simhuisStatus) {
    const noUsage =
      (simhuisStatus.dataUsedBytes == null && simhuisStatus.dataLimitBytes == null) ||
      (simhuisStatus.smsUsedCount == null && simhuisStatus.smsLimitCount == null);
    const noProduct = !simhuisStatus.productName || /cardcentri|mii|imeifplmn/i.test(simhuisStatus.productName);
    if (noUsage || noProduct) fallbackNeeded = true;
  }
  if (fallbackNeeded) {
    // Source is strikt: per-sim-discovery als we IETS uit per-SIM flow hadden (ook al viel list erachteraan),
    // alleen pure list-all-sims fallback zonder enkele per-SIM match = list-fallback.
    if (!simhuisStatus) source = "list-fallback";
    try {
      const all = await listAllSims();
      const match = all.find(
        (s) => normIccid(s.iccid) === normalizedIccid
      );
      if (match) {
        // Merge: neem de beste van beide (behoud velden die WEL gevonden waren in P1)
        if (!simhuisStatus) {
          simhuisStatus = match;
        } else {
          (simhuisStatus as any) = { ...(match as any), ...(simhuisStatus as any) };
          // Belangrijke keys: voorrang geven aan de MATCH (listAllSims) als die WEL tellers heeft
          for (const k of ['dataUsedBytes','dataLimitBytes','lowestDataLimitBytes','smsUsedCount','smsLimitCount','lowestSmsLimitCount','productName','productType','simName','groupName','groupId','activationDate','reactivationDate','subscriptionDate'] as const) {
            const p1 = (simhuisStatus as any)[k];
            const p2 = (match as any)[k];
            if ((p1 === null || p1 === undefined) && (p2 !== null && p2 !== undefined)) {
              (simhuisStatus as any)[k] = p2;
            }
          }
        }
      } else if (!simhuisStatus) {
        errorMessage = errorMessage ? `${errorMessage} | Fallback listAllSims: ICCID niet gevonden in lijst.` : `ICCID niet gevonden in Simhuis lijst.`;
      }
    } catch (e: any) {
      if (!simhuisStatus) {
        errorMessage = errorMessage
          ? `${errorMessage} | Fallback listAllSims mislukt: ${e?.message ?? e}`
          : `listAllSims mislukt: ${e?.message ?? e}`;
      }
    }
  }

  if (!simhuisStatus) {
    return {
      simId,
      iccid: normalizedIccid,
      updated: 0,
      changedFields: [],
      hasAnyUsageData: false,
      source,
      fetchedAt: new Date(),
      durationMs: Date.now() - startedAt,
      errorMessage,
    };
  }

  const existingUsage: UsageFields = {
    dataUsedBytes: sim.dataUsedBytes,
    dataLimitBytes: sim.dataLimitBytes,
    lowestDataLimitBytes: sim.lowestDataLimitBytes,
    smsUsedCount: sim.smsUsedCount,
    smsLimitCount: sim.smsLimitCount,
    lowestSmsLimitCount: sim.lowestSmsLimitCount,
    lastUsageSyncAt: sim.lastUsageSyncAt,
    usageSource: sim.usageSource ?? null,
    usageBundleId: sim.usageBundleId ?? null,
    usageLocalProductId: sim.usageLocalProductId ?? null,
    usageLocalProductName: sim.usageLocalProductName ?? null,
    usagePeriodStart: sim.usagePeriodStart ?? null,
    usagePeriodEnd: sim.usagePeriodEnd ?? null,
    usageRetrievedAt: sim.usageRetrievedAt ?? null,
    usageCdrQueryStart: sim.usageCdrQueryStart ?? null,
    usageCdrQueryEnd: sim.usageCdrQueryEnd ?? null,
    usageBundleUsages: (sim as any).usageBundleUsages ?? null,
    usageSelectionNote: (sim as any).usageSelectionNote ?? null,
    activationDate: (sim as any).activationDate ?? null,
    reactivationDate: (sim as any).reactivationDate ?? null,
    subscriptionDate: (sim as any).subscriptionDate ?? null,
  };
  const existingProduct: ProductSimFields = {
    product: sim.product ?? null,
    productType: sim.productType ?? null,
    simName: sim.simName ?? null,
    simGroup: sim.simGroup ?? null,
  };
  const applyUsage = applyUsageFieldsFromSimhuis(existingUsage, simhuisStatus);
  const applyProduct = applyProductSimFieldsFromSimhuis(existingProduct, simhuisStatus);

  const allChangedFields: string[] = [...applyUsage.changedFields, ...applyProduct.changedFields];
  const shouldUpdateDb = applyUsage.changed || applyUsage.hasAnyUsageData || applyProduct.changed;
  const updatedNow = shouldUpdateDb ? 1 : 0;

  if (shouldUpdateDb) {
    await prisma.sIM.update({
      where: { id: sim.id },
      data: {
        dataUsedBytes: applyUsage.newData.dataUsedBytes,
        dataLimitBytes: applyUsage.newData.dataLimitBytes,
        lowestDataLimitBytes: applyUsage.newData.lowestDataLimitBytes,
        smsUsedCount: applyUsage.newData.smsUsedCount,
        smsLimitCount: applyUsage.newData.smsLimitCount,
        lowestSmsLimitCount: applyUsage.newData.lowestSmsLimitCount,
        lastUsageSyncAt: applyUsage.newData.lastUsageSyncAt,
        product: applyProduct.newData.product,
        productType: applyProduct.newData.productType,
        simName: applyProduct.newData.simName,
        simGroup: applyProduct.newData.simGroup,
        usageSource: (applyUsage.newData as any).usageSource,
        usageBundleId: (applyUsage.newData as any).usageBundleId,
        usageLocalProductId: (applyUsage.newData as any).usageLocalProductId,
        usageLocalProductName: (applyUsage.newData as any).usageLocalProductName,
        usagePeriodStart: (applyUsage.newData as any).usagePeriodStart,
        usagePeriodEnd: (applyUsage.newData as any).usagePeriodEnd,
        usageRetrievedAt: (applyUsage.newData as any).usageRetrievedAt,
        usageCdrQueryStart: (applyUsage.newData as any).usageCdrQueryStart,
        usageCdrQueryEnd: (applyUsage.newData as any).usageCdrQueryEnd,
        usageBundleUsages: (applyUsage.newData as any).usageBundleUsages,
        usageSelectionNote: (applyUsage.newData as any).usageSelectionNote,
        activationDate: (applyUsage.newData as any).activationDate,
        reactivationDate: (applyUsage.newData as any).reactivationDate,
        subscriptionDate: (applyUsage.newData as any).subscriptionDate,
      },
    });
    try {
      await logAudit(prisma, {
        entityType: "SIM",
        entityId: sim.id,
        action: "UPDATE",
        userId: ctx.userId ?? "SYSTEM",
        oldValues: { ...applyUsage.oldData, ...applyProduct.oldData, source: "simhuis_single_usage_sync" },
        newValues: { ...applyUsage.newData, ...applyProduct.newData, source, changedFields: allChangedFields, errorMessage },
        metadata: { scope: "simhuis_single_usage_sync", durationMs: Date.now() - startedAt },
        timestamp: new Date(),
      });
    } catch (auditErr) {
      console.error("[simhuis-usage-sync] Per-sim audit log failed:", auditErr);
    }
  }

  const finalCoreDataUsage = applyUsage.newData;
  const finalProductData = applyProduct.newData;
  const toNum = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const simhuisFields: PerSimUsageSyncResult["simhuisFields"] = {
    dataUsedBytes: toNum(finalCoreDataUsage.dataUsedBytes),
    dataLimitBytes: toNum(finalCoreDataUsage.dataLimitBytes),
    lowestDataLimitBytes: toNum(finalCoreDataUsage.lowestDataLimitBytes),
    smsUsedCount:
      typeof finalCoreDataUsage.smsUsedCount === 'number' && Number.isFinite(finalCoreDataUsage.smsUsedCount)
        ? Math.round(finalCoreDataUsage.smsUsedCount)
        : null,
    smsLimitCount:
      typeof finalCoreDataUsage.smsLimitCount === 'number' && Number.isFinite(finalCoreDataUsage.smsLimitCount)
        ? Math.round(finalCoreDataUsage.smsLimitCount)
        : null,
    lowestSmsLimitCount:
      typeof finalCoreDataUsage.lowestSmsLimitCount === 'number' && Number.isFinite(finalCoreDataUsage.lowestSmsLimitCount)
        ? Math.round(finalCoreDataUsage.lowestSmsLimitCount)
        : null,
    productName: finalProductData.product ?? simhuisStatus.productName ?? simhuisStatus.planName ?? null,
    productType: finalProductData.productType ?? simhuisStatus.productType ?? null,
    simName: finalProductData.simName ?? simhuisStatus.simName ?? null,
    groupName: finalProductData.simGroup ?? simhuisStatus.groupName ?? simhuisStatus.groupId ?? null,
    usageSource: (finalCoreDataUsage as any).usageSource ?? (simhuisStatus as any).usageSource ?? null,
    usageBundleId: (finalCoreDataUsage as any).usageBundleId ?? (simhuisStatus as any).usageBundleId ?? null,
    usageLocalProductId: (finalCoreDataUsage as any).usageLocalProductId ?? (simhuisStatus as any).usageLocalProductId ?? null,
    usageLocalProductName: (finalCoreDataUsage as any).usageLocalProductName ?? (simhuisStatus as any).usageLocalProductName ?? null,
    usagePeriodStart: (finalCoreDataUsage as any).usagePeriodStart ?? ((simhuisStatus as any).usagePeriodStart ? new Date((simhuisStatus as any).usagePeriodStart) : null),
    usagePeriodEnd: (finalCoreDataUsage as any).usagePeriodEnd ?? ((simhuisStatus as any).usagePeriodEnd ? new Date((simhuisStatus as any).usagePeriodEnd) : null),
    usageRetrievedAt: (finalCoreDataUsage as any).usageRetrievedAt ?? ((simhuisStatus as any).usageRetrievedAt ? new Date((simhuisStatus as any).usageRetrievedAt) : null),
    usageCdrQueryStart: (finalCoreDataUsage as any).usageCdrQueryStart ?? ((simhuisStatus as any).usageCdrQueryStart ? new Date((simhuisStatus as any).usageCdrQueryStart) : null),
    usageCdrQueryEnd: (finalCoreDataUsage as any).usageCdrQueryEnd ?? ((simhuisStatus as any).usageCdrQueryEnd ? new Date((simhuisStatus as any).usageCdrQueryEnd) : null),
    usageBundleUsages: (finalCoreDataUsage as any).usageBundleUsages ?? (simhuisStatus as any).usageBundleUsages ?? null,
    usageSelectionNote: (finalCoreDataUsage as any).usageSelectionNote ?? (simhuisStatus as any).usageSelectionNote ?? null,
    activationDate: (finalCoreDataUsage as any).activationDate ?? ((simhuisStatus as any).activationDate ? new Date((simhuisStatus as any).activationDate) : null),
    reactivationDate: (finalCoreDataUsage as any).reactivationDate ?? ((simhuisStatus as any).reactivationDate ? new Date((simhuisStatus as any).reactivationDate) : null),
    subscriptionDate: (finalCoreDataUsage as any).subscriptionDate ?? ((simhuisStatus as any).subscriptionDate ? new Date((simhuisStatus as any).subscriptionDate) : null),
  };

  return {
    simId,
    iccid: normalizedIccid,
    updated: updatedNow,
    changedFields: allChangedFields,
    hasAnyUsageData: applyUsage.hasAnyUsageData,
    source,
    fetchedAt: new Date(),
    durationMs: Date.now() - startedAt,
    errorMessage,
    simhuisFields,
  };
}
