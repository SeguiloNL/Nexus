import { auth } from "@/auth";
import { findManySims } from "@/server/services/sim.service";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { SimListWithImport } from "./_components/sim-list-with-import";
import { PermissionError } from "@/lib/rbac";

export default async function SimsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!canUserRole(session.user.permissions, "view", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten bekijken.");
  }

  const [result] = await Promise.all([
    findManySims({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
      customerScope: session.user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(session.user.permissions, "create", "sim");
  const canEdit = canUserRole(session.user.permissions, "edit", "sim");
  const canDelete = canUserRole(session.user.permissions, "delete", "sim");
  const canImport = canUserRole(session.user.permissions, "import", "sim");
  const canExport = canUserRole(session.user.permissions, "export", "sim");

  return (
    <SimListWithImport
      sims={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
    />
  );
}
