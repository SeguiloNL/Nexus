import { prisma } from "@/lib/prisma";
import { syncSubscriptionToInserve } from "./inserve-sync.service";
import { syncInvoiceToInserve } from "./inserve-invoice-sync.service";
import type { UserRole } from "@/types/enums";

export interface InserveBatchSyncResult {
  subscriptions: {
    total: number;
    synced: number;
    skipped: number;
    failed: number;
    failedDetails: { subscriptionNumber: string; error: string }[];
  };
  invoices: {
    total: number;
    synced: number;
    skipped: number;
    failed: number;
    failedDetails: { invoiceNumber: string; error: string }[];
  };
  durationMs: number;
}

type Ctx = { userId: string; userRole: UserRole };

export async function syncAllPendingToInserve(
  ctx: Ctx,
  options: { maxPerType?: number } = {}
): Promise<InserveBatchSyncResult> {
  const take = options.maxPerType ?? 200;
  const t0 = Date.now();

  const subRows = await prisma.subscription.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ACTIVE", "CANCELLED", "TERMINATED", "SUSPENDED"] },
      OR: [
        { inserveSyncStatus: null },
        { inserveSyncStatus: "FAILED" },
        { inserveSyncStatus: "SKIPPED" },
      ],
    },
    select: {
      id: true,
      subscriptionNumber: true,
      status: true,
      inserveSyncStatus: true,
    },
    take,
  });

  const subResult: InserveBatchSyncResult["subscriptions"] = {
    total: subRows.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    failedDetails: [],
  };
  for (const s of subRows) {
    try {
      const r = await syncSubscriptionToInserve(s.id, ctx);
      if (r.status === "SYNCED") subResult.synced++;
      else if (r.status === "SKIPPED") subResult.skipped++;
      else {
        subResult.failed++;
        subResult.failedDetails.push({
          subscriptionNumber: s.subscriptionNumber,
          error: r.error ?? r.details ?? "onbekend",
        });
      }
    } catch (e: any) {
      subResult.failed++;
      subResult.failedDetails.push({
        subscriptionNumber: s.subscriptionNumber,
        error: e?.message ?? String(e),
      });
    }
  }

  const invRows = await prisma.invoice.findMany({
    where: {
      status: { in: ["DRAFT", "SENT", "OVERDUE"] },
      OR: [
        { inserveSyncStatus: null },
        { inserveSyncStatus: "FAILED" },
        { inserveSyncStatus: "SKIPPED" },
      ],
    },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      inserveSyncStatus: true,
    },
    take,
  });

  const invResult: InserveBatchSyncResult["invoices"] = {
    total: invRows.length,
    synced: 0,
    skipped: 0,
    failed: 0,
    failedDetails: [],
  };
  for (const i of invRows) {
    try {
      const r = await syncInvoiceToInserve(i.id, ctx);
      if (r.status === "SYNCED") invResult.synced++;
      else if (r.status === "SKIPPED") invResult.skipped++;
      else {
        invResult.failed++;
        invResult.failedDetails.push({
          invoiceNumber: i.invoiceNumber,
          error: r.error ?? r.details ?? "onbekend",
        });
      }
    } catch (e: any) {
      invResult.failed++;
      invResult.failedDetails.push({
        invoiceNumber: i.invoiceNumber,
        error: e?.message ?? String(e),
      });
    }
  }

  return {
    subscriptions: subResult,
    invoices: invResult,
    durationMs: Date.now() - t0,
  };
}
