import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findSubscriptionById } from "@/server/services/subscription.service";
import { SubscriptionDetail } from "../_components/subscription-detail";
import { canUserRole } from "@/lib/auth/session";
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
} from "../actions";

export default async function SubscriptionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "subscription")) {
    throw new PermissionError("Je mag geen abonnementen bekijken.");
  }

  const sub = await findSubscriptionById(params.id);
  if (!sub) notFound();

  const [customers, products, trackersStock, simsStock] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, companyName: true, customerNumber: true },
      orderBy: { companyName: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, productCode: true, name: true, monthlyPrice: true, billingCycle: true },
      orderBy: { name: "asc" },
    }),
    prisma.tracker.findMany({
      where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] as any } },
      select: { id: true, serialNumber: true, imei: true, brand: true, model: true },
      orderBy: { serialNumber: "asc" },
    }),
    prisma.sIM.findMany({
      where: { deletedAt: null, status: { in: ["IN_STOCK", "RESERVED"] as any } },
      select: { id: true, iccid: true, imsi: true, msisdn: true, provider: true },
      orderBy: { iccid: "asc" },
    }),
  ]);

  const updateAction: any = async (id: string, prev: any, f: FormData) =>
    createSubscriptionAction(prev, f);

  return (
    <SubscriptionDetail
      subscription={sub as any}
      role={session.user.role}
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      productOptions={products}
      trackerStockOptions={trackersStock.map((t) => ({
        id: t.id,
        label: `${t.serialNumber} · IMEI ${t.imei} · ${t.brand ?? ""} ${t.model ?? ""}`,
      }))}
      simStockOptions={simsStock.map((s) => ({
        id: s.id,
        label: `${s.iccid.slice(0, 8)}… · ${s.msisdn ?? "geen nummer"} · ${s.provider ?? ""}`,
      }))}
      suspendAction={suspendSubscriptionAction as any}
      resumeAction={resumeSubscriptionAction as any}
      cancelAction={cancelSubscriptionAction as any}
      terminateAction={terminateSubscriptionAction as any}
      deleteAction={deleteSubscriptionAction as any}
      updateAction={updateAction}
      unassignTrackerAction={unassignTrackerAction as any}
      unassignSimAction={unassignSimAction as any}
      replaceTrackerAction={replaceTrackerAction as any}
      replaceSimAction={replaceSimAction as any}
      subscriptionId={params.id}
    />
  );
}
