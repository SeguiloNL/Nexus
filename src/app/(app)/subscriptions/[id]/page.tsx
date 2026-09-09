import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import {
  findSubscriptionById,
  getSubscriptionHistoryAssignments,
} from "@/server/services/subscription.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { listCustomerOptions } from "@/server/services/customer.service";
import { listProductOptions } from "@/server/services/product.service";
import { listAssignableTrackers } from "@/server/services/tracker.service";
import { listAssignableSims } from "@/server/services/sim.service";
import { listVehicleOptions } from "@/server/services/vehicle.service";
import { SubscriptionDetail } from "../_components/subscription-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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

  const [
    subscription,
    history,
    auditResult,
    customerOptions,
    productOptions,
    availableTrackers,
    availableSims,
  ] = await Promise.all([
    findSubscriptionById(params.id),
    getSubscriptionHistoryAssignments(params.id),
    findManyAuditLogs({
      page: 1,
      perPage: 500,
      entityType: "subscription",
      fromDate: undefined,
    }),
    listCustomerOptions(),
    listProductOptions(),
    listAssignableTrackers(),
    listAssignableSims(),
  ]);

  if (!subscription) notFound();

  const vehicleOptions = subscription.customerId
    ? await listVehicleOptions(subscription.customerId)
    : [];

  const auditLogs = (auditResult.data as any[]).map((l) => ({
    id: l.id,
    timestamp: l.timestamp,
    action: l.action,
    user: l.user
      ? { name: l.user.name, email: l.user.email }
      : null,
    oldValues: l.oldValues as Record<string, unknown> | null,
    newValues: l.newValues as Record<string, unknown> | null,
    metadata: l.metadata as Record<string, unknown> | null,
  }));

  return (
    <SubscriptionDetail
      subscription={subscription as any}
      history={history as any}
      auditLogs={auditLogs}
      customerOptions={customerOptions}
      productOptions={productOptions}
      availableTrackers={availableTrackers}
      availableSims={availableSims}
      availableVehicles={vehicleOptions}
      role={session.user.role}
      subscriptionId={params.id}
    />
  );
}
