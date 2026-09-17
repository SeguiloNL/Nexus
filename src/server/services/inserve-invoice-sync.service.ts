import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import {
  upsertCompany as inserveUpsertCompany,
  ensureArticle as inserveEnsureArticle,
  createInvoiceDraftInInserve,
  updateInvoiceInInserve,
} from "../integrations/inserve/service";
import type { CreateInvoiceRequest } from "../integrations/inserve/types";
import { inserveClient } from "../integrations/inserve/client";
import type { UserRole } from "@/types/enums";
import type { Prisma, Invoice as PrismaInvoice } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

type InvoiceWithJoins = Prisma.PrismaPromise<
  PrismaInvoice & {
    subscription: {
      id: string;
      subscriptionNumber: string;
      startDate: Date;
      endDate: Date | null;
      monthlyPrice: Prisma.Decimal;
      billingCycle: string;
      periodStart: Date;
      periodEnd: Date;
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
    };
  }
>;

function findFullInvoice(id: string) {
  return prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: {
      subscription: {
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
      },
    },
  }) as unknown as InvoiceWithJoins extends infer P ? Promise<Awaited<P>> : never;
}

function toISODate(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SYNCABLE_INVOICE_STATUSES = new Set<string>([
  "DRAFT",
  "SENT",
  "OVERDUE",
]);

export async function syncInvoiceToInserve(
  invoiceId: string,
  ctx: Ctx
): Promise<{ status: "SYNCED" | "SKIPPED" | "FAILED"; error?: string; details?: string; inserveInvoiceId?: number; invoice?: Awaited<ReturnType<typeof findFullInvoice>> }> {
  if (!(await inserveClient.isConfigured())) {
    return {
      status: "SKIPPED",
      details: "Inserve is niet geconfigureerd (stel in via Instellingen of INSERVE_SUBDOMAIN + INSERVE_API_KEY).",
    };
  }

  let invoice: Awaited<ReturnType<typeof findFullInvoice>>;
  try {
    invoice = await findFullInvoice(invoiceId);
  } catch (e) {
    return { status: "FAILED", error: `Factuur niet gevonden: ${e}` };
  }

  if (!invoice.subscription) {
    return { status: "SKIPPED", details: "Factuur heeft geen gerelateerd abonnement." };
  }

  if (!SYNCABLE_INVOICE_STATUSES.has(invoice.status)) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { inserveSyncStatus: "SKIPPED", inserveSyncError: null },
    });
    return { status: "SKIPPED", details: `Status ${invoice.status} wordt niet gesynchroniseerd.` };
  }

  let warnings: string[] = [];

  try {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        inserveSyncStatus: "IN_PROGRESS",
        inserveSyncError: null,
      },
    });

    const sub = invoice.subscription;
    const customer = sub.customer;
    const product = sub.product;

    let inserveCompanyId: number = customer.inserveCompanyId ?? 0;
    if (!inserveCompanyId) {
      const companyResult = await prisma.$transaction(async (tx) => {
        const company = await inserveUpsertCompany({
          id: customer.id,
          customerNumber: customer.customerNumber,
          companyName: customer.companyName,
          address: customer.address,
          postalCode: customer.postalCode,
          city: customer.city,
          country: customer.country,
          contactPerson: customer.contactPerson,
          phone: customer.phone,
          email: customer.email,
          kvkNr: customer.kvkNr,
          btwNr: customer.btwNr,
          inserveCompanyId: customer.inserveCompanyId,
        });

        if (!customer.kvkNr) warnings.push("Klant heeft geen KvK-nummer.");
        if (!customer.btwNr) warnings.push("Klant heeft geen BTW-nummer.");
        if (!customer.address || !customer.postalCode || !customer.city) {
          warnings.push("Klant adresgegevens zijn incompleet.");
        }

        await tx.customer.update({
          where: { id: customer.id },
          data: { inserveCompanyId: company.id },
        });

        return company;
      });
      inserveCompanyId = companyResult.id;
    }

    let inserveArticleId: number = product.inserveArticleId ?? 0;
    if (!inserveArticleId) {
      inserveArticleId = await prisma.$transaction(async (tx) => {
        const id = await inserveEnsureArticle({
          id: product.id,
          productCode: product.productCode,
          name: product.name,
          monthlyPrice: Number(product.monthlyPrice),
          currency: product.currency,
          btwPercentage: product.btwPercentage != null ? Number(product.btwPercentage) : null,
          isActive: product.isActive,
          inserveArticleId: product.inserveArticleId,
        });
        await tx.product.update({
          where: { id: product.id },
          data: { inserveArticleId: id },
        });
        return id;
      });
    }

    const periodStartStr = toISODate(sub.periodStart);
    const periodEndStr = toISODate(sub.periodEnd);
    const lineDescription = `Periode ${periodStartStr} t/m ${periodEndStr} · ${sub.subscriptionNumber} · ${product.name}`;

    const payload: CreateInvoiceRequest = {
      company_id: inserveCompanyId,
      debtor_code: customer.customerNumber,
      date: toISODate(invoice.issueDate)!,
      due_date: toISODate(invoice.dueDate),
      reference: invoice.invoiceNumber,
      description: `STM factuur ${invoice.invoiceNumber} - ${sub.subscriptionNumber}`,
      status: "draft",
      lines: [
        {
          article_id: inserveArticleId,
          description: lineDescription,
          quantity: 1,
          price: Number(sub.monthlyPrice),
          btw_percentage: Number(product.btwPercentage ?? 21),
        },
      ],
    };

    let inserveInvoiceIdResult: number;

    if (invoice.inserveInvoiceId) {
      try {
        const updated = await updateInvoiceInInserve(invoice.inserveInvoiceId, payload);
        inserveInvoiceIdResult = updated.id;
        warnings.push("Bestaande Inserve-factuur bijgewerkt.");
      } catch (err) {
        const created = await createInvoiceDraftInInserve(payload);
        inserveInvoiceIdResult = created.id;
        warnings.push("Bestaande Inserve-factuur niet gevonden; nieuwe draft aangemaakt.");
      }
    } else {
      const created = await createInvoiceDraftInInserve(payload);
      inserveInvoiceIdResult = created.id;
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          inserveInvoiceId: inserveInvoiceIdResult,
          inserveSyncStatus: "SYNCED",
          sentToInserveAt: new Date(),
          inserveSyncError: warnings.length ? warnings.join(" | ") : null,
        },
      });
      await logAudit(tx, {
        entityType: "invoice",
        entityId: updated.id,
        action: "INSERVE_SYNCED",
        userId: ctx.userId,
        newValues: {
          inserveInvoiceId: inserveInvoiceIdResult,
          inserveCompanyId,
          inserveArticleId,
          invoiceNumber: updated.invoiceNumber,
          warnings: warnings.length ? warnings : undefined,
        } as any,
      });
    });

    return { status: "SYNCED", inserveInvoiceId: inserveInvoiceIdResult, details: warnings.length ? warnings.join(" | ") : undefined };
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            inserveSyncStatus: "FAILED",
            inserveSyncError: msg.slice(0, 2000),
          },
        });
        await logAudit(tx, {
          entityType: "invoice",
          entityId: updated.id,
          action: "INSERVE_SYNC_FAILED",
          userId: ctx.userId,
          newValues: { error: msg.slice(0, 4000) } as any,
          oldValues: { statusBefore: invoice.status, inserveSyncStatus: "IN_PROGRESS" } as any,
        });
      });
    } catch (logErr) {
      console.error("[Inserve-invoice-sync] Failed to write FAILED state + auditlog:", logErr);
    }
    return { status: "FAILED", error: msg };
  }
}
