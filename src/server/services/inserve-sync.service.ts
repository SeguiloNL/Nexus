import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import {
  upsertCompany as inserveUpsertCompany,
  ensureArticle as inserveEnsureArticle,
  createSubscriptionContract as inserveCreateContract,
  cancelOrTerminateContract as inserveCancelContract,
} from "../integrations/inserve/service";
import { inserveClient } from "../integrations/inserve/client";
import type { UserRole } from "@/types/enums";
import type { Prisma, Subscription as PrismaSub } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

type SubWithJoins = Prisma.PrismaPromise<
  PrismaSub & {
    customer: {
      id: string;
      customerNumber: string;
      companyName: string;
      address: string | null;
      postalCode: string | null;
      city: string | null;
      country: string | null;
      contactPerson: string | null;
      phone: string | null;
      email: string | null;
      kvkNr: string | null;
      btwNr: string | null;
      inserveCompanyId: number | null;
    };
    product: {
      id: string;
      productCode: string;
      name: string;
      monthlyPrice: Prisma.Decimal;
      currency: string;
      btwPercentage: Prisma.Decimal | null;
      isActive: boolean;
      inserveArticleId: number | null;
    };
  }
>;

function findFullSub(id: string) {
  return prisma.subscription.findUniqueOrThrow({
    where: { id, deletedAt: null },
    include: {
      customer: {
        select: {
          id: true,
          customerNumber: true,
          companyName: true,
          address: true,
          postalCode: true,
          city: true,
          country: true,
          contactPerson: true,
          phone: true,
          email: true,
          kvkNr: true,
          btwNr: true,
          inserveCompanyId: true,
        },
      },
      product: {
        select: {
          id: true,
          productCode: true,
          name: true,
          monthlyPrice: true,
          currency: true,
          btwPercentage: true,
          isActive: true,
          inserveArticleId: true,
        },
      },
    },
  }) as unknown as SubWithJoins extends infer P ? Promise<Awaited<P>> : never;
}

const SYNCABLE_STATUSES = new Set<string>([
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "TERMINATED",
]);

export async function syncSubscriptionToInserve(
  subscriptionId: string,
  ctx: Ctx
): Promise<{ status: "SYNCED" | "SKIPPED" | "FAILED"; error?: string; details?: string }> {
  if (!inserveClient.isConfigured()) {
    return {
      status: "SKIPPED",
      details: "Inserve is niet geconfigureerd (set INSERVE_SUBDOMAIN + INSERVE_API_KEY).",
    };
  }

  let sub: Awaited<ReturnType<typeof findFullSub>>;
  try {
    sub = await findFullSub(subscriptionId);
  } catch (e) {
    return { status: "FAILED", error: `Subscription niet gevonden: ${e}` };
  }

  if (!SYNCABLE_STATUSES.has(sub.status)) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { inserveSyncStatus: "SKIPPED", inserveSyncError: null },
    });
    return { status: "SKIPPED", details: `Status ${sub.status} wordt niet gesynchroniseerd.` };
  }

  let warnings: string[] = [];

  try {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        inserveSyncStatus: "IN_PROGRESS",
        inserveSyncError: null,
      },
    });

    const companyResult = await prisma.$transaction(async (tx) => {
      const company = await inserveUpsertCompany({
        id: sub.customer.id,
        customerNumber: sub.customer.customerNumber,
        companyName: sub.customer.companyName,
        address: sub.customer.address,
        postalCode: sub.customer.postalCode,
        city: sub.customer.city,
        country: sub.customer.country,
        contactPerson: sub.customer.contactPerson,
        phone: sub.customer.phone,
        email: sub.customer.email,
        kvkNr: sub.customer.kvkNr,
        btwNr: sub.customer.btwNr,
        inserveCompanyId: sub.customer.inserveCompanyId,
      });

      if (!sub.customer.kvkNr) warnings.push("Klant heeft geen KvK-nummer.");
      if (!sub.customer.btwNr) warnings.push("Klant heeft geen BTW-nummer.");
      if (!sub.customer.address || !sub.customer.postalCode || !sub.customer.city) {
        warnings.push("Klant adresgegevens zijn incompleet.");
      }

      await tx.customer.update({
        where: { id: sub.customer.id },
        data: { inserveCompanyId: company.id },
      });

      return company;
    });

    const articleId = await prisma.$transaction(async (tx) => {
      const id = await inserveEnsureArticle({
        id: sub.product.id,
        productCode: sub.product.productCode,
        name: sub.product.name,
        monthlyPrice: Number(sub.product.monthlyPrice),
        currency: sub.product.currency,
        btwPercentage:
          sub.product.btwPercentage != null
            ? Number(sub.product.btwPercentage)
            : null,
        isActive: sub.product.isActive,
        inserveArticleId: sub.product.inserveArticleId,
      });
      await tx.product.update({
        where: { id: sub.product.id },
        data: { inserveArticleId: id },
      });
      return id;
    });

    if (sub.status === "ACTIVE") {
      if (sub.inserveSubscriptionId) {
        warnings.push("Abonnement reeds in Inserve; prijs/periode sync is nog niet geimplementeerd.");
      } else {
        const contractId = await inserveCreateContract({
          companyId: companyResult.id,
          articleId,
          startDate: sub.startDate,
          endDate: sub.endDate,
          monthlyPrice: sub.monthlyPrice,
          billingCycle: sub.billingCycle,
          reference: `STM ${sub.subscriptionNumber}`,
          description: `Seguilo abonnement ${sub.subscriptionNumber} - ${sub.product.name} (${sub.product.productCode})`,
        });
        await prisma.$transaction(async (tx) => {
          const updated = await tx.subscription.update({
            where: { id: sub.id },
            data: {
              inserveSubscriptionId: contractId,
              inserveSyncStatus: "SYNCED",
              inserveLastSyncedAt: new Date(),
              inserveSyncError: warnings.length ? warnings.join(" | ") : null,
            },
          });
          await logAudit(tx, {
            entityType: "subscription",
            entityId: updated.id,
            action: "INSERVE_SYNCED",
            userId: ctx.userId,
            newValues: {
              inserveSubscriptionId: contractId,
              inserveCompanyId: companyResult.id,
              inserveArticleId: articleId,
              debtorCode: companyResult.debtorCode,
              warnings: warnings.length ? warnings : undefined,
            } as any,
          });
        });
        return { status: "SYNCED" };
      }
    } else if (
      (sub.status === "CANCELLED" || sub.status === "TERMINATED" || sub.status === "SUSPENDED") &&
      sub.inserveSubscriptionId
    ) {
      await inserveCancelContract(sub.inserveSubscriptionId, {
        endDate: sub.endDate ?? new Date(),
        reason: `STM ${sub.status}: ${sub.notes ?? ""}`.slice(0, 240),
      });
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          inserveSyncStatus: "SYNCED",
          inserveLastSyncedAt: new Date(),
          inserveSyncError: warnings.length ? warnings.join(" | ") : null,
        },
      });
      await logAudit(tx, {
        entityType: "subscription",
        entityId: updated.id,
        action: "INSERVE_SYNCED",
        userId: ctx.userId,
        newValues: {
          statusMapping: sub.status,
          inserveSubscriptionId: updated.inserveSubscriptionId,
          warnings: warnings.length ? warnings : undefined,
        } as any,
      });
    });

    return { status: "SYNCED", details: warnings.length ? warnings.join(" | ") : undefined };
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.subscription.update({
          where: { id: sub.id },
          data: {
            inserveSyncStatus: "FAILED",
            inserveSyncError: msg.slice(0, 20000),
            inserveLastSyncedAt: new Date(),
          },
        });
        await logAudit(tx, {
          entityType: "subscription",
          entityId: updated.id,
          action: "INSERVE_SYNC_FAILED",
          userId: ctx.userId,
          newValues: { error: msg.slice(0, 4000) } as any,
          oldValues: { statusBefore: sub.status, inserveSyncStatus: "IN_PROGRESS" } as any,
        });
      });
    } catch (logErr) {
      console.error("[Inserve-sync] Failed to write FAILED state + auditlog:", logErr);
    }
    return { status: "FAILED", error: msg };
  }
}
