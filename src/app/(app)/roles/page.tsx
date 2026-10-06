import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManyRoles } from "@/server/services/role.service";
import { RoleList } from "./_components/role-list";
import type { ResourceAction, ResourceType, RoleScope } from "@/types/enums";
import { permissionsMeaningful as rbacPermissionsMeaningful } from "@/lib/rbac";

function permissionsMeaningfulLocal(bits: unknown): boolean {
  return rbacPermissionsMeaningful(bits as any);
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
  const user = await requireUser();
  if (!resolveCan(user as any, "view", "role")) {
    redirectForbidden();
  }

  const canCreate = resolveCan(user as any, "create", "role");
  const canEdit = resolveCan(user as any, "edit", "role");
  const canDelete = resolveCan(user as any, "delete", "role");

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
