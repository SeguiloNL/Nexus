import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { findRoleById } from "@/server/services/role.service";
import { RoleEditForm } from "../_components/role-edit-form";
import type { ResourceAction, ResourceType } from "@/types/enums";

function permissionsMeaningfulLocal(bits: unknown): boolean {
  if (!bits || typeof bits !== "object") return false;
  const obj = bits as Record<string, { read?: boolean; write?: boolean }>;
  for (const k of Object.keys(obj)) {
    const e = obj[k];
    if (e && (e.read || e.write)) return true;
  }
  return false;
}

function resolveCan(
  user: {
    role?: string | null;
    permissions?: unknown;
    roleId?: string | null;
  },
  action: ResourceAction,
  resource: ResourceType
): boolean {
  if (permissionsMeaningfulLocal(user.permissions)) {
    return canUserRole(user.permissions as any, action, resource);
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
  const user = await requireUser();
  if (!resolveCan(user as any, "view", "role")) {
    redirectForbidden();
  }

  const role = await findRoleById(params.id);
  if (!role) notFound();

  const canEdit = resolveCan(user as any, "edit", "role");

  return <RoleEditForm role={role as any} canEdit={canEdit} />;
}
