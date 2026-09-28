import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import { listAllSims, simhuisClient } from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import type { SimStatus, UserRole } from "@/types/enums";

type Ctx = { userId?: string; userRole?: UserRole };

function truncate(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
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
    return { status: "IN_STOCK" as any, skipIfLocked: true };
  }
  const s = String(simhuisStatus ?? "").toLowerCase();
  if (s === "active" || s === "enabled" || s === "online") {
    return { status: "ACTIVE" as any, skipIfLocked: true };
  }
  if (s === "suspended" || s === "paused" || s === "barred") {
    return { status: "SUSPENDED" as any, skipIfLocked: false };
  }
  if (s === "terminated" || s === "deleted" || s === "cancelled") {
    return { status: "TERMINATED" as any, skipIfLocked: false };
  }
  if (s === "provisioning" || s === "activating" || s === "pending") {
    return { status: "RESERVED" as any, skipIfLocked: true };
  }
  return { status: "IN_STOCK" as any, skipIfLocked: true };
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
      simType: true,
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
      const { status, skipIfLocked } = mapSimhuisStatusToNexus(simhuis.status, existing?.status as any);

      const rawMsisdn = simhuis.msisdn;
      const rawImsi = simhuis.imsi;
      const rawEid = simhuis.eid;
      const rawSubscriberId = simhuis.subscriberId;
      const rawSimName = simhuis.simName;
      const rawGroupName = simhuis.groupName ?? simhuis.groupId;
      const rawProduct = simhuis.productName ?? simhuis.planName;
      const rawNetwork = simhuis.network;
      const rawPlanName = simhuis.planName;
      const msisdnVal = normMsisdn(rawMsisdn);
      const imsiVal = normImsi(rawImsi);
      const eidVal = normEid(rawEid);
      const subscriberIdVal = truncate(rawSubscriberId, 100);
      const simNameVal = truncate(rawSimName, 200);
      const groupVal = truncate(rawGroupName, 100);
      const productVal = truncate(rawProduct, 200);
      const networkVal = truncate(rawNetwork, 100);
      const planVal = truncate(rawPlanName, 500);
      const notesVal = buildSimNotes(simhuis);

      if (existing) {
        if (existing.deletedAt) {
          skipped++;
          continue;
        }
        if (skipIfLocked && existing.status !== "IN_STOCK" && status === "IN_STOCK") {
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
          provider: existing.provider,
          simType: existing.simType,
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
        if (networkVal && existing.simType !== networkVal) { newData.simType = networkVal; changed = true; }
        if (notesVal && existing.notes !== notesVal) { newData.notes = notesVal; changed = true; }
        const providerTag = "Simhuis";
        if (!existing.provider?.toLowerCase().includes("simhuis")) {
          newData.provider = existing.provider ? truncate(`${existing.provider} + ${providerTag}`, 150) ?? providerTag : providerTag;
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
              status: newData.status,
              msisdn: newData.msisdn,
              imsi: newData.imsi,
              eid: newData.eid,
              subscriberId: newData.subscriberId,
              simName: newData.simName,
              simGroup: newData.simGroup,
              product: newData.product,
              simType: newData.simType,
              provider: newData.provider,
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
        const { status: statusForNew } = mapSimhuisStatusToNexus(simhuis.status, null);
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
              provider: providerTag,
              simType: networkVal,
              status: statusForNew,
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
