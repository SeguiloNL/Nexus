import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { findSimById } from "@/server/services/sim.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { SimDetail } from "../_components/sim-detail";
import { hasMinRole } from "@/lib/rbac";
import {
  deleteSimAction,
  updateSimAction,
  syncUsageForSingleSimAction,
  suspendSimAction,
  unsuspendSimAction,
  refreshSimStatusAction,
} from "../actions";
import { RoleScope, UserRole } from "@/types/enums";

export default async function SimDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "sim")) {
    redirectForbidden();
  }

  const [sim, auditResult] = await Promise.all([
    findSimById(params.id, user.customerIds),
    findManyAuditLogs({
      entityType: "sim",
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
  ]);
  if (!sim) notFound();

  const isAdmin =
    user.roleScope === RoleScope.INTERNAL &&
    hasMinRole(user.role, UserRole.ADMIN);

  const canEdit = canUserRole(user.permissions, "edit", "sim");
  const canDelete = canUserRole(user.permissions, "delete", "sim");
  const canSyncUsage = isAdmin;

  return (
    <SimDetail
      sim={sim as any}
      role={user.role}
      updateAction={updateSimAction}
      deleteAction={deleteSimAction}
      simId={params.id}
      auditLogs={auditResult as any}
      syncUsageAction={syncUsageForSingleSimAction}
      suspendAction={isAdmin ? suspendSimAction : undefined}
      unsuspendAction={isAdmin ? unsuspendSimAction : undefined}
      refreshStatusAction={canEdit ? refreshSimStatusAction : undefined}
      isAdmin={isAdmin}
      canEdit={canEdit}
      canDelete={canDelete}
      canSyncUsage={canSyncUsage}
    />
  );
}
