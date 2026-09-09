import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import type {
  CreateSubscriptionInput,
  OperationContext,
  PaginatedResult,
  SubscriptionFilterParams,
  UpdateSubscriptionInput,
} from "@/types/domain";
import type { UserRole } from "@/types/enums";
import {
  SubscriptionStatus,
  BillingCycle,
  AuditAction,
} from "@/types/enums";
import type { Prisma, Subscription as PrismaSubscription } from "@prisma/client";

export const SUBSCRIPTION_STATUS_TRANSITIONS: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  [SubscriptionStatus.DRAFT]: [
    SubscriptionStatus.PENDING_ACTIVATION,
    SubscriptionStatus.CANCELLED,
  ],
  [SubscriptionStatus.PENDING_ACTIVATION]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLED,
  ],
  [SubscriptionStatus.ACTIVE]: [
    SubscriptionStatus.SUSPENDED,
    SubscriptionStatus.CANCELLED,
    SubscriptionStatus.TERMINATED,
  ],
  [SubscriptionStatus.SUSPENDED]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLED,
    SubscriptionStatus.TERMINATED,
  ],
  [SubscriptionStatus.CANCELLED]: [],
  [SubscriptionStatus.TERMINATED]: [],
};

export class InvalidSubscriptionStatusTransitionError extends Error {
  constructor(
    public readonly from: SubscriptionStatus,
    public readonly to: SubscriptionStatus
  ) {
    super(
      `Ongeldige abonnement transitie: ${String(from)} → ${String(to)}`
    );
    this.name = "InvalidSubscriptionStatusTransitionError";
  }
}

export function canTransitionStatus(
  from: SubscriptionStatus,
  to: SubscriptionStatus
): boolean {
  const allowed = SUBSCRIPTION_STATUS_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

function includeDetail(): Prisma.SubscriptionInclude {
  return {
    customer: {
      select: {
        id: true,
        customerNumber: true,
        companyName: true,
      },
    },
    product: {
      select: {
        id: true,
        productCode: true,
        name: true,
      },
    },
    trackerAssignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" },
      include: {
        tracker: {
          select: {
            id: true,
            serialNumber: true,
            imei: true,
            brand: true,
            model: true,
            status: true,
          },
        },
        vehicle: {
          select: {
            id: true,
            licensePlate: true,
            vin: true,
            brand: true,
            model: true,
          },
        },
      },
    },
    simAssignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" },
      include: {
        sim: {
          select: {
            id: true,
            iccid: true,
            msisdn: true,
            provider: true,
            status: true,
          },
        },
      },
    },
  };
}

export async function findManySubscriptions(
  params: SubscriptionFilterParams & { viewerRole?: UserRole }
): Promise<PaginatedResult<PrismaSubscription>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    customerId,
    productId,
    status,
  } = params;

  const where: Prisma.SubscriptionWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (productId) where.productId = productId;
  if (status) where.status = status as Prisma.SubscriptionStatusFilter;

  if (search) {
    const s = search.trim();
    where.OR = [
      { subscriptionNumber: { contains: s, mode: "insensitive" } },
      { customer: { companyName: { contains: s, mode: "insensitive" } } },
      { product: { name: { contains: s, mode: "insensitive" } } },
      { product: { productCode: { contains: s, mode: "insensitive" } } },
    ];
  }

  const sortKey: keyof Prisma.SubscriptionOrderByWithRelationInput =
    sort === "subscriptionNumber"
      ? "subscriptionNumber"
      : sort === "startDate"
        ? "startDate"
        : sort === "monthlyPrice"
          ? "monthlyPrice"
          : sort === "status"
            ? "status"
            : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true } },
        product: { select: { id: true, name: true, productCode: true } },
      },
      orderBy: { [sortKey]: order } as Prisma.SubscriptionOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data: data as PrismaSubscription[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findSubscriptionById(id: string) {
  return prisma.subscription.findUnique({
    where: { id },
    include: includeDetail(),
  });
}

export async function generateSubscriptionNumber(): Promise<string> {
  const prefix = "SUB";
  const today = new Date();
  const yyyymm = `${today.getFullYear()}${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const last = await prisma.subscription.findFirst({
    where: { subscriptionNumber: { startsWith: `${prefix}-${yyyymm}-` } },
    orderBy: { subscriptionNumber: "desc" },
    select: { subscriptionNumber: true },
  });

  let seq = 1;
  if (last?.subscriptionNumber) {
    const parts = last.subscriptionNumber.split("-");
    const n = Number(parts[parts.length - 1]);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}-${yyyymm}-${String(seq).padStart(4, "0")}`;
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  ctx: OperationContext
): Promise<PrismaSubscription> {
  return prisma.$transaction(async (tx) => {
    let number = input.subscriptionNumber?.trim();
    if (!number) number = await generateSubscriptionNumber();

    const created = await tx.subscription.create({
      data: {
        subscriptionNumber: number,
        customerId: input.customerId,
        productId: input.productId,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: (input.status ?? SubscriptionStatus.DRAFT) as Prisma.SubscriptionStatus,
        monthlyPrice: input.monthlyPrice,
        billingCycle: (input.billingCycle ?? BillingCycle.MONTHLY) as Prisma.BillingCycle,
        notes: input.notes ?? null,
      },
    });

    await logAudit(tx, {
      entityType: "subscription",
      entityId: created.id,
      action: AuditAction.CREATE,
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateSubscription(
  id: string,
  input: UpdateSubscriptionInput,
  ctx: OperationContext
): Promise<PrismaSubscription> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id },
    });

    const data: Prisma.SubscriptionUpdateInput = {};
    const allowedUpdates: Array<keyof UpdateSubscriptionInput> = [
      "customerId",
      "productId",
      "startDate",
      "endDate",
      "monthlyPrice",
      "billingCycle",
      "notes",
    ];
    for (const k of allowedUpdates) {
      const v = input[k];
      if (v !== undefined) (data as any)[k] = v;
    }

    if (Object.keys(data).length === 0) return existing;

    const updated = await tx.subscription.update({ where: { id }, data });
    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "subscription",
        entityId: updated.id,
        action: AuditAction.UPDATE,
        userId: ctx.userId,
        oldValues,
        newValues,
      });
    }
    return updated;
  });
}

export async function updateSubscriptionStatus(
  id: string,
  newStatus: SubscriptionStatus,
  ctx: OperationContext,
  reason?: string | null
): Promise<PrismaSubscription> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id },
    });

    const current = existing.status as unknown as SubscriptionStatus;
    if (!canTransitionStatus(current, newStatus)) {
      throw new InvalidSubscriptionStatusTransitionError(current, newStatus);
    }

    const updated = await tx.subscription.update({
      where: { id },
      data: { status: newStatus as Prisma.SubscriptionStatus },
    });

    await logAudit(tx, {
      entityType: "subscription",
      entityId: updated.id,
      action: AuditAction.STATUS_CHANGE,
      userId: ctx.userId,
      oldValues: { status: String(current) },
      newValues: { status: String(newStatus) },
      metadata: reason ? { reason } : undefined,
    });

    return updated;
  });
}

export async function suspendSubscription(
  id: string,
  ctx: OperationContext,
  reason?: string | null
): Promise<PrismaSubscription> {
  return updateSubscriptionStatus(
    id,
    SubscriptionStatus.SUSPENDED,
    ctx,
    reason
  );
}

export async function resumeSubscription(
  id: string,
  ctx: OperationContext,
  reason?: string | null
): Promise<PrismaSubscription> {
  return updateSubscriptionStatus(
    id,
    SubscriptionStatus.ACTIVE,
    ctx,
    reason
  );
}

export async function cancelSubscription(
  id: string,
  ctx: OperationContext,
  reason?: string | null
): Promise<PrismaSubscription> {
  return updateSubscriptionStatus(
    id,
    SubscriptionStatus.CANCELLED,
    ctx,
    reason
  );
}

export async function terminateSubscription(
  id: string,
  ctx: OperationContext,
  reason?: string | null
): Promise<PrismaSubscription> {
  return updateSubscriptionStatus(
    id,
    SubscriptionStatus.TERMINATED,
    ctx,
    reason
  );
}

export async function getSubscriptionHistoryAssignments(subscriptionId: string) {
  const [trackers, sims] = await Promise.all([
    prisma.trackerAssignment.findMany({
      where: { subscriptionId },
      orderBy: { startAt: "desc" },
      include: {
        tracker: { select: { id: true, serialNumber: true, imei: true } },
        vehicle: { select: { id: true, licensePlate: true } },
      },
    }),
    prisma.simAssignment.findMany({
      where: { subscriptionId },
      orderBy: { startAt: "desc" },
      include: { sim: { select: { id: true, iccid: true, msisdn: true } } },
    }),
  ]);
  return { trackers, sims };
}
