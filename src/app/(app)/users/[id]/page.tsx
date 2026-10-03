import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { findUserDetailById } from "@/server/services/user.service";
import { findManyCustomers } from "@/server/services/customer.service";
import { findManyRoles } from "@/server/services/role.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { UserDetailTabs } from "../_components/user-detail-tabs";
import { RoleScope } from "@/types/enums";
import type { UserDetail, UserCustomerLink } from "@/types/domain";

export default async function UserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "user")) {
    redirectForbidden();
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    permissions: user.permissions,
    customerScope: user.customerIds,
  };

  const [userResult, rolesResult, customersResult, auditResult] =
    await Promise.all([
      findUserDetailById(params.id, ctx),
      findManyRoles().catch(() => [] as any),
      findManyCustomers({
        page: 1,
        perPage: 1000,
        viewerRole: user.role,
        customerScope: user.customerIds ?? undefined,
      }).catch(() => ({ data: [] as any[] })),
      findManyAuditLogs(
        {
          entityType: "user",
          perPage: 50,
          order: "desc",
          viewerUserId: user.id,
          viewerRole: user.role,
        },
        {
          userRole: user.role,
          roleId: user.roleId,
          roleScope: user.roleScope as any,
          customerScope: user.customerIds,
          permissions: user.permissions,
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
