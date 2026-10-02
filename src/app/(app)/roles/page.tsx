import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { findManyRoles } from "@/server/services/role.service";
import { RoleList } from "./_components/role-list";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import type { ResourceAction, ResourceType, RoleScope } from "@/types/enums";

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

function parseString<T extends string = string>(
  value: string | string[] | undefined | null
): T | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || undefined) as T | undefined;
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams?: {
    error?: string;
    search?: string;
    scope?: string;
    isSystem?: string;
  };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!resolveCan(session.user as any, "view", "role")) {
    throw new PermissionError("Je bent niet bevoegd rollen te bekijken.");
  }

  const canCreate = resolveCan(session.user as any, "create", "role");
  const canEdit = resolveCan(session.user as any, "edit", "role");
  const canDelete = resolveCan(session.user as any, "delete", "role");

  const filters = {
    search: parseString(searchParams?.search),
    scope: parseString<RoleScope>(searchParams?.scope),
    isSystem:
      searchParams?.isSystem === "true"
        ? true
        : searchParams?.isSystem === "false"
          ? false
          : undefined,
  };

  const result = await findManyRoles();

  return (
    <RoleList
      roles={result as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      errorMessage={searchParams?.error ?? null}
      filters={filters}
    />
  );
}
