import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findRoleById } from "@/server/services/role.service";
import { RoleEditForm } from "../_components/role-edit-form";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import type { ResourceAction, ResourceType } from "@/types/enums";

function resolveCan(
  user: {
    role?: string | null;
    permissions?: unknown;
    roleId?: string | null;
  },
  action: ResourceAction,
  resource: ResourceType
): boolean {
  if (
    user.permissions &&
    canUserRole(user.permissions as any, action, resource)
  ) {
    return true;
  }
  if (user.roleId && canUserRole(user.roleId, action, resource)) {
    return true;
  }
  return canUserRole(user.role ?? null, action, resource);
}

export default async function RoleEditPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!resolveCan(session.user as any, "view", "role")) {
    throw new PermissionError("Je bent niet bevoegd rollen te bewerken.");
  }

  const role = await findRoleById(params.id);
  if (!role) notFound();

  const canEdit = resolveCan(session.user as any, "edit", "role");

  return <RoleEditForm role={role as any} canEdit={canEdit} />;
}
