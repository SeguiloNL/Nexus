import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { generateInvoiceNumber } from "@/lib/identifiers";
import { requirePermission, PermissionError, hasMinRole } from "@/lib/rbac";
import type { PaginatedResult } from "@/types/domain";
import type { InvoiceStatus } from "@/types/enums";
import { UserRole } from "@/types/enums";
import type {
  Prisma,
  Invoice as PrismaInvoice,
  Subscription as PrismaSub,
  $Enums,
} from "@prisma/client";

type BillingCycle = $Enums.BillingCycle;

type Ctx = { userId: string; userRole: UserRole };

export interface MonthlyGenerationResult {
  periodStart: string;
  periodEnd: string;
  subscriptionsInScope: number;
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ subscriptionId: string; subscriptionNumber?: string; error: string }>;
  invoices: PrismaInvoice[];
}

const DEFAULT_VAT_RATE = 21;
const DEFAULT_NET_TERMS_DAYS = 14;

function includeRelations(): Prisma.InvoiceInclude {
  return {
    customer: {
      select: { id: true, customerNumber: true, companyName: true },
    },
    subscription: {
      select: { id: true, subscriptionNumber: true, status: true },
    },
  };
}

/**
 * Geeft de eerste en laatste dag van een maand terug als Date (alleen datum, 00:00 local).
 */
export function getMonthBounds(year: number, month: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Ongeldig jaar: ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Ongeldige maand: ${month} (gebruik 1-12)`);
  }
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end };
}

/**
 * Voegt N dagen toe aan een datum en retourneert een nieuwe Date.
 */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Berekent de factoring obv billing cycle (1 voor MONTHLY, 3 QUARTERLY, 12 YEARLY).
 * Omdat generateMonthly per maand genereert, gebruiken we factor 1 voor alle cycles
 * zodat elke abonnee elke maand 1 factuur krijgt. Pas dit aan als je per kwartaal/jaar
 * in 1 keer wil factureren.
 */
function billingFactor(_cycle: BillingCycle): number {
  return 1;
}

export async function generateMonthly(
  year: number,
  month: number,
  ctx: Ctx
): Promise<MonthlyGenerationResult> {
  requirePermission(ctx.userRole, "create", "invoice");

  const { start: periodStart, end: periodEnd } = getMonthBounds(year, month);
  const startStr = periodStart.toISOString().slice(0, 10);
  const endStr = periodEnd.toISOString().slice(0, 10);

  return prisma.$transaction(async (tx) => {
    const subscriptions = await tx.subscription.findMany({
      where: {
        deletedAt: null,
        status: {
          in: ["ACTIVE", "SUSPENDED"] as any,
        },
        AND: [
          { startDate: { lte: periodEnd } },
          {
            OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
          },
        ],
      },
      include: {
        product: { select: { btwPercentage: true } },
      },
    });

    const result: MonthlyGenerationResult = {
      periodStart: startStr,
      periodEnd: endStr,
      subscriptionsInScope: subscriptions.length,
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      invoices: [],
    };

    for (const sub of subscriptions) {
      try {
        const existing = await tx.invoice.findUnique({
          where: {
            subscriptionId_periodStart_periodEnd: {
              subscriptionId: sub.id,
              periodStart,
              periodEnd,
            },
          },
        });
        if (existing) {
          result.skipped += 1;
          continue;
        }

        const factor = billingFactor(sub.billingCycle);
        const subtotalNum = Number(sub.monthlyPrice) * factor;
        const vatRateNum = Number(sub.product?.btwPercentage ?? DEFAULT_VAT_RATE);
        const vatAmountNum = +(subtotalNum * (vatRateNum / 100)).toFixed(2);
        const totalNum = +(subtotalNum + vatAmountNum).toFixed(2);

        const issueDate = periodStart;
        const dueDate = addDays(issueDate, DEFAULT_NET_TERMS_DAYS);

        const invoiceNumber = await generateInvoiceNumber(tx);
        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            subscriptionId: sub.id,
            customerId: sub.customerId,
            periodStart,
            periodEnd,
            issueDate,
            dueDate,
            subtotal: subtotalNum as any,
            vatRate: vatRateNum as any,
            vatAmount: vatAmountNum as any,
            total: totalNum as any,
            status: "DRAFT" as any,
            note: `Automatisch gegenereerd op ${new Date().toISOString().slice(0, 10)} obv ${sub.billingCycle} abonnement.`,
          },
        });

        await logAudit(tx, {
          entityType: "invoice",
          entityId: created.id,
          action: "CREATE",
          userId: ctx.userId,
          newValues: created as unknown as Record<string, unknown>,
        });

        result.created += 1;
        result.invoices.push(created as PrismaInvoice);
      } catch (e: any) {
        result.failed += 1;
        result.errors.push({
          subscriptionId: sub.id,
          subscriptionNumber: sub.subscriptionNumber,
          error: e?.message ?? String(e),
        });
      }
    }

    await logAudit(tx, {
      entityType: "subscription",
      entityId: `BATCH-${year}-${String(month).padStart(2, "0")}`,
      action: "GENERATE_INVOICES",
      userId: ctx.userId,
      newValues: {
        periodStart: startStr,
        periodEnd: endStr,
        subscriptionsInScope: result.subscriptionsInScope,
        created: result.created,
        skipped: result.skipped,
        failed: result.failed,
      } as unknown as Record<string, unknown>,
    });

    return result;
  });
}

export async function findManyInvoices(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    customerId?: string;
    subscriptionId?: string;
    status?: InvoiceStatus;
    issueDateFrom?: Date;
    issueDateTo?: Date;
  },
  ctx: Ctx
): Promise<PaginatedResult<PrismaInvoice>> {
  requirePermission(ctx.userRole, "view", "invoice");
  const {
    page = 1,
    perPage = 25,
    sort = "issueDate",
    order = "desc",
    search,
    customerId,
    subscriptionId,
    status,
    issueDateFrom,
    issueDateTo,
  } = params;

  const where: Prisma.InvoiceWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (subscriptionId) where.subscriptionId = subscriptionId;
  if (status) where.status = status as any;
  if (issueDateFrom || issueDateTo) {
    const df: any = {};
    if (issueDateFrom) df.gte = issueDateFrom;
    if (issueDateTo) df.lte = issueDateTo;
    where.issueDate = df;
  }

  if (search) {
    const s = search.trim();
    where.OR = [
      { invoiceNumber: { contains: s, mode: "insensitive" } },
      { customer: { companyName: { contains: s, mode: "insensitive" } } },
      { customer: { customerNumber: { contains: s, mode: "insensitive" } } },
      { subscription: { subscriptionNumber: { contains: s, mode: "insensitive" } } },
      { note: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.InvoiceOrderByWithRelationInput =
    sort === "invoiceNumber"
      ? "invoiceNumber"
      : sort === "status"
        ? "status"
        : sort === "dueDate"
          ? "dueDate"
          : sort === "total"
            ? "total"
            : sort === "createdAt"
              ? "createdAt"
              : "issueDate";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: includeRelations(),
      orderBy: { [sortKey]: order } as Prisma.InvoiceOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data: data as PrismaInvoice[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findInvoicesBySubscriptionId(
  subscriptionId: string,
  ctx: Ctx
): Promise<PrismaInvoice[]> {
  requirePermission(ctx.userRole, "view", "invoice");
  return prisma.invoice.findMany({
    where: { subscriptionId },
    include: includeRelations(),
    orderBy: { issueDate: "desc" },
  }) as Promise<PrismaInvoice[]>;
}

export async function findInvoiceById(id: string, ctx: Ctx) {
  requirePermission(ctx.userRole, "view", "invoice");
  return prisma.invoice.findUnique({
    where: { id },
    include: includeRelations(),
  });
}

export async function markInvoicePaid(
  id: string,
  ctx: Ctx,
  paidAt?: Date
): Promise<PrismaInvoice> {
  requirePermission(ctx.userRole, "edit", "invoice");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (existing.status === "PAID" || existing.status === "CANCELLED") {
      return existing as PrismaInvoice;
    }
    const paidAtDate = paidAt ?? new Date();
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: "PAID" as any,
        paidAt: paidAtDate,
      },
    });
    await logAudit(tx, {
      entityType: "invoice",
      entityId: updated.id,
      action: "MARK_INVOICE_PAID",
      userId: ctx.userId,
      oldValues: { status: existing.status, paidAt: existing.paidAt } as any,
      newValues: { status: updated.status, paidAt: updated.paidAt } as any,
    });
    return updated as PrismaInvoice;
  });
}

export async function markInvoiceSent(
  id: string,
  ctx: Ctx,
  sentAt?: Date
): Promise<PrismaInvoice> {
  requirePermission(ctx.userRole, "edit", "invoice");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (existing.status !== "DRAFT") {
      return existing as PrismaInvoice;
    }
    const sentAtDate = sentAt ?? new Date();
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: "SENT" as any,
        sentAt: sentAtDate,
      },
    });
    await logAudit(tx, {
      entityType: "invoice",
      entityId: updated.id,
      action: "SEND_INVOICE",
      userId: ctx.userId,
      oldValues: { status: existing.status, sentAt: (existing as any).sentAt } as any,
      newValues: { status: updated.status, sentAt: (updated as any).sentAt?.toISOString() } as any,
      metadata: { sentAt: sentAtDate.toISOString() },
    });
    return updated as PrismaInvoice;
  });
}

export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatus,
  ctx: Ctx,
  note?: string
): Promise<PrismaInvoice> {
  requirePermission(ctx.userRole, "edit", "invoice");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({ where: { id } });
    const data: Prisma.InvoiceUpdateInput = { status: status as any };
    if (note !== undefined) {
      data.note = existing.note ? `${existing.note}\n\n${note}` : note;
    }
    if (status === "PAID" && !existing.paidAt) {
      data.paidAt = new Date();
    }
    const updated = await tx.invoice.update({ where: { id }, data });
    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "invoice",
        entityId: updated.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues,
        newValues,
      });
    }
    return updated as PrismaInvoice;
  });
}

export async function softDeleteInvoice(id: string, ctx: Ctx): Promise<PrismaInvoice> {
  requirePermission(ctx.userRole, "delete", "invoice");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({ where: { id } });
    const updated = await tx.invoice.update({
      where: { id },
      data: { status: "CANCELLED" as any, note: existing.note ? `${existing.note}\n\n[GEANNULEERD]` : "[GEANNULEERD]" },
    });
    await logAudit(tx, {
      entityType: "invoice",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
      newValues: { status: updated.status } as unknown as Record<string, unknown>,
    });
    return updated as PrismaInvoice;
  });
}

export async function hardDeleteInvoice(id: string, ctx: Ctx): Promise<PrismaInvoice> {
  requirePermission(ctx.userRole, "delete", "invoice");
  if (!hasMinRole(ctx.userRole, UserRole.ADMIN)) {
    throw new PermissionError(
      "Onvoldoende rechten: alleen ADMIN mag facturen definitief verwijderen uit het systeem."
    );
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({ where: { id } });
    await logAudit(tx, {
      entityType: "invoice",
      entityId: existing.id,
      action: "HARD_DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });
    await tx.invoice.delete({ where: { id } });
    return existing as PrismaInvoice;
  });
}

export async function bulkCancelInvoices(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  requirePermission(ctx.userRole, "delete", "invoice");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const rows = await tx.invoice.findMany({
      where: { id: { in: ids }, status: { notIn: ["PAID", "CANCELLED"] as any } },
      select: { id: true, note: true, status: true },
    });
    if (!rows.length) return { count: 0, ids: [] };
    const targets = rows.map((r) => r.id);
    const updates = rows.map((r) =>
      tx.invoice.update({
        where: { id: r.id },
        data: {
          status: "CANCELLED" as any,
          note: r.note ? `${r.note}\n\n[BULK GEANNULEERD]` : "[BULK GEANNULEERD]",
        },
      })
    );
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "invoice",
        entityId: r.id,
        action: "DELETE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
        newValues: { status: "CANCELLED" } as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([...updates, ...audits]);
    void now;
    return { count: targets.length, ids: targets };
  });
}

export async function bulkMarkInvoicesSent(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  requirePermission(ctx.userRole, "edit", "invoice");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.invoice.findMany({
      where: { id: { in: ids }, status: "DRAFT" as any },
      select: { id: true, status: true, sentAt: true },
    });
    if (!rows.length) return { count: 0, ids: [] };
    const sentAt = new Date();
    const targets = rows.map((r) => r.id);
    const updates = targets.map((id) =>
      tx.invoice.update({
        where: { id },
        data: { status: "SENT" as any, sentAt },
      })
    );
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "invoice",
        entityId: r.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
        newValues: { status: "SENT", sentAt: sentAt.toISOString() } as unknown as Record<
          string,
          unknown
        >,
      })
    );
    await Promise.all([...updates, ...audits]);
    return { count: targets.length, ids: targets };
  });
}

export async function bulkMarkInvoicesPaid(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  requirePermission(ctx.userRole, "edit", "invoice");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.invoice.findMany({
      where: { id: { in: ids }, status: { notIn: ["PAID", "CANCELLED"] as any } },
      select: { id: true, status: true, paidAt: true },
    });
    if (!rows.length) return { count: 0, ids: [] };
    const paidAt = new Date();
    const targets = rows.map((r) => r.id);
    const updates = targets.map((id) =>
      tx.invoice.update({
        where: { id },
        data: { status: "PAID" as any, paidAt },
      })
    );
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "invoice",
        entityId: r.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
        newValues: { status: "PAID", paidAt: paidAt.toISOString() } as unknown as Record<
          string,
          unknown
        >,
      })
    );
    await Promise.all([...updates, ...audits]);
    return { count: targets.length, ids: targets };
  });
}

export async function bulkHardDeleteInvoices(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  requirePermission(ctx.userRole, "delete", "invoice");
  if (!hasMinRole(ctx.userRole, UserRole.ADMIN)) {
    throw new PermissionError(
      "Onvoldoende rechten: alleen ADMIN mag facturen definitief verwijderen uit het systeem."
    );
  }
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.invoice.findMany({ where: { id: { in: ids } } });
    if (!rows.length) return { count: 0, ids: [] };
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "invoice",
        entityId: r.id,
        action: "HARD_DELETE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([
      tx.invoice.deleteMany({ where: { id: { in: ids } } }),
      ...audits,
    ]);
    return { count: rows.length, ids: rows.map((r) => r.id) };
  });
}

export { PermissionError };
