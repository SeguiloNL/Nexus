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
  userId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: Date | string | null;
}

export async function logAudit(
  db: AuditLogDb,
  input: LogAuditInput
): Promise<PrismaAuditLog | null> {
  const effectiveTimestamp = input.timestamp
    ? (typeof input.timestamp === "string" ? new Date(input.timestamp) : input.timestamp)
    : new Date();

  const enrichedMetadata = input.metadata
    ? { ...input.metadata, timestamp: effectiveTimestamp.toISOString() }
    : { timestamp: effectiveTimestamp.toISOString() };

  const rawUserId = input.userId ?? null;
  const normalizedUserId: string | null =
    rawUserId && typeof rawUserId === "string" && rawUserId !== "SYSTEM"
      ? rawUserId
      : null;

  // Bepaal of we binnen een transactie draaien. Als db het hoofdonkkoppeling
  // (prisma) is, draaien we buiten een transactie en mogen we fouten afvangen
  // (best-effort). Als db een transactie-client is, mogen we fouten NIET afvangen,
  // want dat zou de PostgreSQL-transactie in een afgebroken staat achterlaten
  // (foutcode 25P02: "current transaction is aborted").
  const isInTransaction = db !== prisma;

  // Helper om een audit-log aan te maken. Als de FK op userId faalt (b.v. de
  // sessiegebruiker bestaat niet meer in de database na een reset), dan proberen
  // we het opnieuw met userId: null. De FK-constraint heeft ON DELETE SET NULL,
  // dus null is geldig.
  const createAuditLog = async (
    userId: string | null
  ): Promise<PrismaAuditLog> => {
    return db.auditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action as Prisma.AuditLogUncheckedCreateInput["action"],
        userId,
        oldValues: input.oldValues as Prisma.InputJsonValue | undefined,
        newValues: input.newValues as Prisma.InputJsonValue | undefined,
        metadata: enrichedMetadata as Prisma.InputJsonValue | undefined,
        timestamp: effectiveTimestamp,
      },
    });
  };

  try {
    return await createAuditLog(normalizedUserId);
  } catch (auditErr: any) {
    // Als de FK-constraint op userId faalt (Prisma foutcode P2003), probeer
    // het opnieuw met userId: null. Dit kan gebeuren als de sessie een
    // verouderde gebruikers-ID bevat (b.v. na een database-reset).
    const isFkViolation =
      auditErr?.code === "P2003" &&
      typeof auditErr?.message === "string" &&
      auditErr.message.includes("userId");
    if (isFkViolation && normalizedUserId !== null) {
      console.warn(
        "[audit-faal] FK violation op userId (gebruiker bestaat niet); audit-log wordt geschreven met userId=null. Actie: " +
          input.action
      );
      try {
        return await createAuditLog(null);
      } catch (retryErr: any) {
        console.error(
          "[audit-faal] Audit log kon ook met userId=null niet geschreven worden: " +
            (retryErr?.message ?? String(retryErr))
        );
        if (isInTransaction) throw retryErr;
        return null;
      }
    }

    console.error(
      "[audit-faal] Audit log kon niet geschreven worden (actie: " +
        input.action +
        ", entity: " +
        input.entityType +
        "#" +
        input.entityId +
        "): " +
        (auditErr?.message ?? String(auditErr))
    );
    if (isInTransaction) {
      // Gooi de fout door zodat de transactie correct wordt teruggedraaid.
      // Als we de fout hier afvangen, blijft de transactie in een afgebroken
      // staat achter en geven alle volgende queries een 25P02-fout.
      throw auditErr;
    }
    return null;
  }
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
