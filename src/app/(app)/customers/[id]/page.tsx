import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import {
  findCustomerById,
  listParentCustomers,
} from "@/server/services/customer.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { CustomerDetail } from "../_components/customer-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import {
  deleteCustomerAction,
  updateCustomerAction,
} from "../actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "customer")) {
    throw new PermissionError("Je mag geen klanten bekijken.");
  }

  const [customer, parentOptions, auditResult] = await Promise.all([
    findCustomerById(params.id),
    listParentCustomers(),
    findManyAuditLogs({
      entityType: "customer",
      perPage: 50,
      order: "desc",
      viewerUserId: session.user.id,
      viewerRole: session.user.role,
    }).then((r) =>
      Promise.all(
        r.data.map(async (log: any) => {
          const u = log.user
            ? { name: log.user.name, email: log.user.email }
            : null;
          return {
            id: log.id,
            timestamp: log.timestamp,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            oldValues: log.oldValues,
            newValues: log.newValues,
            user: u,
          };
        })
      )
    ),
  ]);

  if (!customer) notFound();

  return (
    <CustomerDetail
      customer={customer as any}
      parentOptions={parentOptions}
      role={session.user.role}
      updateAction={updateCustomerAction}
      deleteAction={deleteCustomerAction}
      customerId={params.id}
      auditLogs={auditResult as any}
    />
  );
}
