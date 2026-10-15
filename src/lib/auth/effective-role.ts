import { RoleScope, UserRole } from "@/types/enums";

const LEGACY_ROLE_SET = new Set<string>([
  UserRole.ADMIN,
  UserRole.EMPLOYEE,
  UserRole.VIEWER,
]);

const ROLE_SCOPE_SET = new Set<string>([
  RoleScope.INTERNAL,
  RoleScope.CUSTOMER,
  RoleScope.RESELLER,
  RoleScope.PARTNER,
]);

export function isLegacyRoleValue(value: unknown): value is UserRole {
  return typeof value === "string" && LEGACY_ROLE_SET.has(value);
}

export function normalizeRoleScope(value: unknown): RoleScope {
  if (typeof value === "string" && ROLE_SCOPE_SET.has(value)) {
    return value as RoleScope;
  }
  return RoleScope.INTERNAL;
}

export function fallbackLegacyRoleForScope(scope: RoleScope | string | null | undefined): UserRole {
  switch (normalizeRoleScope(scope)) {
    case RoleScope.CUSTOMER:
      return UserRole.VIEWER;
    case RoleScope.INTERNAL:
    case RoleScope.RESELLER:
    case RoleScope.PARTNER:
    default:
      return UserRole.EMPLOYEE;
  }
}

export function normalizeLegacyRole(
  role: UserRole | string | null | undefined,
  scope?: RoleScope | string | null
): UserRole {
  if (isLegacyRoleValue(role)) return role;
  return fallbackLegacyRoleForScope(scope);
}

export function resolveEffectiveLegacyRole(input: {
  assignedRole: UserRole | string | null | undefined;
  roleName?: string | null | undefined;
  roleScope?: RoleScope | string | null | undefined;
  isSystemRole?: boolean;
}): UserRole {
  const normalizedAssignedRole = normalizeLegacyRole(
    input.assignedRole,
    input.roleScope
  );

  if (input.isSystemRole && isLegacyRoleValue(input.roleName)) {
    return input.roleName;
  }

  return normalizedAssignedRole;
}
