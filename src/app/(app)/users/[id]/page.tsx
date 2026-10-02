import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findUserDetailById } from "@/server/services/user.service";
import { findManyCustomers } from "@/server/services/customer.service";
import { findManyRoles } from "@/server/services/role.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { UserDetailTabs } from "../_components/user-detail-tabs";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { RoleScope } from "@/types/enums";
import type { UserDetail, UserCustomerLink } from "@/types/domain";

export default async function UserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "user")) {
    throw new PermissionError("Je mag geen gebruikers bekijken.");
  }

  const ctx = {
    userId: session.user.id,
    userRole: session.user.role,
    roleId: session.user.roleId,
    roleScope: session.user.roleScope,
    permissions: session.user.permissions,
    customerScope: session.user.customerIds,
  };

  const [userResult, rolesResult, customersResult, auditResult] =
    await Promise.all([
      findUserDetailById(params.id, ctx),
      findManyRoles().catch(() => [] as any),
      findManyCustomers({
        page: 1,
        perPage: 1000,
        viewerRole: session.user.role,
        customerScope: session.user.customerIds ?? undefined,
      }).catch(() => ({ data: [] as any[] })),
      findManyAuditLogs(
        {
          entityType: "user",
          perPage: 50,
          order: "desc",
          viewerUserId: session.user.id,
          viewerRole: session.user.role,
        },
        {
          userRole: session.user.role,
          roleId: session.user.roleId,
          roleScope: session.user.roleScope as any,
          customerScope: session.user.customerIds,
          permissions: session.user.permissions,
        }
      )
        .then((r) =>
          r.data.map((log: any) => ({
            id: log.id,
            timestamp: log.timestamp,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            oldValues: log.oldValues,
            newValues: log.newValues,
            metadata: log.metadata,
            user: log.user
              ? { name: log.user.name, email: log.user.email }
              : null,
          }))
        )
        .catch(() => [] as any[]),
    ]);

  if (!userResult) notFound();

  return (
    <UserDetailTabs
      user={userResult as any}
      customers={customersResult.data as any[]}
      roles={rolesResult as any[]}
      auditLogs={auditResult as any[]}
    />
  );
}
