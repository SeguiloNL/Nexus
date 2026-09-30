import NextAuth, { type NextAuthConfig, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { LoginSchema } from "@/server/validators/user";
import { UserRole as UserRoleEnum, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";
import {
  emptyPermissionBits,
  buildLegacyPermissionsForRole,
} from "@/lib/rbac";

type LegacyRoleName = "ADMIN" | "EMPLOYEE" | "VIEWER";

async function resolveRoleForUser(
  user: { id: string; roleId: string | null; role: LegacyRoleName }
): Promise<{
  roleId: string;
  roleScope: RoleScope;
  roleName: string;
  permissions: PermissionBits;
}> {
  const legacyRole: UserRoleEnum =
    (user.role as UserRoleEnum) ?? UserRoleEnum.VIEWER;
  const scope = RoleScope.INTERNAL;
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
  customerId: string | null
): Promise<{ customerId: string | null; customerIds: string[] }> {
  if (!customerId) return { customerId: null, customerIds: [] };
  try {
    const { collectCustomerHierarchyIds } = await import("@/server/services/role.service");
    const ids = await collectCustomerHierarchyIds(customerId);
    return { customerId, customerIds: ids };
  } catch (_e) {
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
          },
        });
        if (!user || !user.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        const roleInfo = await resolveRoleForUser({
          id: user.id,
          roleId: user.roleId,
          role: user.role as LegacyRoleName,
        });
        const customerInfo = await resolveCustomerScope(user.customerId);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
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
        token.customerId = u.customerId ?? null;
        token.customerIds = u.customerIds ?? [];
        token.permissions = u.permissions ?? emptyPermissionBits();
        return token;
      }

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
          hasValidRoleName
      );
      if (hasFullFields) return token;

      try {
        const userId = (token as any).id as string | undefined;
        if (!userId) return token;
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true, role: true, roleId: true, customerId: true },
        });
        if (!dbUser) return token;
        const roleInfo = await resolveRoleForUser({
          id: dbUser.id,
          roleId: dbUser.roleId,
          role: dbUser.role as LegacyRoleName,
        });
        const customerInfo = await resolveCustomerScope(dbUser.customerId);
        token.id = dbUser.id;
        token.email = dbUser.email;
        token.name = dbUser.name;
        token.role = dbUser.role as any;
        token.roleId = roleInfo.roleId;
        token.roleScope = roleInfo.roleScope;
        token.roleName = roleInfo.roleName;
        token.customerId = customerInfo.customerId;
        token.customerIds = customerInfo.customerIds;
        token.permissions = roleInfo.permissions;
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
        session.user.customerId = (token as any).customerId ?? null;
        session.user.customerIds = (token as any).customerIds ?? [];
        session.user.permissions = (token as any).permissions ?? emptyPermissionBits();
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
