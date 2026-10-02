import { requireUser, canUserRole } from "@/lib/auth/session";
import { notFound, redirect } from "next/navigation";
import { findSubscriptionById } from "@/server/services/subscription.service";
import { findInvoicesBySubscriptionId } from "@/server/services/invoice.service";
import { SubscriptionDetail } from "../_components/subscription-detail";
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  suspendSubscriptionAction,
  resumeSubscriptionAction,
  cancelSubscriptionAction,
  terminateSubscriptionAction,
  deleteSubscriptionAction,
  createSubscriptionAction,
  unassignTrackerAction,
  unassignSimAction,
  replaceTrackerAction,
  replaceSimAction,
  markInvoicePaidAction,
  deleteInvoiceAction,
  hardDeleteInvoiceAction,
  updateInvoiceStatusAction,
  sendInvoiceAction,
} from "../actions";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen bekijken.");
  }

  const raw = await findSubscriptionById(params.id, user.customerIds);
  if (!raw) notFound();

  const subscription: any = {
    ...raw,
    monthlyPrice: Number(raw.monthlyPrice),
  };

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;
  const customerScopeCustomer: any = hasScope ? { id: { in: customerIds } } : undefined;
  const customerScopeAssignment: any = hasScope
    ? { assignments: { some: { subscription: { customerId: { in: customerIds } } } } }
    : undefined;

  const [customers, products, trackersStock, simsStock, invoices] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, ...customerScopeCustomer },
      select: { id: true, companyName: true, customerNumber: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, productCode: true, name: true, monthlyPrice: true },
      orderBy: { name: "asc" },
    }),
    prisma.tracker.findMany({
      where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] as any }, ...customerScopeAssignment },
      select: { id: true, serialNumber: true, imei: true, brand: true, model: true },
      orderBy: { serialNumber: "asc" },
    }),
    prisma.sIM.findMany({
      where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] as any }, ...customerScopeAssignment },
      select: { id: true, iccid: true, imsi: true, msisdn: true, provider: true },
      orderBy: { iccid: "asc" },
    }),
    canUserRole(user.permissions, "view", "invoice")
      ? findInvoicesBySubscriptionId(params.id, {
          userId: user.id,
          userRole: user.role,
          customerScope: user.customerIds,
        })
      : Promise.resolve([]),
  ]);

  return (
    <SubscriptionDetail
      subscription={subscription}
      role={user.role}
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      productOptions={products.map((p) => ({
        id: p.id,
        label: `${p.name} (${p.productCode} · €${Number(p.monthlyPrice)}/mnd)`,
        defaultMonthlyPrice: String(Number(p.monthlyPrice)),
        billingCycle: "MONTHLY",
      }))}
      trackerStockOptions={trackersStock.map((t) => ({
        id: t.id,
        label: `${t.serialNumber} · IMEI ${t.imei} · ${t.brand ?? ""} ${t.model ?? ""}`,
      }))}
      simStockOptions={simsStock.map((s) => ({
        id: s.id,
        label: `${s.iccid.slice(0, 8)}… · ${s.msisdn ?? "geen nummer"} · ${s.provider ?? ""}`,
      }))}
      invoices={invoices as any[]}
      suspendAction={suspendSubscriptionAction as any}
      resumeAction={resumeSubscriptionAction as any}
      cancelAction={cancelSubscriptionAction as any}
      terminateAction={terminateSubscriptionAction as any}
      deleteAction={deleteSubscriptionAction as any}
      updateAction={createSubscriptionAction as any}
      unassignTrackerAction={unassignTrackerAction as any}
      unassignSimAction={unassignSimAction as any}
      replaceTrackerAction={replaceTrackerAction as any}
      replaceSimAction={replaceSimAction as any}
      markInvoicePaidAction={markInvoicePaidAction as any}
      deleteInvoiceAction={deleteInvoiceAction as any}
      hardDeleteInvoiceAction={hardDeleteInvoiceAction as any}
      updateInvoiceStatusAction={updateInvoiceStatusAction as any}
      sendInvoiceAction={sendInvoiceAction as any}
      subscriptionId={params.id}
    />
  );
}
