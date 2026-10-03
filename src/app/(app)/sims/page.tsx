import { requireUser, canUserRole } from "@/lib/auth/session";
import { findManySims } from "@/server/services/sim.service";
import { redirect } from "next/navigation";
import { SimListWithImport } from "./_components/sim-list-with-import";
import { PermissionError } from "@/lib/rbac";

export default async function SimsPage() {
  const user = await requireUser();

  if (!canUserRole(user.permissions, "view", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten bekijken.");
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
  const canSyncUsage = canUserRole(user.permissions, "view", "sim");

  return (
    <SimListWithImport
      sims={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
      canSyncUsage={canSyncUsage}
    />
  );
}
