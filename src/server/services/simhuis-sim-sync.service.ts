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
};

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

      if (existing) {
        const wasSoftDeleted = !!existing.deletedAt;
        if (skipIfLocked && !wasSoftDeleted && existing.status !== SimStatus.IN_STOCK && status === SimStatus.IN_STOCK) {
          skipped++;
          h.skippedReasonLocked++;
          continue;
        }
        const oldData = {
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
        };
        const newData: Record<string, any> = { ...oldData };
        let changed = wasSoftDeleted; // altijd "changed" als we zojuist hebben gerestaureerd
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

  // 4. Update parallel per match.
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

      const oldData = {
        dataUsedBytes: existing.dataUsedBytes,
        dataLimitBytes: existing.dataLimitBytes,
        lowestDataLimitBytes: existing.lowestDataLimitBytes,
        smsUsedCount: existing.smsUsedCount,
        smsLimitCount: existing.smsLimitCount,
        lowestSmsLimitCount: existing.lowestSmsLimitCount,
        lastUsageSyncAt: existing.lastUsageSyncAt,
      };

      let changed = false;
      const newData: typeof oldData = { ...oldData };
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
  if (!simhuisStatus) {
    source = "list-fallback";
    try {
      const all = await listAllSims();
      const match = all.find(
        (s) => normIccid(s.iccid) === normalizedIccid
      );
      if (match) simhuisStatus = match;
      else errorMessage = errorMessage ? `${errorMessage} | Fallback listAllSims: ICCID niet gevonden in lijst.` : `ICCID niet gevonden in Simhuis lijst.`;
    } catch (e: any) {
      errorMessage = errorMessage
        ? `${errorMessage} | Fallback listAllSims mislukt: ${e?.message ?? e}`
        : `listAllSims mislukt: ${e?.message ?? e}`;
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

  const simhuisFields: PerSimUsageSyncResult["simhuisFields"] = {
    dataUsedBytes: simhuisStatus.dataUsedBytes ?? null,
    dataLimitBytes: simhuisStatus.dataLimitBytes ?? null,
    lowestDataLimitBytes: simhuisStatus.lowestDataLimitBytes ?? null,
    smsUsedCount: simhuisStatus.smsUsedCount ?? null,
    smsLimitCount: simhuisStatus.smsLimitCount ?? null,
    lowestSmsLimitCount: simhuisStatus.lowestSmsLimitCount ?? null,
    productName: simhuisStatus.productName ?? simhuisStatus.planName ?? null,
    productType: simhuisStatus.productType ?? null,
    simName: simhuisStatus.simName ?? null,
    groupName: simhuisStatus.groupName ?? simhuisStatus.groupId ?? null,
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
