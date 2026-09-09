import { auth } from "@/auth";
import { PermissionError, can, requirePermission } from "@/lib/rbac";
export { PermissionError, requirePermission } from "@/lib/rbac";
import type {
  ResourceAction,
  ResourceType,
  UserRole,
} from "@/types/enums";

/**
 * Haal de huidige sessie gebruiker op (Server Component / Server Action context).
 * Gooit indien geen sessie: unauthorized.
 */
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user) throw new PermissionError("Je bent niet ingelogd.");
  return session.user;
}

export async function getCurrentSession() {
  return auth();
}

export async function isAuthenticated(): Promise<boolean> {
  const s = await auth();
  return Boolean(s?.user);
}

/**
 * Wrapper voor Server Actions die een permissie-check uitvoeren VOOR de actie start.
 *
 * Gebruik:
 * ```ts
 * const createCustomer = withAuth(
 *   { action: "create", resource: "customer" },
 *   async (input: CreateCustomerInput, ctx) => {
 *     // ctx.userId, ctx.userRole beschikbaar
 *   }
 * );
 * ```
 */
export function withAuth<Input extends unknown[], Output>(
  permission: { action: ResourceAction; resource: ResourceType; minRole?: UserRole },
  action: (
    ...args: [
      ...Input,
      { userId: string; userRole: UserRole; userName: string; userEmail: string }
    ]
  ) => Promise<Output> | Output
) {
  return async function wrapped(...args: Input): Promise<Output> {
    const user = await getCurrentUser();

    if (permission.minRole) {
      const order: UserRole[] = ["VIEWER", "EMPLOYEE", "ADMIN"] as UserRole[];
      if (order.indexOf(user.role) < order.indexOf(permission.minRole)) {
        throw new PermissionError(
          `Onvoldoende rechten (vereist: ${permission.minRole}).`
        );
      }
    }

    requirePermission(user.role, permission.action, permission.resource);

    const ctx = {
      userId: user.id,
      userRole: user.role,
      userName: user.name ?? "",
      userEmail: user.email ?? "",
    };
    return action(...args, ctx);
  };
}

/**
 * Hulpfunctie voor UI conditionele rendering (client side).
 * Negeert permission als de sessie nog niet geladen is.
 */
export function canUserRole(
  role: UserRole | null | undefined,
  action: ResourceAction,
  resource: ResourceType
): boolean {
  if (!role) return false;
  return can(role, action, resource);
}
