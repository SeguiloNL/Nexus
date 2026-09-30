import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "./audit.service";
import type {
  PaginatedResult,
  CreateUserInput,
  UpdateUserInput,
} from "@/types/domain";
import type { PermissionBits } from "@/types/next-auth.d";
import { RoleScope, UserRole } from "@/types/enums";
import type { Prisma, User } from "@prisma/client";
import { requirePermission, pickAuth } from "@/lib/rbac";
import { CustomerType } from "@/types/enums";

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string | null;
  roleScope?: RoleScope | null;
  permissions?: PermissionBits | null;
  customerScope?: string[] | null;
};

const DEFAULT_ROLE_NAMES: Record<UserRole, string> = {
  ADMIN: "Beheerder",
  EMPLOYEE: "Medewerker",
  VIEWER: "Alleen-lezen",
};

export async function findManyUsers(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    role?: UserRole;
  } = {},
  ctx?: Ctx
): Promise<PaginatedResult<User>> {
  if (ctx) {
    await requirePermission(
      pickAuth(ctx),
      "view",
      "user"
    );
  }

  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    role,
  } = params;

  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (search) {
    const s = search.trim();
    where.OR = [
      { email: { contains: s, mode: "insensitive" } },
      { name: { contains: s, mode: "insensitive" } },
    ];
  }
  if (ctx?.customerScope && ctx.customerScope.length > 0) {
    where.customerId = { in: ctx.customerScope };
  } else if (ctx?.roleScope === "CUSTOMER") {
    where.customerId = "";
  }

  const sortKey: keyof Prisma.UserOrderByWithRelationInput =
    sort === "email"
      ? "email"
      : sort === "name"
        ? "name"
        : sort === "role"
          ? "role"
          : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.UserOrderByWithRelationInput,
      take: perPage,
      skip,
      include: {
        roleObj: {
          select: {
            id: true,
            name: true,
            scope: true,
            isSystem: true,
            description: true,
          },
        },
        customer: {
          select: {
            id: true,
            customerNumber: true,
            companyName: true,
          },
        },
      },
    }),
  ]);

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findUserById(id: string, ctx?: Ctx) {
  if (ctx) {
    await requirePermission(
      pickAuth(ctx),
      "view",
      "user"
    );
  }
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      roleObj: {
        select: {
          id: true,
          name: true,
          scope: true,
          isSystem: true,
          description: true,
        },
      },
      customer: {
        select: {
          id: true,
          customerNumber: true,
          companyName: true,
        },
      },
    },
  });
  if (!user) return null;
  if (ctx?.customerScope && ctx.customerScope.length > 0) {
    if (!user.customerId || !ctx.customerScope.includes(user.customerId)) {
      return null;
    }
  }
  return user;
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

function legacyRoleForScope(scope: RoleScope): UserRole {
  switch (scope) {
    case RoleScope.CUSTOMER:
      return UserRole.VIEWER;
    case RoleScope.INTERNAL:
    case RoleScope.RESELLER:
    case RoleScope.PARTNER:
    default:
      return UserRole.EMPLOYEE;
  }
}

function legacyRoleForSystemRole(name: string): UserRole | null {
  for (const [enumKey, label] of Object.entries(DEFAULT_ROLE_NAMES)) {
    if (label === name || name === `${label}`) {
      return enumKey as UserRole;
    }
  }
  if (name === "Beheerder") return UserRole.ADMIN;
  if (name === "Medewerker") return UserRole.EMPLOYEE;
  if (name === "Alleen-lezen" || name === "Alleen lezen") return UserRole.VIEWER;
  return null;
}

function requiredCustomerTypeForScope(scope: RoleScope): CustomerType | null {
  switch (scope) {
    case RoleScope.RESELLER:
      return CustomerType.RESELLER;
    case RoleScope.PARTNER:
      return CustomerType.PARTNER;
    case RoleScope.CUSTOMER:
      return CustomerType.DIRECT;
    case RoleScope.INTERNAL:
    default:
      return null;
  }
}

async function validateCustomerRoleBinding(
  tx: Prisma.TransactionClient,
  scope: RoleScope,
  customerId: string | null
): Promise<void> {
  const requiredType = requiredCustomerTypeForScope(scope);

  if (scope === RoleScope.INTERNAL) {
    if (customerId) {
      throw new Error(
        "Interne rollen mogen geen klant toegewezen krijgen."
      );
    }
    return;
  }

  if (!customerId) {
    if (scope === RoleScope.RESELLER) {
      throw new Error(
        "Een Reseller-gebruiker moet gekoppeld zijn aan een Klant van type RESELLER."
      );
    }
    if (scope === RoleScope.PARTNER) {
      throw new Error(
        "Een Partner-gebruiker moet gekoppeld zijn aan een Klant van type PARTNER."
      );
    }
    throw new Error(
      "Een klant-gebruiker moet gekoppeld zijn aan een Klant van type DIRECT."
    );
  }

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: { type: true },
  });
  if (!customer) {
    throw new Error(
      `Gekoppelde klant (${customerId}) bestaat niet.`
    );
  }

  if (requiredType && customer.type !== requiredType) {
    const scopeLabel = scope === RoleScope.RESELLER
      ? "Reseller"
      : scope === RoleScope.PARTNER
        ? "Partner"
        : "Klant";
    throw new Error(
      `${scopeLabel}-gebruiker kan alleen worden gekoppeld aan een Klant van type ${requiredType} (huidig type: ${customer.type}).`
    );
  }
}

async function resolveRoleIdForLegacy(
  tx: Prisma.TransactionClient,
  legacyRole?: UserRole,
  explicitRoleId?: string
): Promise<{ roleId: string; scope: RoleScope; legacyRole: UserRole }> {
  if (explicitRoleId) {
    const role = await tx.role.findUnique({
      where: { id: explicitRoleId },
      select: { id: true, scope: true, isSystem: true, name: true },
    });
    if (!role) throw new Error("De geselecteerde rol bestaat niet.");
    const matched = role.isSystem ? legacyRoleForSystemRole(role.name) : null;
    return {
      roleId: role.id,
      scope: role.scope as RoleScope,
      legacyRole: matched ?? legacyRoleForScope(role.scope as RoleScope),
    };
  }
  if (legacyRole) {
    const roleName = DEFAULT_ROLE_NAMES[legacyRole] ?? legacyRole;
    const role = await tx.role.findFirst({
      where: { name: roleName, isSystem: true },
      select: { id: true, scope: true, isSystem: true, name: true },
    });
    if (!role) {
      const fallback = await tx.role.findFirst({
        select: { id: true, scope: true, isSystem: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      if (!fallback) throw new Error("Geen standaard rol gevonden.");
      const matched = fallback.isSystem
        ? legacyRoleForSystemRole(fallback.name)
        : null;
      return {
        roleId: fallback.id,
        scope: fallback.scope as RoleScope,
        legacyRole: matched ?? legacyRoleForScope(fallback.scope as RoleScope),
      };
    }
    return {
      roleId: role.id,
      scope: role.scope as RoleScope,
      legacyRole: legacyRole,
    };
  }
  throw new Error("Een rol is verplicht.");
}

export async function createUser(
  input: CreateUserInput,
  ctx: Ctx
): Promise<User> {
  await requirePermission(
    pickAuth(ctx),
    "create",
    "user"
  );

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new Error("Er bestaat al een gebruiker met dit e-mailadres.");
    }

    const { roleId, scope, legacyRole } = await resolveRoleIdForLegacy(
      tx,
      input.role,
      input.roleId
    );

    let finalCustomerId: string | null = input.customerId ?? null;

    await validateCustomerRoleBinding(tx, scope, finalCustomerId);

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (scope !== RoleScope.CUSTOMER) {
        throw new Error(
          "Je kunt alleen gebruikers met een klant-rol aanmaken."
        );
      }
      if (!finalCustomerId || !ctx.customerScope.includes(finalCustomerId)) {
        throw new Error("Ongeldige klant voor deze gebruiker.");
      }
    }

    const passwordHash = await hashPassword(input.password);
    const finalRole = input.role ?? legacyRole;
    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: finalRole,
        roleId,
        customerId: finalCustomerId,
        passwordHash,
      },
    });

    await logAudit(tx, {
      entityType: "user",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        roleId: created.roleId,
        customerId: created.customerId,
      } as any,
    });

    return created;
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  ctx: Ctx
): Promise<User> {
  await requirePermission(
    pickAuth(ctx),
    "edit",
    "user"
  );

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUniqueOrThrow({ where: { id } });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!existing.customerId || !ctx.customerScope.includes(existing.customerId)) {
        throw new Error("Je bent niet bevoegd deze gebruiker te wijzigen.");
      }
    }

    const data: Prisma.UserUpdateInput = {};

    if (input.email != null && input.email !== existing.email) {
      const duplicate = await tx.user.findUnique({ where: { email: input.email } });
      if (duplicate && duplicate.id !== id) {
        throw new Error("Er bestaat al een gebruiker met dit e-mailadres.");
      }
      data.email = input.email;
    }
    if (input.name != null) data.name = input.name;

    const changingRole = input.roleId !== undefined || input.role !== undefined;
    let effectiveScope: RoleScope | null = null;

    if (changingRole) {
      const resolved = await resolveRoleIdForLegacy(tx, input.role, input.roleId);
      (data as any).roleId = resolved.roleId;
      data.role = input.role ?? resolved.legacyRole;
      effectiveScope = resolved.scope;

      if (ctx.customerScope && ctx.customerScope.length > 0) {
        if (resolved.scope !== RoleScope.CUSTOMER) {
          throw new Error(
            "Je kunt alleen gebruikers met een klant-rol wijzigen naar een klant-rol."
          );
        }
      }
    }

    if (input.customerId !== undefined) {
      (data as any).customerId = input.customerId;
    }

    if (!effectiveScope) {
      const roleIdForScope = (data as any).roleId ?? existing.roleId;
      if (roleIdForScope) {
        const r = await tx.role.findUnique({
          where: { id: roleIdForScope as string },
          select: { scope: true },
        });
        effectiveScope = (r?.scope as RoleScope) ?? RoleScope.INTERNAL;
      } else {
        effectiveScope = RoleScope.INTERNAL;
      }
    }

    const effectiveCustomerId =
      input.customerId !== undefined ? input.customerId : existing.customerId;

    await validateCustomerRoleBinding(tx, effectiveScope, effectiveCustomerId);

    if (ctx.customerScope && ctx.customerScope.length > 0 && effectiveCustomerId) {
      if (!ctx.customerScope.includes(effectiveCustomerId)) {
        throw new Error("Ongeldige klant voor deze gebruiker.");
      }
    }

    if (input.password != null && input.password !== "") {
      data.passwordHash = await hashPassword(input.password);
    }

    const updated = await tx.user.update({ where: { id }, data });

    const changedFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "passwordHash") continue;
      if (JSON.stringify((existing as any)[k]) !== JSON.stringify(v)) {
        changedFields[k] = v;
      }
    }
    if (Object.keys(changedFields).length > 0 || input.password != null) {
      await logAudit(tx, {
        entityType: "user",
        entityId: updated.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues: {
          ...(input.email != null ? { email: existing.email } : {}),
          ...(input.name != null ? { name: existing.name } : {}),
          ...(changingRole ? { role: existing.role, roleId: existing.roleId } : {}),
          ...(input.customerId !== undefined
            ? { customerId: existing.customerId }
            : {}),
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
        newValues: {
          ...changedFields,
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
      });
    }

    return updated;
  });
}

export async function deleteUser(id: string, ctx: Ctx): Promise<User> {
  await requirePermission(
    pickAuth(ctx),
    "delete",
    "user"
  );

  return prisma.$transaction(async (tx) => {
    if (id === ctx.userId) {
      throw new Error("Je kunt je eigen account niet verwijderen.");
    }
    const existing = await tx.user.findUniqueOrThrow({ where: { id } });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!existing.customerId || !ctx.customerScope.includes(existing.customerId)) {
        throw new Error(
          "Je bent niet bevoegd deze gebruiker te verwijderen."
        );
      }
    }

    await logAudit(tx, {
      entityType: "user",
      entityId: id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
        roleId: existing.roleId,
        customerId: existing.customerId,
      } as any,
    });

    await tx.auditLog.deleteMany({ where: { userId: id } });
    await tx.trackerAssignment.updateMany({
      where: { createdById: id },
      data: { createdById: null as any },
    });
    await tx.simAssignment.updateMany({
      where: { createdById: id },
      data: { createdById: null as any },
    });
    await tx.activationOrder.updateMany({
      where: { createdById: id },
      data: { createdById: null as any },
    });

    const deleted = await tx.user.delete({ where: { id } });
    return deleted;
  });
}

export async function updateLastLogin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}
