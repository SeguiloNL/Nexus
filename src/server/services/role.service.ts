import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import type {
  CreateRoleInput,
  PermissionLevel,
  UpdateRoleInput,
  RoleDetail,
  RoleListItem,
} from "@/types/domain";
import { RoleScope, type ResourceType } from "@/types/enums";
import {
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
  RESELLER_SCOPE_RESOURCES,
  PARTNER_SCOPE_RESOURCES,
} from "@/types/enums";

export type RoleCacheInvalidator = () => void;

let cacheInvalidator: RoleCacheInvalidator | null = null;

export function registerRoleCacheInvalidator(fn: RoleCacheInvalidator) {
  cacheInvalidator = fn;
}

function invalidatePermissionCache() {
  try {
    cacheInvalidator?.();
  } catch (_e) {
    /* noop */
  }
}

type Ctx = { userId: string; userRole: any; userName?: string };

const CUSTOMER_ALLOWED_RESOURCES = new Set<ResourceType>(CUSTOMER_SCOPE_RESOURCES);
const RESELLER_ALLOWED_RESOURCES = new Set<ResourceType>(RESELLER_SCOPE_RESOURCES);
const PARTNER_ALLOWED_RESOURCES = new Set<ResourceType>(PARTNER_SCOPE_RESOURCES);

function allowedResourcesForScope(scope: RoleScope): Set<ResourceType> {
  switch (scope) {
    case RoleScope.CUSTOMER:
      return CUSTOMER_ALLOWED_RESOURCES;
    case RoleScope.RESELLER:
      return RESELLER_ALLOWED_RESOURCES;
    case RoleScope.PARTNER:
      return PARTNER_ALLOWED_RESOURCES;
    case RoleScope.INTERNAL:
    default:
      return new Set(ALL_RESOURCE_TYPES);
  }
}

function levelToBits(level: PermissionLevel): { read: boolean; write: boolean } {
  switch (level) {
    case "WRITE":
      return { read: true, write: true };
    case "READ":
      return { read: true, write: false };
    case "NONE":
    default:
      return { read: false, write: false };
  }
}

function buildPermissionsFromMatrix(
  scope: RoleScope,
  matrix: Partial<Record<ResourceType, PermissionLevel>>
): Array<{ resource: ResourceType; read: boolean; write: boolean }> {
  const allowed = allowedResourcesForScope(scope);
  const entries: Array<{ resource: ResourceType; read: boolean; write: boolean }> = [];

  for (const resource of ALL_RESOURCE_TYPES) {
    if (!allowed.has(resource)) continue;
    const lvl = matrix[resource] ?? "NONE";
    entries.push({ resource, ...levelToBits(lvl) });
  }
  return entries;
}

export function defaultPermissionsForScope(
  scope: RoleScope
): Record<ResourceType, { read: boolean; write: boolean }> {
  const base = {} as Record<ResourceType, { read: boolean; write: boolean }>;
  for (const r of ALL_RESOURCE_TYPES) {
    base[r] = { read: false, write: false };
  }
  return base;
}

export async function findManyRoles(): Promise<RoleListItem[]> {
  const rows = await prisma.role.findMany({
    include: {
      _count: { select: { users: true, permissions: true } },
      permissions: { select: { resource: true, read: true, write: true } },
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });

  return rows.map((r) => {
    let readCount = 0;
    let writeCount = 0;
    for (const p of r.permissions) {
      if (p.read) readCount++;
      if (p.write) writeCount++;
    }
    return {
      id: r.id,
      name: r.name,
      scope: r.scope as RoleScope,
      isSystem: r.isSystem,
      isDefault: r.isDefault,
      description: r.description,
      userCount: r._count.users,
      permissionCount: { read: readCount, write: writeCount },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export async function findRoleById(id: string): Promise<RoleDetail | null> {
  const r = await prisma.role.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, permissions: true } },
      permissions: { select: { resource: true, read: true, write: true } },
    },
  });
  if (!r) return null;

  const perms = defaultPermissionsForScope(r.scope as RoleScope);
  for (const p of r.permissions) {
    if (p.resource in perms) {
      perms[p.resource as ResourceType] = { read: p.read, write: p.write };
    }
  }

  let readCount = 0;
  let writeCount = 0;
  for (const key of Object.keys(perms) as ResourceType[]) {
    if (perms[key].read) readCount++;
    if (perms[key].write) writeCount++;
  }

  return {
    id: r.id,
    name: r.name,
    scope: r.scope as RoleScope,
    isSystem: r.isSystem,
    isDefault: r.isDefault,
    description: r.description,
    userCount: r._count.users,
    permissionCount: { read: readCount, write: writeCount },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    permissions: perms,
  };
}

export async function getPermissionsByRoleId(
  roleId: string
): Promise<Record<ResourceType, { read: boolean; write: boolean }>> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { scope: true, permissions: { select: { resource: true, read: true, write: true } } },
  });
  if (!role) {
    return defaultPermissionsForScope(RoleScope.INTERNAL);
  }
  const base = defaultPermissionsForScope(role.scope as RoleScope);
  for (const p of role.permissions) {
    if (p.resource in base) {
      base[p.resource as ResourceType] = { read: p.read, write: p.write };
    }
  }
  return base;
}

export async function createRoleWithPermissions(
  input: CreateRoleInput,
  ctx: Ctx
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.role.findUnique({
      where: { name_scope: { name: input.name.trim(), scope: input.scope } },
    });
    if (existing) {
      throw new Error(`Er bestaat al een rol met naam "${input.name}" binnen deze scope.`);
    }

    const allowed = allowedResourcesForScope(input.scope);
    for (const resource of Object.keys(input.permissions) as ResourceType[]) {
      if (!allowed.has(resource)) {
        throw new Error(
          `Resource "${resource}" is niet toegestaan voor scope ${input.scope}.`
        );
      }
    }

    const permEntries = buildPermissionsFromMatrix(input.scope, input.permissions);

    const created = await tx.role.create({
      data: {
        name: input.name.trim(),
        scope: input.scope,
        description: input.description ?? null,
        isDefault: input.isDefault ?? false,
        isSystem: false,
        permissions: {
          create: permEntries.map((p) => ({
            resource: p.resource,
            read: p.read,
            write: p.write,
          })),
        },
      },
      include: { permissions: true },
    });

    invalidatePermissionCache();

    await logAudit(tx as any, {
      entityType: "role",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: {
        id: created.id,
        name: created.name,
        scope: created.scope,
        description: created.description,
        permissionCount: permEntries.filter((p) => p.read || p.write).length,
      } as any,
    });

    return created;
  });
}

export async function updateRoleWithPermissions(
  id: string,
  input: UpdateRoleInput,
  ctx: Ctx
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.role.findUniqueOrThrow({ where: { id } });

    if (existing.isSystem) {
      if (input.name != null || input.isDefault != null) {
        throw new Error("Systeemrollen mogen niet worden hernoemd of als default ingesteld.");
      }
    }

    const scope = existing.scope;
    const data: any = {};
    if (input.name != null) {
      const trimmed = input.name.trim();
      const dup = await tx.role.findUnique({
        where: { name_scope: { name: trimmed, scope: scope as any } },
      });
      if (dup && dup.id !== id) {
        throw new Error(`Er bestaat al een rol met naam "${trimmed}" binnen deze scope.`);
      }
      data.name = trimmed;
    }
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.isDefault != null) data.isDefault = input.isDefault;

    let updated;
    if (Object.keys(data).length > 0) {
      updated = await tx.role.update({ where: { id }, data });
    } else {
      updated = existing;
    }

    if (input.permissions) {
      const allowed = allowedResourcesForScope(scope as RoleScope);
      for (const resource of Object.keys(input.permissions) as ResourceType[]) {
        if (!allowed.has(resource)) {
          throw new Error(
            `Resource "${resource}" is niet toegestaan voor scope ${scope}.`
          );
        }
      }
      const permEntries = buildPermissionsFromMatrix(
        scope as RoleScope,
        input.permissions
      );

      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: permEntries.map((p) => ({
          roleId: id,
          resource: p.resource,
          read: p.read,
          write: p.write,
        })),
      });
    }

    invalidatePermissionCache();

    await logAudit(tx as any, {
      entityType: "role",
      entityId: id,
      action: "UPDATE",
      userId: ctx.userId,
      newValues: {
        ...(input.name ? { name: updated.name } : {}),
        ...(input.permissions ? { permissionsUpdated: true } : {}),
      },
      oldValues: {
        ...(input.name ? { name: existing.name } : {}),
      },
    } as any);

    return updated;
  });
}

export async function deleteRoleIfNotSystem(id: string, ctx: Ctx) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.role.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (existing.isSystem) {
      throw new Error("Systeemrollen kunnen niet worden verwijderd.");
    }
    if (existing._count.users > 0) {
      throw new Error(
        `Deze rol heeft nog ${existing._count.users} gebruiker(s). Wijzig eerst hun rol voordat je deze verwijdert.`
      );
    }
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    const deleted = await tx.role.delete({ where: { id } });

    invalidatePermissionCache();

    await logAudit(tx as any, {
      entityType: "role",
      entityId: id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: { id: deleted.id, name: deleted.name, scope: deleted.scope } as any,
    });
    return deleted;
  });
}

export async function collectCustomerHierarchyIds(
  rootCustomerId: string
): Promise<string[]> {
  const result = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    WITH RECURSIVE hierarchy AS (
      SELECT id, "parentCustomerId"
      FROM customers
      WHERE id = $1::text AND "deletedAt" IS NULL
      UNION ALL
      SELECT c.id, c."parentCustomerId"
      FROM customers c
      INNER JOIN hierarchy h ON c."parentCustomerId" = h.id
      WHERE c."deletedAt" IS NULL
    )
    SELECT DISTINCT id FROM hierarchy;
    `,
    rootCustomerId
  );
  return result.map((r) => r.id);
}
