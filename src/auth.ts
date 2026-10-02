import NextAuth, { type NextAuthConfig, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { LoginSchema } from "@/server/validators/user";
import {
  UserRole as UserRoleEnum,
  RoleScope,
  CustomerType,
} from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";
import {
  emptyPermissionBits,
  buildLegacyPermissionsForRole,
  collectUserCustomerIds,
  permissionsMeaningful,
} from "@/lib/rbac";

type LegacyRoleName = "ADMIN" | "EMPLOYEE" | "VIEWER";

const CUSTOMER_SCOPE_REFRESH_MS = 60 * 1000;

async function resolveRoleForUser(
  user: {
    id: string;
    roleId: string | null;
    role: LegacyRoleName;
    customerId: string | null;
  }
): Promise<{
  roleId: string;
  roleScope: RoleScope;
  roleName: string;
  permissions: PermissionBits;
}> {
  const legacyRole: UserRoleEnum =
    (user.role as UserRoleEnum) ?? UserRoleEnum.VIEWER;

  const legacyRoleValues: string[] = ["ADMIN", "EMPLOYEE", "VIEWER"];
  const hasDynamicRoleId =
    typeof user.roleId === "string" &&
    user.roleId.length > 0 &&
    !legacyRoleValues.includes(user.roleId);

  if (hasDynamicRoleId) {
    try {
      const [dbRole, permissionsService] = await Promise.all([
        prisma.role.findUnique({
          where: { id: user.roleId! },
          select: {
            id: true,
            name: true,
            scope: true,
            isSystem: true,
          },
        }),
        import("@/server/services/role.service").then(
          (m) => m.getPermissionsByRoleId
        ),
      ]);

      if (dbRole) {
        const loadedPermissions = await permissionsService(user.roleId!);

        const isLegacySystemRole =
          dbRole.isSystem ||
          legacyRoleValues.includes(dbRole.name);

        const effectivePermissions =
          isLegacySystemRole || !permissionsMeaningful(loadedPermissions)
            ? buildLegacyPermissionsForRole(
                legacyRole,
                (dbRole.scope as RoleScope) ?? RoleScope.INTERNAL
              )
            : loadedPermissions;

        const effectiveScope =
          (dbRole.scope as RoleScope) ?? RoleScope.INTERNAL;

        const effectiveRoleName =
          isLegacySystemRole && legacyRoleValues.includes(dbRole.name)
            ? dbRole.name
            : dbRole.name || legacyRole;

        return {
          roleId: dbRole.id,
          roleScope: effectiveScope,
          roleName: effectiveRoleName,
          permissions: effectivePermissions,
        };
      }
    } catch (_e) {
      /* fallthrough naar legacy fallback indien dbRole niet gevonden */
    }
  }

  let scope = RoleScope.INTERNAL;

  if (user.customerId) {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: user.customerId },
        select: { type: true },
      });
      if (customer) {
        switch (customer.type) {
          case CustomerType.RESELLER:
            scope = RoleScope.RESELLER;
            break;
          case CustomerType.PARTNER:
            scope = RoleScope.PARTNER;
            break;
          case CustomerType.DIRECT:
          default:
            scope = RoleScope.CUSTOMER;
            break;
        }
      } else {
        scope = RoleScope.CUSTOMER;
      }
    } catch (_e) {
      scope = RoleScope.CUSTOMER;
    }
  }

  const permissions = buildLegacyPermissionsForRole(legacyRole, scope);

  let roleId = user.roleId ?? "";
  let roleName = legacyRole as string;

  if (!roleId) {
    try {
      const fallback = await prisma.role.findUnique({
        where: {
          name_scope: { name: legacyRole as string, scope: scope as any },
        },
        select: { id: true },
      });
      if (fallback) {
        roleId = fallback.id;
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { roleId: fallback.id },
          });
        } catch (_e) {
          /* noop – alleen voor sessie-duur */
        }
      }
    } catch (_e) {
      /* role tabel mogelijk niet beschikbaar – gebruik legacy fallback */
    }
  }

  return {
    roleId,
    roleScope: scope,
    roleName,
    permissions,
  };
}

async function resolveCustomerScope(
  userId: string,
  customerId: string | null
): Promise<{ customerId: string | null; customerIds: string[] }> {
  try {
    const ids = await collectUserCustomerIds(userId, { force: true });
    return { customerId, customerIds: ids };
  } catch (_e) {
    if (!customerId) return { customerId: null, customerIds: [] };
    return { customerId, customerIds: [customerId] };
  }
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Wachtwoord", type: "password" },
      },
      async authorize(credentials) {
        const validated = LoginSchema.safeParse(credentials);
        if (!validated.success) return null;

        const { email, password } = validated.data;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            role: true,
            roleId: true,
            customerId: true,
            isActive: true,
          },
        });
        if (!user || !user.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        if (user.isActive === false) {
          return null;
        }

        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });
        } catch (_e) {
          /* noop */
        }

        const roleInfo = await resolveRoleForUser({
          id: user.id,
          roleId: user.roleId,
          role: user.role as LegacyRoleName,
          customerId: user.customerId,
        });
        const customerInfo = await resolveCustomerScope(user.id, user.customerId);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          role: user.role as unknown as UserRoleEnum,
          roleId: roleInfo.roleId,
          roleScope: roleInfo.roleScope,
          roleName: roleInfo.roleName,
          customerId: customerInfo.customerId,
          customerIds: customerInfo.customerIds,
          permissions: roleInfo.permissions,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as any;
        token.id = u.id ?? "";
        token.email = u.email ?? "";
        token.name = u.name ?? "";
        token.role = u.role ?? "VIEWER";
        token.roleId = u.roleId ?? "";
        token.roleScope = u.roleScope ?? "INTERNAL";
        token.roleName = u.roleName ?? "";
        token.isActive = u.isActive ?? true;
        token.customerId = u.customerId ?? null;
        token.customerIds = u.customerIds ?? [];
        token.permissions = u.permissions ?? emptyPermissionBits();
        (token as any).customerScopeRefreshedAt = Date.now();
        return token;
      }

      const userId = (token as any).id as string | undefined;
      const tokenRoleName = (token as any).roleName as string | undefined;
      const legacyRoleValues = ["ADMIN", "EMPLOYEE", "VIEWER"];
      const hasValidRoleName =
        typeof tokenRoleName === "string" &&
        tokenRoleName.length > 0 &&
        tokenRoleName !== "UNKNOWN" &&
        legacyRoleValues.includes(tokenRoleName);

      const hasFullFields = Boolean(
        token &&
          typeof (token as any).roleId === "string" &&
          Array.isArray((token as any).customerIds) &&
          (token as any).permissions &&
          hasValidRoleName &&
          typeof (token as any).isActive === "boolean"
      );

      const lastRefresh = (token as any).customerScopeRefreshedAt as number | undefined;
      const shouldRefresh =
        !userId ||
        !hasFullFields ||
        typeof lastRefresh !== "number" ||
        Date.now() - lastRefresh > CUSTOMER_SCOPE_REFRESH_MS;

      if (!shouldRefresh) return token;

      try {
        if (!userId) return token;
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            roleId: true,
            customerId: true,
            isActive: true,
            updatedAt: true,
          },
        });
        if (!dbUser) return token;

        if (dbUser.isActive === false) {
          token.isActive = false;
          token.customerIds = [];
          return token;
        }

        const roleInfo = await resolveRoleForUser({
          id: dbUser.id,
          roleId: dbUser.roleId,
          role: dbUser.role as LegacyRoleName,
          customerId: dbUser.customerId,
        });
        const customerInfo = await resolveCustomerScope(dbUser.id, dbUser.customerId);
        token.id = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name;
        token.role = dbUser.role as any;
        token.roleId = roleInfo.roleId;
        token.roleScope = roleInfo.roleScope;
        token.roleName = roleInfo.roleName;
        token.isActive = true;
        token.customerId = customerInfo.customerId;
        token.customerIds = customerInfo.customerIds;
        token.permissions = roleInfo.permissions;
        (token as any).customerScopeRefreshedAt = Date.now();
      } catch (_e) {
        /* geen upgrade mogelijk, behoud huidige token */
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.email = token.email ?? "";
        session.user.name = token.name ?? "";
        session.user.role = (token.role ?? "VIEWER") as any;
        session.user.roleId = (token as any).roleId ?? "";
        session.user.roleScope = (token as any).roleScope ?? "INTERNAL";
        session.user.roleName = (token as any).roleName ?? "";
        session.user.isActive = (token as any).isActive ?? true;
        session.user.customerId = (token as any).customerId ?? null;
        session.user.customerIds = (token as any).customerIds ?? [];
        session.user.permissions = (token as any).permissions ?? emptyPermissionBits();
        session.user.customerScopeRefreshedAt = (token as any).customerScopeRefreshedAt;
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
