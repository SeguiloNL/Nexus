import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyRoles } from "@/server/services/role.service";
import { RoleList } from "./_components/role-list";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";

export default async function RolesPage({
  searchParams,
}: {
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role ?? null, "view", "role")) {
    throw new PermissionError("Je bent niet bevoegd rollen te bekijken.");
  }

  const canCreate = canUserRole(session.user.role ?? null, "create", "role");
  const canEdit = canUserRole(session.user.role ?? null, "edit", "role");
  const canDelete = canUserRole(session.user.role ?? null, "delete", "role");

  const result = await findManyRoles();

  return (
    <RoleList
      roles={result as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      errorMessage={searchParams?.error ?? null}
    />
  );
}
