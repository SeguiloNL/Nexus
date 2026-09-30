import { prisma } from "@/lib/prisma";
import { pickAuth, requirePermission } from "@/lib/rbac";
import type { UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";
import type {
  AuditLogFilterParams,
  PaginatedResult,
} from "@/types/domain";
import type { Prisma, AuditLog as PrismaAuditLog } from "@prisma/client";

type AuditLogDb =
  | Prisma.TransactionClient
  | typeof prisma;

export interface LogAuditInput {
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: Date | string | null;
}

export async function logAudit(
  db: AuditLogDb,
  input: LogAuditInput
): Promise<PrismaAuditLog> {
  const effectiveTimestamp = input.timestamp
    ? (typeof input.timestamp === "string" ? new Date(input.timestamp) : input.timestamp)
    : new Date();

  const enrichedMetadata = input.metadata
    ? { ...input.metadata, timestamp: effectiveTimestamp.toISOString() }
    : { timestamp: effectiveTimestamp.toISOString() };

  return db.auditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action as Prisma.AuditLogUncheckedCreateInput["action"],
      userId: input.userId,
      oldValues: input.oldValues as Prisma.InputJsonValue | undefined,
      newValues: input.newValues as Prisma.InputJsonValue | undefined,
      metadata: enrichedMetadata as Prisma.InputJsonValue | undefined,
      timestamp: effectiveTimestamp,
    },
  });
}

type AuditCtx = {
  userRole?: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerScope?: string[];
  permissions?: PermissionBits;
};

export async function findManyAuditLogs(
  params: AuditLogFilterParams & {
    viewerUserId?: string;
    viewerRole?: UserRole;
    customerScope?: string[];
  },
  ctx?: AuditCtx
): Promise<
  PaginatedResult<
    PrismaAuditLog & { user: { name: string | null; email: string } | null }
  >
> {
  if (ctx) {
    await requirePermission(pickAuth(ctx), "view", "audit_log");
  }

  const {
    page = 1,
    perPage = 25,
    sort = "timestamp",
    order = "desc",
    search,
    userId,
    entityType,
    action,
    fromDate,
    toDate,
    viewerUserId,
    viewerRole,
    customerScope,
  } = params;

  const where: Prisma.AuditLogWhereInput = {};

  if ((customerScope && customerScope.length > 0) || (viewerRole === "VIEWER" && viewerUserId)) {
    if (viewerUserId) where.userId = viewerUserId;
  } else if (userId) {
    where.userId = userId;
  }

  if (entityType) where.entityType = entityType;
  if (action) {
    (where.action as any) = { equals: action };
  }

  if (fromDate || toDate) {
    where.timestamp = {};
    if (fromDate) where.timestamp.gte = new Date(fromDate);
    if (toDate) where.timestamp.lte = new Date(toDate);
  }

  if (search) {
    where.OR = [
      { entityType: { contains: search, mode: "insensitive" } },
      { entityId: { contains: search, mode: "insensitive" } },
      { user: { name: { contains: search, mode: "insensitive" } } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ];
  }

  const skip = (page - 1) * perPage;
  const orderBy: Prisma.AuditLogOrderByWithRelationInput = (() => {
    if (sort === "action") return { action: order as Prisma.SortOrder };
    if (sort === "entityType") return { entityType: order as Prisma.SortOrder };
    return { timestamp: order as Prisma.SortOrder };
  })();

  const [total, data] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy,
      take: perPage,
      skip,
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

/**
 * Diff van twee objecten (ondiep). Alleen gewijzigde velden.
 */
export function diffObject<T extends Record<string, unknown>>(
  oldObj: T | null | undefined,
  newObj: T | null | undefined
): {
  oldValues: Partial<T> | null;
  newValues: Partial<T> | null;
} {
  const oldValues: Partial<T> = {};
  const newValues: Partial<T> = {};
  const keys = new Set<keyof T>([
    ...Object.keys(oldObj ?? ({} as T)),
    ...Object.keys(newObj ?? ({} as T)),
  ] as Array<keyof T>);

  for (const key of keys) {
    const a = oldObj?.[key];
    const b = newObj?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      oldValues[key] = a;
      newValues[key] = b;
    }
  }

  const hasChanges = Object.keys(oldValues).length > 0;
  return {
    oldValues: hasChanges ? oldValues : null,
    newValues: hasChanges ? newValues : null,
  };
}
