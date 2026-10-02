import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "./audit.service";
import type {
  PaginatedResult,
  CreateUserInput,
  UpdateUserInput,
  UserDetail,
  UserCustomerLink,
} from "@/types/domain";
import type { PermissionBits } from "@/types/next-auth.d";
import {
  RoleScope,
  UserRole,
  AuditAction,
  ResourceType,
} from "@/types/enums";
import type { Prisma, User } from "@prisma/client";
import {
  requirePermission,
  pickAuth,
  invalidateUserCustomerScope,
  clearCustomerScopeCache,
  collectUserCustomerIds,
  emptyPermissionBits,
} from "@/lib/rbac";
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

export async function collectDirectUserCustomerIds(
  userId: string
): Promise<string[]> {
  if (!userId) return [];
  const [links, user] = await Promise.all([
    prisma.userCustomer.findMany({
      where: { userId },
      select: { customerId: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { customerId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const l of links) ids.add(l.customerId);
  if (user?.customerId) ids.add(user.customerId);
  return Array.from(ids);
}

export async function findManyUsers(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    role?: UserRole;
    scope?: RoleScope | RoleScope[];
    roleId?: string;
    customerId?: string;
    isActive?: boolean;
    lastLoginBefore?: Date | string;
    lastLoginAfter?: Date | string;
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
    scope,
    roleId,
    customerId,
    isActive,
    lastLoginBefore,
    lastLoginAfter,
  } = params;

  const where: Prisma.UserWhereInput = {};
  if (role) where.role = role;
  if (roleId) where.roleId = roleId;
  if (typeof isActive === "boolean") where.isActive = isActive;
  if (lastLoginBefore) where.lastLoginAt = { ...(where.lastLoginAt as any), lte: new Date(lastLoginBefore) };
  if (lastLoginAfter) where.lastLoginAt = { ...(where.lastLoginAt as any), gte: new Date(lastLoginAfter) };

  if (scope) {
    const scopeArr = Array.isArray(scope) ? scope : [scope];
    where.roleObj = { scope: { in: scopeArr as any } };
  }

  if (customerId) {
    where.OR = [
      ...(where.OR ?? []),
      { customerId },
      { customerLinks: { some: { customerId } } },
    ] as any;
  }

  if (search) {
    const s = search.trim();
    const searchOr = [
      { email: { contains: s, mode: "insensitive" } },
      { name: { contains: s, mode: "insensitive" } },
    ];
    if (where.OR && Array.isArray((where.OR as any[]).length ? where.OR : null)) {
      (where.OR as any[]).push(...searchOr);
    } else if (customerId) {
      where.AND = [where.AND ?? [], { OR: searchOr as any }] as any;
    } else {
      where.OR = searchOr as any;
    }
  }

  if (ctx?.customerScope && ctx.customerScope.length > 0) {
    const cs = ctx.customerScope;
    const scopeFilter: Prisma.UserWhereInput = {
      OR: [
        { customerId: { in: cs } },
        { customerLinks: { some: { customerId: { in: cs } } } },
      ],
    };
    where.AND = [...((where.AND as any[]) ?? []), scopeFilter];
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
          : sort === "lastLoginAt"
            ? "lastLoginAt"
            : sort === "isActive"
              ? "isActive"
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
        customerLinks: {
          select: {
            customerId: true,
            customer: { select: { id: true, customerNumber: true, companyName: true } },
            assignedAt: true,
          },
          take: 25,
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
        "Een Reseller-gebruiker moet gekoppeld zijn aan een Klant van type RESELLER of een DIRECT-subklant van een RESELLER."
      );
    }
    if (scope === RoleScope.PARTNER) {
      throw new Error(
        "Een Partner-gebruiker moet gekoppeld zijn aan een Klant van type PARTNER of een DIRECT-subklant van een PARTNER."
      );
    }
    throw new Error(
      "Een klant-gebruiker moet gekoppeld zijn aan een Klant van type DIRECT."
    );
  }

  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    select: {
      type: true,
      parentCustomer: { select: { type: true } },
    },
  });
  if (!customer) {
    throw new Error(
      `Gekoppelde klant (${customerId}) bestaat niet.`
    );
  }

  const matchesScopeType = (() => {
    if (scope === RoleScope.CUSTOMER) return customer.type === requiredType;
    if (scope === RoleScope.RESELLER) {
      if (customer.type === CustomerType.RESELLER) return true;
      if (
        customer.type === CustomerType.DIRECT &&
        customer.parentCustomer?.type === CustomerType.RESELLER
      ) return true;
      return false;
    }
    if (scope === RoleScope.PARTNER) {
      if (customer.type === CustomerType.PARTNER) return true;
      if (
        customer.type === CustomerType.DIRECT &&
        customer.parentCustomer?.type === CustomerType.PARTNER
      ) return true;
      return false;
    }
    return requiredType ? customer.type === requiredType : true;
  })();

  if (!matchesScopeType) {
    const scopeLabel = scope === RoleScope.RESELLER
      ? "Reseller"
      : scope === RoleScope.PARTNER
        ? "Partner"
        : "Klant";
    const parentInfo = customer.parentCustomer
      ? ` (parent type: ${customer.parentCustomer.type})`
      : "";
    throw new Error(
      `${scopeLabel}-gebruiker kan alleen worden gekoppeld aan een Klant van type ${requiredType} of een DIRECT-subklant ervan (huidig type: ${customer.type}${parentInfo}).`
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

    const rawCustomerIds: string[] = Array.isArray((input as any).customerIds) && (input as any).customerIds.length
      ? (input as any).customerIds
      : input.customerId
        ? [input.customerId]
        : [];

    let finalCustomerId: string | null =
      rawCustomerIds.length > 0 ? rawCustomerIds[0] : null;

    if (typeof (input as any).customerId !== undefined && (input as any).customerId !== null) {
      finalCustomerId = (input as any).customerId;
    }

    await validateCustomerRoleBinding(tx, scope, finalCustomerId);

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (scope !== RoleScope.CUSTOMER) {
        throw new Error(
          "Je kunt alleen gebruikers met een klant-rol aanmaken."
        );
      }
      for (const cid of rawCustomerIds) {
        if (!ctx.customerScope.includes(cid)) {
          throw new Error(`Klant ${cid} valt niet binnen je toegang.`);
        }
      }
      if (rawCustomerIds.length === 0) {
        throw new Error("Minimaal 1 klant is verplicht voor deze gebruiker.");
      }
    }

    const passwordHash = await hashPassword(input.password);
    const finalRole = input.role ?? legacyRole;
    const finalIsActive = typeof (input as any).isActive === "boolean" ? (input as any).isActive : true;

    const created = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: finalRole,
        roleId,
        customerId: finalCustomerId,
        passwordHash,
        isActive: finalIsActive,
      },
    });

    if (rawCustomerIds.length > 0) {
      const uniqCustomerIds = Array.from(new Set(rawCustomerIds));
      await tx.userCustomer.createMany({
        data: uniqCustomerIds.map((cid) => ({
          userId: created.id,
          customerId: cid,
          assignedBy: ctx.userId,
        })),
        skipDuplicates: true,
      });
      for (const cid of uniqCustomerIds) {
        const c = await tx.customer.findUnique({
          where: { id: cid },
          select: { companyName: true },
        });
        await logAudit(tx as any, {
          entityType: "customer",
          entityId: cid,
          action: AuditAction.LINK_USER_CUSTOMER,
          userId: ctx.userId,
          metadata: { userId: created.id, userName: created.name, customerName: c?.companyName ?? null },
        } as any);
      }
    }

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
        isActive: created.isActive,
        linkedCustomerCount: rawCustomerIds.length,
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
    if (typeof (input as any).isActive === "boolean") {
      (data as any).isActive = (input as any).isActive;
    }

    const customerIdsOverride = Array.isArray((input as any).customerIds) ? (input as any).customerIds as string[] : null;
    const isCustomerIdsMutation = customerIdsOverride !== null;
    let finalCustomerIdsSet: Set<string> | null = null;

    if (isCustomerIdsMutation) {
      finalCustomerIdsSet = new Set(customerIdsOverride.filter(Boolean));

      if (ctx.customerScope && ctx.customerScope.length > 0) {
        for (const cid of finalCustomerIdsSet) {
          if (!ctx.customerScope.includes(cid)) {
            throw new Error(`Klant ${cid} valt niet binnen je toegang.`);
          }
        }
      }

      for (const cid of finalCustomerIdsSet) {
        const c = await tx.customer.findUnique({ where: { id: cid } });
        if (!c) throw new Error(`Klant ${cid} bestaat niet.`);
      }

      if (finalCustomerIdsSet.size > 0) {
        const firstCustomerId = Array.from(finalCustomerIdsSet)[0];
        (data as any).customerId = firstCustomerId;
      } else {
        (data as any).customerId = null;
      }

      const effectiveCustomerForBinding = finalCustomerIdsSet.size > 0
        ? Array.from(finalCustomerIdsSet)[0]
        : null;

      const effScope = effectiveScope ?? (await (async () => {
        const ri = (data as any).roleId ?? existing.roleId;
        if (ri) {
          const r = await tx.role.findUnique({ where: { id: ri as string }, select: { scope: true } });
          return (r?.scope as RoleScope) ?? RoleScope.INTERNAL;
        }
        return RoleScope.INTERNAL;
      })());
      await validateCustomerRoleBinding(tx, effScope, effectiveCustomerForBinding);
    }

    const updated = await tx.user.update({ where: { id }, data });

    if (isCustomerIdsMutation && finalCustomerIdsSet) {
      const existingLinks = await tx.userCustomer.findMany({ where: { userId: id }, select: { customerId: true } });
      const existingIds = new Set(existingLinks.map((l) => l.customerId));
      const nextIds = finalCustomerIdsSet;
      const linked: string[] = [];
      const unlinked: string[] = [];
      for (const n of nextIds) if (!existingIds.has(n)) linked.push(n);
      for (const e of existingIds) if (!nextIds.has(e)) unlinked.push(e);

      await tx.userCustomer.deleteMany({ where: { userId: id } });
      if (nextIds.size > 0) {
        await tx.userCustomer.createMany({
          data: Array.from(nextIds).map((cid) => ({ userId: id, customerId: cid, assignedBy: ctx.userId })),
          skipDuplicates: true,
        });
      }

      for (const cid of linked) {
        const c = await tx.customer.findUnique({ where: { id: cid }, select: { companyName: true } });
        await logAudit(tx as any, {
          entityType: "customer",
          entityId: cid,
          action: AuditAction.LINK_USER_CUSTOMER,
          userId: ctx.userId,
          metadata: { userId: id, userName: updated.name, customerName: c?.companyName ?? null },
        } as any);
      }
      for (const cid of unlinked) {
        const c = await tx.customer.findUnique({ where: { id: cid }, select: { companyName: true } });
        await logAudit(tx as any, {
          entityType: "customer",
          entityId: cid,
          action: AuditAction.UNLINK_USER_CUSTOMER,
          userId: ctx.userId,
          metadata: { userId: id, userName: updated.name, customerName: c?.companyName ?? null },
        } as any);
      }
    }

    const changedFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "passwordHash") continue;
      if (JSON.stringify((existing as any)[k]) !== JSON.stringify(v)) {
        changedFields[k] = v;
      }
    }
    if (isCustomerIdsMutation) {
      const existingCustomerIds = (() => {
        const exLinks = (existing as any).customerLinks || [];
        const s = new Set<string>();
        for (const l of exLinks) s.add(l.customerId);
        if ((existing as any).customerId) s.add((existing as any).customerId);
        return Array.from(s);
      })();
      changedFields.customerIds = Array.from(finalCustomerIdsSet ?? []);
      changedFields.customerIdsPrevious = existingCustomerIds;
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
          ...(isCustomerIdsMutation ? { customerIds: changedFields.customerIdsPrevious } : {}),
          ...(typeof (input as any).isActive === "boolean" ? { isActive: existing.isActive } : {}),
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
        newValues: {
          ...changedFields,
          ...(input.password != null ? { password: "[redacted]" } : {}),
        },
      });
    }

    if (isCustomerIdsMutation) {
      invalidateUserCustomerScope(id);
    }
    if (typeof (input as any).isActive === "boolean" && !(input as any).isActive) {
      invalidateUserCustomerScope(id);
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

// ——————————————————————————————————————————
// Nieuwe functies t.b.v. Gebruikers- & Rollensysteem
// ——————————————————————————————————————————

export async function findUserDetailById(
  id: string,
  ctx?: Ctx
): Promise<UserDetail | null> {
  if (ctx) {
    await requirePermission(pickAuth(ctx), "view", "user");
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
      customer: { select: { id: true, companyName: true, customerNumber: true, type: true } },
      customerLinks: {
        select: {
          customerId: true,
          assignedAt: true,
          assignedBy: true,
          customer: { select: { id: true, customerNumber: true, companyName: true, type: true } },
        },
      },
    },
  });
  if (!user) return null;

  if (ctx?.customerScope && ctx.customerScope.length > 0) {
    const direct = new Set<string>();
    if (user.customerId) direct.add(user.customerId);
    for (const l of user.customerLinks) direct.add(l.customerId);
    const scopeSet = new Set(ctx.customerScope);
    let authorized = false;
    for (const d of direct) if (scopeSet.has(d)) { authorized = true; break; }
    if (!authorized) return null;
  }

  let permissions: Record<ResourceType, { read: boolean; write: boolean }> = emptyPermissionBits();
  if (user.roleId) {
    try {
      const { getPermissionsByRoleId } = await import("./role.service");
      permissions = await getPermissionsByRoleId(user.roleId);
    } catch (_e) {
      permissions = emptyPermissionBits();
    }
  } else if (user.role) {
    const scope = (user.roleObj?.scope as RoleScope) ?? RoleScope.INTERNAL;
    try {
      const { buildLegacyPermissionsForRole } = await import("@/lib/rbac");
      permissions = buildLegacyPermissionsForRole(user.role as UserRole, scope) as any;
    } catch (_e) {
      permissions = emptyPermissionBits();
    }
  }

  const customerLinks: UserCustomerLink[] = user.customerLinks.map((l) => ({
    userId: id,
    customerId: l.customerId,
    assignedAt: l.assignedAt,
    assignedBy: l.assignedBy ?? null,
    customer: l.customer
      ? {
          id: l.customer.id,
          customerNumber: l.customer.customerNumber,
          companyName: l.customer.companyName,
          type: l.customer.type as any,
        }
      : undefined,
  }));

  const effectiveCustomerIds = await collectUserCustomerIds(id);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    roleId: user.roleId,
    roleName: user.roleObj?.name,
    roleScope: user.roleObj?.scope as RoleScope | undefined,
    customerId: user.customerId,
    customerName: user.customer?.companyName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    roleObj: user.roleObj
      ? { ...user.roleObj, scope: user.roleObj.scope as RoleScope }
      : null,
    permissions,
    customerLinks,
    effectiveCustomerIds,
  };
}

export async function updateUserCustomerLinks(
  userId: string,
  nextCustomerIds: string[],
  ctx: Ctx
): Promise<{ linked: string[]; unlinked: string[] }> {
  await requirePermission(pickAuth(ctx), "edit", "user");

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    include: { customerLinks: { select: { customerId: true } } },
  });
  if (!existing) throw new Error("Gebruiker niet gevonden.");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    for (const cid of nextCustomerIds) {
      if (!ctx.customerScope.includes(cid)) {
        throw new Error(`Klant ${cid} valt niet binnen je toegang.`);
      }
    }
    const existingDirect = new Set<string>();
    if (existing.customerId) existingDirect.add(existing.customerId);
    for (const l of existing.customerLinks) existingDirect.add(l.customerId);
    let authorized = false;
    for (const d of existingDirect) if (ctx.customerScope.includes(d)) { authorized = true; break; }
    if (!authorized) throw new Error("Je bent niet bevoegd deze gebruiker te wijzigen.");
  }

  const existingIds = new Set(existing.customerLinks.map((l) => l.customerId));
  if (existing.customerId) existingIds.add(existing.customerId);
  const nextIds = new Set<string>(nextCustomerIds.filter(Boolean));
  const linked: string[] = [];
  const unlinked: string[] = [];
  for (const n of nextIds) if (!existingIds.has(n)) linked.push(n);
  for (const e of existingIds) if (!nextIds.has(e)) unlinked.push(e);

  await prisma.$transaction(async (tx) => {
    if (existing.roleId) {
      const r = await tx.role.findUnique({ where: { id: existing.roleId }, select: { scope: true } });
      const scope = (r?.scope as RoleScope) ?? RoleScope.INTERNAL;
      const firstCustomerId = nextIds.size > 0 ? Array.from(nextIds)[0] : null;
      await validateCustomerRoleBinding(tx, scope, firstCustomerId);
    }

    await tx.userCustomer.deleteMany({ where: { userId } });
    if (nextIds.size > 0) {
      await tx.userCustomer.createMany({
        data: Array.from(nextIds).map((cid) => ({ userId, customerId: cid, assignedBy: ctx.userId })),
        skipDuplicates: true,
      });
    }
    await tx.user.update({
      where: { id: userId },
      data: { customerId: nextIds.size > 0 ? Array.from(nextIds)[0] : null },
    });
    for (const cid of linked) {
      const c = await tx.customer.findUnique({ where: { id: cid }, select: { companyName: true } });
      await logAudit(tx as any, {
        entityType: "customer",
        entityId: cid,
        action: AuditAction.LINK_USER_CUSTOMER,
        userId: ctx.userId,
        metadata: { userId, userName: existing.name, customerName: c?.companyName ?? null },
      } as any);
    }
    for (const cid of unlinked) {
      const c = await tx.customer.findUnique({ where: { id: cid }, select: { companyName: true } });
      await logAudit(tx as any, {
        entityType: "customer",
        entityId: cid,
        action: AuditAction.UNLINK_USER_CUSTOMER,
        userId: ctx.userId,
        metadata: { userId, userName: existing.name, customerName: c?.companyName ?? null },
      } as any);
    }
    await logAudit(tx as any, {
      entityType: "user",
      entityId: userId,
      action: AuditAction.UPDATE,
      userId: ctx.userId,
      metadata: { linked, unlinked, totalLinked: nextIds.size },
    } as any);
  });

  invalidateUserCustomerScope(userId);
  clearCustomerScopeCache();
  return { linked, unlinked };
}

export async function toggleUserActive(
  userId: string,
  isActive: boolean,
  ctx: Ctx
): Promise<User> {
  await requirePermission(pickAuth(ctx), "edit", "user");

  if (userId === ctx.userId && !isActive) {
    throw new Error("Je kunt je eigen account niet deactiveren.");
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new Error("Gebruiker niet gevonden.");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (!existing.customerId || !ctx.customerScope.includes(existing.customerId)) {
      throw new Error("Je bent niet bevoegd deze gebruiker te wijzigen.");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const up = await tx.user.update({
      where: { id: userId },
      data: { isActive },
    });
    await logAudit(tx as any, {
      entityType: "user",
      entityId: userId,
      action: AuditAction.TOGGLE_USER_ACTIVE,
      userId: ctx.userId,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      metadata: { wasActive: existing.isActive, nowActive: isActive },
    } as any);
    return up;
  });

  if (!isActive) {
    invalidateUserCustomerScope(userId);
  }
  return updated;
}

export async function bulkUpdateUserRole(
  userIds: string[],
  roleId: string,
  ctx: Ctx
): Promise<{ updated: number }> {
  await requirePermission(pickAuth(ctx), "edit", "user");

  if (userIds.length === 0) return { updated: 0 };

  const targetRole = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, scope: true },
  });
  if (!targetRole) throw new Error("Doelrol bestaat niet.");
  const targetScope = targetRole.scope as RoleScope;

  return prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, customerId: true, roleId: true },
    });
    if (users.length === 0) return { updated: 0 };

    let allowedUserIds: string[];
    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (targetScope !== RoleScope.CUSTOMER) {
        throw new Error("Binnen jouw toegang kun je allen rollen met CUSTOMER scope toekennen.");
      }
      allowedUserIds = users
        .filter((u) => u.customerId && ctx.customerScope!.includes(u.customerId))
        .map((u) => u.id);
    } else {
      allowedUserIds = users.map((u) => u.id);
    }

    for (const uid of allowedUserIds) {
      const u = users.find((x) => x.id === uid)!;
      if (targetScope !== RoleScope.INTERNAL) {
        const cid = u.customerId;
        try {
          await validateCustomerRoleBinding(tx, targetScope, cid);
        } catch (e) {
          throw new Error(`Gebruiker ${u.name} (${uid}): ${(e as Error).message}`);
        }
      }
    }

    if (allowedUserIds.length === 0) return { updated: 0 };

    await tx.user.updateMany({
      where: { id: { in: allowedUserIds } },
      data: { roleId },
    });

    for (const u of users) {
      if (!allowedUserIds.includes(u.id)) continue;
      await logAudit(tx as any, {
        entityType: "user",
        entityId: u.id,
        action: AuditAction.BULK_UPDATE_ROLE,
        userId: ctx.userId,
        oldValues: { roleId: u.roleId ?? null },
        newValues: { roleId },
        metadata: { userName: u.name, targetRoleScope: targetScope },
      } as any);
    }

    return { updated: allowedUserIds.length };
  });
}
