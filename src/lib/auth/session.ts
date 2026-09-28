import { auth } from "@/auth";
import {
  PermissionError,
  canWithBits,
  requirePermission,
  canWithRoleId,
} from "@/lib/rbac";
import type {
  ResourceAction,
  ResourceType,
  UserRole,
  RoleScope,
} from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

export interface SessionUser {
  id: string;
  role: UserRole;
  roleId: string;
  roleScope: RoleScope;
  roleName: string;
  email: string;
  name: string;
  customerId: string | null;
  customerIds: string[];
  permissions: PermissionBits;
}

export async function getCurrentUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user) throw new PermissionError("Je bent niet ingelogd.");
  const u = session.user as unknown as Partial<SessionUser>;
  return {
    id: u.id ?? "",
    role: (u.role ?? "VIEWER") as UserRole,
    roleId: u.roleId ?? "",
    roleScope: (u.roleScope ?? "INTERNAL") as RoleScope,
    roleName: u.roleName ?? "",
    email: u.email ?? "",
    name: u.name ?? "",
    customerId: u.customerId ?? null,
    customerIds: Array.isArray(u.customerIds) ? u.customerIds : [],
    permissions: u.permissions ?? ({} as PermissionBits),
  };
}

export async function getCurrentSession() {
  return auth();
}

export async function isAuthenticated(): Promise<boolean> {
  const s = await auth();
  return Boolean(s?.user);
}

export type AuthContext = {
  userId: string;
  userRole: UserRole;
  userName: string;
  userEmail: string;
  roleId: string;
  roleScope: RoleScope;
  customerId: string | null;
  customerScope: string[];
  permissions: PermissionBits;
};

export function withAuth<Input extends unknown[], Output>(
  permission: {
    action: ResourceAction;
    resource: ResourceType;
    minRole?: UserRole;
    requireInternal?: boolean;
  },
  action: (...args: [...Input, AuthContext]) => Promise<Output> | Output
) {
  return async function wrapped(...args: Input): Promise<Output> {
    const user = await getCurrentUser();

    if (permission.requireInternal && user.roleScope !== "INTERNAL") {
      throw new PermissionError(
        "Deze functionaliteit is alleen beschikbaar voor medewerkers."
      );
    }

    if (permission.minRole) {
      const order: UserRole[] = ["VIEWER", "EMPLOYEE", "ADMIN"] as UserRole[];
      if (order.indexOf(user.role) < order.indexOf(permission.minRole)) {
        throw new PermissionError(
          `Onvoldoende rechten (vereist minimaal: ${permission.minRole}).`
        );
      }
    }

    await requirePermission(user.permissions, permission.action, permission.resource);

    const ctx: AuthContext = {
      userId: user.id,
      userRole: user.role,
      userName: user.name,
      userEmail: user.email,
      roleId: user.roleId,
      roleScope: user.roleScope,
      customerId: user.customerId,
      customerScope: user.customerIds,
      permissions: user.permissions,
    };
    return action(...args, ctx);
  };
}

export function canUserRole(
  permissionsOrRole: PermissionBits | UserRole | null | undefined,
  action: ResourceAction,
  resource: ResourceType
): boolean {
  if (!permissionsOrRole) return false;
  if (
    typeof permissionsOrRole === "object" &&
    permissionsOrRole !== null &&
    !Array.isArray(permissionsOrRole)
  ) {
    return canWithBits(permissionsOrRole as PermissionBits, action, resource);
  }
  if (typeof permissionsOrRole === "string") {
    return false;
  }
  return false;
}

export async function canUserRoleAsync(
  roleIdOrPerms: string | PermissionBits | null | undefined,
  action: ResourceAction,
  resource: ResourceType
): Promise<boolean> {
  if (typeof roleIdOrPerms === "string") {
    if (!roleIdOrPerms) return false;
    return canWithRoleId(roleIdOrPerms, action, resource);
  }
  return canWithBits(roleIdOrPerms as PermissionBits | null | undefined, action, resource);
}
