import { Suspense } from "react";
import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManySims } from "@/server/services/sim.service";
import { SimListWithImport } from "./_components/sim-list-with-import";
import { hasMinRole } from "@/lib/rbac";
import { RoleScope, UserRole } from "@/types/enums";

export default async function SimsPage() {
  const user = await requireUser();

  if (!canUserRole(user.permissions, "view", "sim")) {
    redirectForbidden();
  }

  const [result] = await Promise.all([
    findManySims({
      page: 1,
      perPage: 500,
      viewerRole: user.role,
      customerScope: user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(user.permissions, "create", "sim");
  const canEdit = canUserRole(user.permissions, "edit", "sim");
  const canDelete = canUserRole(user.permissions, "delete", "sim");
  const canImport = canUserRole(user.permissions, "import", "sim");
  const canExport = canUserRole(user.permissions, "export", "sim");
  const canSyncUsage =
    user.roleScope === RoleScope.INTERNAL &&
    hasMinRole(user.role, UserRole.ADMIN);

  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Laden…</div>}>
      <SimListWithImport
        sims={result.data as any}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canImport={canImport}
        canExport={canExport}
        canSyncUsage={canSyncUsage}
      />
    </Suspense>
  );
}
