#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*?)"?\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const DEFAULT_VAT_RATE = 21;
const DEFAULT_NET_TERMS_DAYS = 14;

function getMonthBounds(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function nextInvoiceNumber(tx) {
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;
  const last = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  let next = 1;
  if (last) {
    const num = parseInt(last.invoiceNumber.slice(prefix.length), 10);
    if (!Number.isNaN(num)) next = num + 1;
  }
  return `${prefix}${String(next).padStart(6, "0")}`;
}

async function generateMonthly(year, month, userId) {
  const { start: periodStart, end: periodEnd } = getMonthBounds(year, month);
  return prisma.$transaction(async (tx) => {
    const subscriptions = await tx.subscription.findMany({
      where: {
        deletedAt: null,
        status: { in: ["ACTIVE", "SUSPENDED"] },
        AND: [
          { startDate: { lte: periodEnd } },
          { OR: [{ endDate: null }, { endDate: { gte: periodStart } }] },
        ],
      },
      include: { product: { select: { btwPercentage: true } } },
    });

    const created = [];
    let skipped = 0;

    for (const sub of subscriptions) {
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
        skipped++;
        continue;
      }
      const subtotal = +Number(sub.monthlyPrice).toFixed(2);
      const vatRate = Number(sub.product?.btwPercentage ?? DEFAULT_VAT_RATE);
      const vatAmount = +(subtotal * (vatRate / 100)).toFixed(2);
      const total = +(subtotal + vatAmount).toFixed(2);
      const invoiceNumber = await nextInvoiceNumber(tx);
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          periodStart,
          periodEnd,
          issueDate: periodStart,
          dueDate: addDays(periodStart, DEFAULT_NET_TERMS_DAYS),
          subtotal,
          vatRate,
          vatAmount,
          total,
          status: "DRAFT",
          note: `Automatisch gegenereerd op ${new Date().toISOString().slice(0, 10)} obv ${sub.billingCycle} abonnement.`,
        },
      });
      created.push(inv);
      await tx.auditLog.create({
        data: {
          entityType: "invoice",
          entityId: inv.id,
          action: "CREATE",
          userId,
          oldValues: null,
          newValues: inv,
          metadata: null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        entityType: "subscription",
        entityId: `BATCH-${year}-${String(month).padStart(2, "0")}`,
        action: "GENERATE_INVOICES",
        userId,
        newValues: {
          periodStart: periodStart.toISOString().slice(0, 10),
          periodEnd: periodEnd.toISOString().slice(0, 10),
          subscriptionsInScope: subscriptions.length,
          created: created.length,
          skipped,
        },
      },
    });

    return { periodStart, periodEnd, scope: subscriptions.length, created: created.length, skipped, invoices: created };
  });
}

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@nexus.local" },
    select: { id: true },
  });
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;

  const now = new Date();
  const m0 = now.getMonth() + 1;
  const y0 = now.getFullYear();
  const currentMonth = await generateMonthly(y0, m0, admin.id);
  console.log(
    `[${y0}-${String(m0).padStart(2, "0")}] scope=${currentMonth.scope} created=${currentMonth.created} skipped=${currentMonth.skipped}`
  );

  const prevDate1 = new Date(y0, m0 - 2, 1);
  const y1 = prevDate1.getFullYear();
  const m1 = prevDate1.getMonth() + 1;
  const monthBack1 = await generateMonthly(y1, m1, admin.id);
  console.log(
    `[${y1}-${String(m1).padStart(2, "0")}] scope=${monthBack1.scope} created=${monthBack1.created} skipped=${monthBack1.skipped}`
  );

  const prevDate2 = new Date(y0, m0 - 3, 1);
  const y2 = prevDate2.getFullYear();
  const m2 = prevDate2.getMonth() + 1;
  const monthBack2 = await generateMonthly(y2, m2, admin.id);
  console.log(
    `[${y2}-${String(m2).padStart(2, "0")}] scope=${monthBack2.scope} created=${monthBack2.created} skipped=${monthBack2.skipped}`
  );

  const toUpdate = [...monthBack1.invoices, ...monthBack2.invoices].sort((a, b) => a.id.localeCompare(b.id));
  const prevSorted = toUpdate.length ? toUpdate : [...currentMonth.invoices].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < prevSorted.length; i++) {
    const inv = prevSorted[i];
    if (i % 3 === 0) {
      const sent = new Date(inv.issueDate);
      sent.setDate(sent.getDate() + 1);
      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id: inv.id }, data: { status: "SENT", sentAt: sent } });
        await tx.auditLog.create({
          data: {
            entityType: "invoice",
            entityId: inv.id,
            action: "SEND_INVOICE",
            userId: admin.id,
            oldValues: { status: "DRAFT", sentAt: null },
            newValues: { status: "SENT", sentAt: sent.toISOString() },
            metadata: { sentAt: sent.toISOString() },
            timestamp: sent,
          },
        });
      });
    } else if (i % 3 === 1) {
      const paid = new Date(inv.issueDate);
      paid.setDate(paid.getDate() + 4);
      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: paid } });
        await tx.auditLog.create({
          data: {
            entityType: "invoice",
            entityId: inv.id,
            action: "MARK_INVOICE_PAID",
            userId: admin.id,
            oldValues: { status: "DRAFT", paidAt: null },
            newValues: { status: "PAID", paidAt: paid.toISOString() },
            metadata: null,
            timestamp: paid,
          },
        });
      });
    }
  }

  const total = await prisma.invoice.aggregate({
    _count: true,
    _sum: { subtotal: true, vatAmount: true, total: true },
  });
  const perStatus = await prisma.invoice.groupBy({
    by: ["status"],
    _count: true,
    orderBy: { status: "asc" },
  });
  console.log("\n=== TOTAAL ===");
  console.log("Aantal facturen:", total._count);
  console.log(
    "Bedragen: sub €",
    total._sum.subtotal?.toFixed(2) ?? "0.00",
    "| btw €",
    total._sum.vatAmount?.toFixed(2) ?? "0.00",
    "| totaal €",
    total._sum.total?.toFixed(2) ?? "0.00"
  );
  console.log("Per status:", perStatus.map((s) => `${s.status}=${s._count}`).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
