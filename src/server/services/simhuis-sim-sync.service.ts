import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import { listAllSims, simhuisClient } from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import type { SimStatus, UserRole } from "@/types/enums";

type Ctx = { userId?: string; userRole?: UserRole };

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
      notes: true,
      deletedAt: true,
    },
  });
  const existingByIccid = new Map(existingSims.map((s) => [s.iccid, s]));

  const upsertPromises: Promise<unknown>[] = [];
  let auditCreatedEntries: Array<{ iccid: string; msisdn?: string | null; imsi?: string | null }> = [];
  let auditUpdatedEntries: Array<{ iccid: string; old: any; new: any }> = [];

  for (const simhuis of eligible) {
    const iccid = simhuis.iccid;
    try {
      const existing = existingByIccid.get(iccid);
      const { status, skipIfLocked } = mapSimhuisStatusToNexus(simhuis.status, existing?.status as any);

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
          provider: existing.provider,
        };
        const newData: Record<string, any> = { ...oldData };
        let changed = false;
        if (existing.status !== status) {
          newData.status = status;
          changed = true;
        }
        if (simhuis.msisdn && existing.msisdn !== simhuis.msisdn) {
          newData.msisdn = simhuis.msisdn;
          changed = true;
        }
        if (simhuis.imsi && existing.imsi !== simhuis.imsi) {
          newData.imsi = simhuis.imsi;
          changed = true;
        }
        const providerTag = "Simhuis";
        if (!existing.provider?.toLowerCase().includes("simhuis")) {
          newData.provider = existing.provider ? `${existing.provider} + ${providerTag}` : providerTag;
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
              provider: newData.provider,
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
        const statusForNew: SimStatus = isSimAvailableForStock(simhuis.status)
          ? ("IN_STOCK" as any)
          : ("RESERVED" as any);
        const providerTag = "Simhuis";
        const p = prisma.sIM
          .create({
            data: {
              iccid,
              msisdn: simhuis.msisdn ?? null,
              imsi: simhuis.imsi ?? null,
              provider: providerTag,
              simType: simhuis.network ?? null,
              status: statusForNew,
              notes: simhuis.planName
                ? `Geïmporteerd vanuit Simhuis. Plan: ${simhuis.planName}`
                : "Geïmporteerd vanuit Simhuis.",
            },
          })
          .then(() => {
            auditCreatedEntries.push({ iccid, msisdn: simhuis.msisdn, imsi: simhuis.imsi });
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
      const meta = {
        scope: "simhuis_sim_sync",
        totalInSimhuis,
        eligibleCount: eligible.length,
        created,
        updated,
        skipped,
        errors: errorCount,
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
