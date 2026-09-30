import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import { listAllSims, getSimStatus, simhuisClient } from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import { SimStatus, type UserRole } from "@/types/enums";

type Ctx = { userId?: string; userRole?: UserRole };

type UsageFields = {
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  lowestDataLimitBytes: bigint | null;
  smsUsedCount: number | null;
  smsLimitCount: number | null;
  lowestSmsLimitCount: number | null;
  lastUsageSyncAt: Date | null;
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
  return {
    dataUsedBytes: dataUsedBytesVal,
    dataLimitBytes: dataLimitBytesVal,
    lowestDataLimitBytes: lowestDataLimitBytesVal,
    smsUsedCount: smsUsedCountVal,
    smsLimitCount: smsLimitCountVal,
    lowestSmsLimitCount: lowestSmsLimitCountVal,
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

function normIccid(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s) return null;
  return s.length > 40 ? s.slice(0, 40) : s;
}

function normMsisdn(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").replace(/[^\d+]/g, "").trim();
  if (!s) return null;
  return s.length > 30 ? s.slice(0, 30) : s;
}

function normImsi(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s) return null;
  return s.length > 20 ? s.slice(0, 20) : s;
}

function normEid(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, "").trim();
  if (!s) return null;
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

  let allSimsFromSimhuis: SimhuisSimStatus[] = [];
  try {
    allSimsFromSimhuis = await listAllSims();
  } catch (e: any) {
    throw new Error(`Ophalen SIMs van Simhuis mislukt: ${e?.message ?? e}`);
  }

  const totalInSimhuis = allSimsFromSimhuis.length;
  const eligible = allSimsFromSimhuis.filter((s) => s.iccid);

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

  const upsertPromises: Promise<unknown>[] = [];
  let auditCreatedEntries: Array<{ iccid: string; msisdn?: string | null; imsi?: string | null }> = [];
  let auditUpdatedEntries: Array<{ iccid: string; old: any; new: any }> = [];

  for (const simhuis of eligible) {
    const rawIccid = simhuis.iccid;
    const iccid = normIccid(rawIccid);
    if (!iccid) {
      skipped++;
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
      const msisdnVal = normMsisdn(rawMsisdn);
      const imsiVal = normImsi(rawImsi);
      const eidVal = normEid(rawEid);
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
        if (existing.deletedAt) {
          skipped++;
          continue;
        }
        if (skipIfLocked && existing.status !== SimStatus.IN_STOCK && status === SimStatus.IN_STOCK) {
          skipped++;
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
        };
        const newData: Record<string, any> = { ...oldData };
        let changed = false;
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
          continue;
        }
        const validatedStatusForUpdate = validateAndNormalizeSimStatus(
          newData.status,
          `UPDATE iccid=${iccid} existingId=${existing.id}`
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
            },
          })
          .then(() => {
            auditUpdatedEntries.push({ iccid, old: oldData, new: newData });
            updated++;
          })
          .catch((err) => {
            errorCount++;
            errors.push(`[${iccid}] Update mislukt: ${err?.message ?? err}`);
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
      if (errorCount > 0) {
        await logAudit(tx, {
          entityType: "SIM",
          entityId: `sync_simhuis_batch_${Date.now()}_err`,
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
  const targetSims = await prisma.sIM.findMany({
    where: {
      deletedAt: null,
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
  changedFields: Array<keyof UsageFields>;
  hasAnyUsageData: boolean;
  source: "per-sim-discovery" | "list-fallback";
  fetchedAt: Date;
  durationMs: number;
  errorMessage?: string;
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

  const sim = await prisma.sIM.findUnique({
    where: { id: simId, deletedAt: null },
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
    },
  });
  if (!sim) {
    throw new Error(`SIM met id ${simId} niet gevonden.`);
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
  const apply = applyUsageFieldsFromSimhuis(existingUsage, simhuisStatus);

  if (apply.changed || apply.hasAnyUsageData) {
    await prisma.sIM.update({
      where: { id: sim.id },
      data: {
        dataUsedBytes: apply.newData.dataUsedBytes,
        dataLimitBytes: apply.newData.dataLimitBytes,
        lowestDataLimitBytes: apply.newData.lowestDataLimitBytes,
        smsUsedCount: apply.newData.smsUsedCount,
        smsLimitCount: apply.newData.smsLimitCount,
        lowestSmsLimitCount: apply.newData.lowestSmsLimitCount,
        lastUsageSyncAt: apply.newData.lastUsageSyncAt,
      },
    });
    try {
      await logAudit(prisma, {
        entityType: "SIM",
        entityId: sim.id,
        action: "UPDATE",
        userId: ctx.userId ?? "SYSTEM",
        oldValues: { ...apply.oldData, source: "simhuis_single_usage_sync" },
        newValues: { ...apply.newData, source, changedFields: apply.changedFields, errorMessage },
        metadata: { scope: "simhuis_single_usage_sync", durationMs: Date.now() - startedAt },
        timestamp: new Date(),
      });
    } catch (auditErr) {
      console.error("[simhuis-usage-sync] Per-sim audit log failed:", auditErr);
    }
  }

  return {
    simId,
    iccid: normalizedIccid,
    updated: apply.changed || apply.hasAnyUsageData ? 1 : 0,
    changedFields: apply.changedFields,
    hasAnyUsageData: apply.hasAnyUsageData,
    source,
    fetchedAt: new Date(),
    durationMs: Date.now() - startedAt,
    errorMessage,
  };
}
