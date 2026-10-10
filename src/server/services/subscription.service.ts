import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { generateSubscriptionNumber } from "@/lib/identifiers";
import {
  pickAuth,
  requirePermission,
  isResellerScope,
  isInternalScope,
  isPartnerOrResellerScope,
} from "@/lib/rbac";
import type {
  PaginatedResult,
  CreateSubscriptionInput,
  UpdateSubscriptionStatusInput,
} from "@/types/domain";
import { UserRole, RoleScope, CustomerType, BillingCycle } from "@/types/enums";
import type { Prisma, Subscription as PrismaSub, $Enums } from "@prisma/client";
import { syncSubscriptionToInserve } from "./inserve-sync.service";
import type { PermissionBits } from "@/types/next-auth";

type SubscriptionStatus = $Enums.SubscriptionStatus;

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerId?: string | null;
  customerScope?: string[];
  permissions?: PermissionBits;
};

const STATUS_TRANSITIONS: Record<
  keyof typeof SubStatus,
  Array<keyof typeof SubStatus>
> = {
  DRAFT: ["PENDING_ACTIVATION", "CANCELLED"],
  PENDING_ACTIVATION: ["ACTIVE", "CANCELLED", "FAILED" as any],
  ACTIVE: ["SUSPENDED", "CANCELLED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "CANCELLED", "TERMINATED"],
  CANCELLED: [],
  TERMINATED: [],
} as any;

const SubStatus = {
  DRAFT: "DRAFT",
  PENDING_ACTIVATION: "PENDING_ACTIVATION",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED",
  TERMINATED: "TERMINATED",
} as const;

export function assertValidSubscriptionTransition(
  current: SubscriptionStatus,
  next: SubscriptionStatus
): void {
  const allowed = STATUS_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next as any)) {
    throw new Error(
      `Ongeldige statuswijziging van ${current} naar ${next} (niet toegestaan).`
    );
  }
}

function includeSub(): Prisma.SubscriptionInclude {
  return {
    customer: {
      select: { id: true, customerNumber: true, companyName: true },
    },
    product: {
      select: { id: true, productCode: true, name: true },
    },
    trackerAssignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" as const },
      include: {
        tracker: {
          select: { id: true, serialNumber: true, imei: true, brand: true, model: true, status: true },
        },
        vehicle: {
          select: { id: true, licensePlate: true, brand: true, model: true },
        },
      },
    },
    simAssignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" as const },
      include: {
        sim: {
          select: { id: true, iccid: true, imsi: true, msisdn: true, provider: true, status: true },
        },
      },
    },
  };
}

export async function findManySubscriptions(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    customerId?: string;
    productId?: string;
    status?: SubscriptionStatus;
    customerScope?: string[];
  }
): Promise<PaginatedResult<PrismaSub>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    customerId,
    productId,
    status,
    customerScope,
  } = params;

  const where: Prisma.SubscriptionWhereInput = { deletedAt: null };
  if (customerScope && customerScope.length > 0) {
    where.customerId = { in: customerScope };
  }
  if (customerId) where.customerId = customerId;
  if (productId) where.productId = productId;
  if (status) where.status = status as any;

  if (search) {
    const s = search.trim();
    where.OR = [
      { subscriptionNumber: { contains: s, mode: "insensitive" } },
      { customer: { companyName: { contains: s, mode: "insensitive" } } },
      { customer: { customerNumber: { contains: s, mode: "insensitive" } } },
      { product: { name: { contains: s, mode: "insensitive" } } },
      { product: { productCode: { contains: s, mode: "insensitive" } } },
    ];
  }

  const sortKey: keyof Prisma.SubscriptionOrderByWithRelationInput =
    sort === "subscriptionNumber"
      ? "subscriptionNumber"
      : sort === "status"
        ? "status"
        : sort === "monthlyPrice"
          ? "monthlyPrice"
          : sort === "startDate"
            ? "startDate"
            : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true, customerNumber: true } },
        product: { select: { id: true, productCode: true, name: true } },
      },
      orderBy: {
        [sortKey]: order,
      } as Prisma.SubscriptionOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data: data as PrismaSub[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findSubscriptionById(id: string, customerScope?: string[]) {
  const where: Prisma.SubscriptionWhereInput = { id, deletedAt: null };
  if (customerScope && customerScope.length > 0) {
    where.customerId = { in: customerScope };
  }
  return prisma.subscription.findFirst({
    where,
    include: includeSub(),
  });
}

export async function createSubscription(
  input: CreateSubscriptionInput,
  ctx: Ctx
): Promise<PrismaSub> {
  await requirePermission(pickAuth(ctx), "create", "subscription");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (!ctx.customerScope.includes(input.customerId)) {
      throw new Error("Customer valt niet binnen je toegang");
    }
  }

  let billingCustomerId: string | null | undefined = input.billingCustomerId;

  if (isResellerScope(ctx.roleScope)) {
    if (!ctx.customerId) {
      throw new Error("Reseller-scope: eigen customerId ontbreekt in sessie.");
    }
    const subCust = await prisma.customer.findUnique({
      where: { id: input.customerId, deletedAt: null },
      select: { parentCustomerId: true, type: true },
    });
    if (!subCust || subCust.parentCustomerId !== ctx.customerId) {
      throw new Error(
        "Reseller kan alleen abonnementen aanmaken voor zijn eigen sub-klanten."
      );
    }
    billingCustomerId = ctx.customerId;
  } else if (isPartnerOrResellerScope(ctx.roleScope)) {
    // PARTNER scope (hierboven is RESELLER al afgehandeld; dit is alleen PARTNER)
    if (!ctx.customerId) {
      throw new Error("Partner-scope: eigen customerId ontbreekt in sessie.");
    }
    const subCust = await prisma.customer.findUnique({
      where: { id: input.customerId, deletedAt: null },
      select: { parentCustomerId: true, type: true },
    });
    if (!subCust || subCust.parentCustomerId !== ctx.customerId) {
      throw new Error(
        "Partner kan alleen abonnementen aanmaken voor zijn eigen sub-klanten."
      );
    }
    billingCustomerId = input.customerId;
  } else if (ctx.roleScope === RoleScope.CUSTOMER) {
    billingCustomerId = input.customerId;
  } else {
    // INTERNAL scope: indien billingCustomerId niet opgegeven, afleiden
    if (billingCustomerId === undefined) {
      const cust = await prisma.customer.findUnique({
        where: { id: input.customerId, deletedAt: null },
        select: { type: true, parentCustomerId: true },
      });
      if (cust && cust.parentCustomerId && cust.type === CustomerType.DIRECT) {
        const parent = await prisma.customer.findUnique({
          where: { id: cust.parentCustomerId, deletedAt: null },
          select: { type: true },
        });
        if (parent && parent.type === CustomerType.RESELLER) {
          billingCustomerId = cust.parentCustomerId;
        } else if (parent && parent.type === CustomerType.PARTNER) {
          billingCustomerId = input.customerId;
        }
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const subscriptionNumber = await generateSubscriptionNumber(tx);
    const created = await tx.subscription.create({
      data: {
        subscriptionNumber,
        customerId: input.customerId,
        billingCustomerId: billingCustomerId ?? null,
        productId: input.productId,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        status: "DRAFT" as any,
        monthlyPrice: input.monthlyPrice,
        billingCycle: input.billingCycle ?? BillingCycle.MONTHLY,
        notes: input.notes ?? null,
      },
    });
    await logAudit(tx, {
      entityType: "subscription",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });
    return created;
  });
}

async function transitionStatus(
  id: string,
  next: SubscriptionStatus,
  ctx: Ctx,
  auditAction: any,
  reason?: string
): Promise<PrismaSub> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!ctx.customerScope.includes(existing.customerId)) {
        throw new Error("Subscription valt niet binnen je toegang");
      }
    }

    assertValidSubscriptionTransition(existing.status, next as any);
    const updated = await tx.subscription.update({
      where: { id },
      data: {
        status: next as any,
        notes: reason
          ? (existing.notes ? `${existing.notes}\n\n[${next}] ${reason}` : `[${next}] ${reason}`)
          : existing.notes,
      },
    });
    await logAudit(tx, {
      entityType: "subscription",
      entityId: updated.id,
      action: auditAction,
      userId: ctx.userId,
      oldValues: { status: existing.status } as any,
      newValues: { status: updated.status, reason } as any,
    });
    return updated;
  });
}

export async function suspendSubscription(id: string, ctx: Ctx, reason?: string) {
  const updated = await transitionStatus(id, "SUSPENDED" as any, ctx, "SUSPEND", reason);
  queueSync(updated.id, ctx);
  return updated;
}

export async function resumeSubscription(id: string, ctx: Ctx) {
  const updated = await transitionStatus(id, "ACTIVE" as any, ctx, "RESUME");
  queueSync(updated.id, ctx);
  return updated;
}

export async function cancelSubscription(id: string, ctx: Ctx, reason?: string) {
  const updated = await transitionStatus(id, "CANCELLED" as any, ctx, "CANCEL", reason);
  queueSync(updated.id, ctx);
  return updated;
}

export async function terminateSubscription(id: string, ctx: Ctx, reason?: string) {
  const updated = await transitionStatus(id, "TERMINATED" as any, ctx, "TERMINATE", reason);
  queueSync(updated.id, ctx);
  return updated;
}

export function enqueueInserveSubscriptionSync(subscriptionId: string, ctx: Ctx): void {
  Promise.resolve()
    .then(() => syncSubscriptionToInserve(subscriptionId, ctx))
    .catch((e) => console.error("[Inserve-queueSync] onverwachte fout:", e));
}

function queueSync(subscriptionId: string, ctx: Ctx): void {
  enqueueInserveSubscriptionSync(subscriptionId, ctx);
}

export async function updateSubscriptionStatus(
  id: string,
  input: UpdateSubscriptionStatusInput,
  ctx: Ctx
): Promise<PrismaSub> {
  if (input.status === "SUSPENDED") return suspendSubscription(id, ctx, input.reason);
  if (input.status === "ACTIVE") return resumeSubscription(id, ctx);
  if (input.status === "CANCELLED") return cancelSubscription(id, ctx, input.reason);
  if (input.status === "TERMINATED") return terminateSubscription(id, ctx, input.reason);
  return transitionStatus(id, input.status, ctx, "UPDATE", input.reason);
}

export async function updateSubscription(
  id: string,
  input: Partial<Pick<CreateSubscriptionInput, "notes" | "billingCycle" | "monthlyPrice" | "endDate" | "billingCustomerId">>,
  ctx: Ctx
): Promise<PrismaSub> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!ctx.customerScope.includes(existing.customerId)) {
        throw new Error("Subscription valt niet binnen je toegang");
      }
    }

    if (input.billingCustomerId !== undefined && !isInternalScope(ctx.roleScope)) {
      if (
        isPartnerOrResellerScope(ctx.roleScope) &&
        input.billingCustomerId !== ctx.customerId &&
        input.billingCustomerId !== existing.customerId
      ) {
        throw new Error(
          "Reseller/Partner mag billingCustomerId niet vrij wijzigen."
        );
      }
    }

    const data: Prisma.SubscriptionUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }
    const updated = await tx.subscription.update({ where: { id }, data });
    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "subscription",
        entityId: updated.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues,
        newValues,
      });
    }
    return updated;
  });
}

export async function softDeleteSubscription(id: string, ctx: Ctx) {
  await requirePermission(pickAuth(ctx), "delete", "subscription");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!ctx.customerScope.includes(existing.customerId)) {
        throw new Error("Subscription valt niet binnen je toegang");
      }
    }

    const updated = await tx.subscription.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await logAudit(tx, {
      entityType: "subscription",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });
    return updated;
  });
}

export async function bulkSoftDeleteSubscriptions(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  await requirePermission(pickAuth(ctx), "delete", "subscription");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const where: Prisma.SubscriptionWhereInput = { id: { in: ids }, deletedAt: null };
    if (ctx.customerScope && ctx.customerScope.length > 0) {
      where.customerId = { in: ctx.customerScope };
    }
    const rows = await tx.subscription.findMany({ where });
    if (!rows.length) return { count: 0, ids: [] };
    const targets = rows.map((r) => r.id);
    const deletedAt = new Date();
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "subscription",
        entityId: r.id,
        action: "DELETE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([
      tx.subscription.updateMany({
        where: { id: { in: targets } },
        data: { deletedAt },
      }),
      ...audits,
    ]);
    return { count: targets.length, ids: targets };
  });
}

export async function bulkCancelSubscriptions(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  await requirePermission(pickAuth(ctx), "delete", "subscription");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const where: Prisma.SubscriptionWhereInput = {
      id: { in: ids },
      deletedAt: null,
      status: { notIn: ["CANCELLED", "TERMINATED"] as any },
    };
    if (ctx.customerScope && ctx.customerScope.length > 0) {
      where.customerId = { in: ctx.customerScope };
    }
    const rows = await tx.subscription.findMany({
      where,
      select: { id: true, status: true },
    });
    if (!rows.length) return { count: 0, ids: [] };
    const targets = rows.map((r) => r.id);
    const updates = targets.map((id) =>
      tx.subscription.update({
        where: { id },
        data: { status: "CANCELLED" as any },
      })
    );
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "subscription",
        entityId: r.id,
        action: "CANCEL",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
        newValues: { status: "CANCELLED" } as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([...updates, ...audits]);
    return { count: targets.length, ids: targets };
  });
}
