import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findRoleById } from "@/server/services/role.service";
import { RoleEditForm } from "../_components/role-edit-form";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";

export default async function RoleEditPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role ?? null, "view", "role")) {
    throw new PermissionError("Je bent niet bevoegd rollen te bewerken.");
  }

  const role = await findRoleById(params.id);
  if (!role) notFound();

  const canEdit = canUserRole(session.user.role ?? null, "edit", "role");

  return <RoleEditForm role={role as any} canEdit={canEdit} />;
}
