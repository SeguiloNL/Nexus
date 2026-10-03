import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import {
  findCustomerById,
  findUsersForCustomer,
  listParentCustomers,
} from "@/server/services/customer.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { CustomerDetail } from "../_components/customer-detail";
import {
  deleteCustomerAction,
  updateCustomerAction,
} from "../actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "customer")) {
    redirectForbidden();
  }

  const ctx = { customerScope: user.customerIds };

  const [customer, parentOptions, auditResult, users] = await Promise.all([
    findCustomerById(params.id, user.customerIds),
    listParentCustomers(user.customerIds),
    findManyAuditLogs({
      entityType: "customer",
      perPage: 50,
      order: "desc",
      viewerUserId: user.id,
      viewerRole: user.role,
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
    findUsersForCustomer(params.id, ctx),
  ]);

  if (!customer) notFound();

  return (
    <CustomerDetail
      customer={customer as any}
      parentOptions={parentOptions}
      role={user.role}
      updateAction={updateCustomerAction}
      deleteAction={deleteCustomerAction}
      customerId={params.id}
      auditLogs={auditResult as any}
      users={users as any}
    />
  );
}
