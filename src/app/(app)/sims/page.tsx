import { auth } from "@/auth";
import { findManySims } from "@/server/services/sim.service";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { SimListWithImport } from "./_components/sim-list-with-import";

export default async function SimsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [result] = await Promise.all([
    findManySims({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
    }),
  ]);

  const canCreate = canUserRole(session.user.role, "create", "sim");
  const canEdit = canUserRole(session.user.role, "edit", "sim");
  const canDelete = canUserRole(session.user.role, "delete", "sim");
  const canImport = canUserRole(session.user.role, "import", "sim");

  return (
    <SimListWithImport
      sims={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
    />
  );
}
