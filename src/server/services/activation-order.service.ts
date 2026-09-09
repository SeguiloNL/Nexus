import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { generateOrderNumber, generateSubscriptionNumber } from "@/lib/identifiers";
import type { Prisma, ActivationOrder } from "@prisma/client";
import {
  assignSim,
  assignTracker,
} from "./assignments.service";
import type {
  CreateActivationOrderInput,
  UpdateActivationOrderInput,
} from "@/server/validators/activationOrder";
import type { UserRole } from "@/types/enums";

type Ctx = { userId: string; userRole: UserRole };

const READY_TRANSITIONS = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["READY", "CANCELLED"],
  CANCELLED: [],
} as const;

type AoKey = keyof typeof READY_TRANSITIONS;

export function assertOrderTransition(
  cur: string,
  next: AoKey
) {
  const arr = (READY_TRANSITIONS as any)[cur] ?? [];
  if (!arr.includes(next)) {
    throw new Error(`Ongeldige order statuswijziging ${cur} → ${next}`);
  }
}

export async function findManyActivationOrders(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    customerId?: string;
    status?: string;
  }
) {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    customerId,
    status,
  } = params;

  const where: Prisma.ActivationOrderWhereInput = {};
  if (customerId) where.customerId = customerId;
  if (status) where.status = status as any;
  if (search) {
    const s = search.trim();
    where.OR = [
      { orderNumber: { contains: s, mode: "insensitive" } },
      { tracker: { serialNumber: { contains: s, mode: "insensitive" } } },
      { tracker: { imei: { contains: s, mode: "insensitive" } } },
      { sim: { iccid: { contains: s, mode: "insensitive" } } },
      { sim: { msisdn: { contains: s, mode: "insensitive" } } },
      { customer: { companyName: { contains: s, mode: "insensitive" } } },
      { customer: { customerNumber: { contains: s, mode: "insensitive" } } },
    ];
  }
  const sortKey: keyof Prisma.ActivationOrderOrderByWithRelationInput =
    sort === "orderNumber"
      ? "orderNumber"
      : sort === "status"
        ? "status"
        : sort === "desiredStartDate"
          ? "desiredStartDate"
          : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.activationOrder.count({ where }),
    prisma.activationOrder.findMany({
      where,
      include: {
        customer: {
          select: { id: true, customerNumber: true, companyName: true },
        },
        product: { select: { id: true, productCode: true, name: true } },
        tracker: {
          select: { id: true, serialNumber: true, imei: true, brand: true, model: true },
        },
        sim: { select: { id: true, iccid: true, imsi: true, msisdn: true } },
        vehicle: { select: { id: true, licensePlate: true, brand: true, model: true } },
        subscription: {
          select: { id: true, subscriptionNumber: true, status: true },
        },
      },
      orderBy: {
        [sortKey]: order,
      } as Prisma.ActivationOrderOrderByWithRelationInput,
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

export async function findActivationOrderById(id: string) {
  return prisma.activationOrder.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, customerNumber: true, companyName: true } },
      subCustomer: { select: { id: true, customerNumber: true, companyName: true } },
      product: { select: { id: true, productCode: true, name: true } },
      subscription: { select: { id: true, subscriptionNumber: true, status: true, monthlyPrice: true } },
      tracker: {
        select: { id: true, serialNumber: true, imei: true, brand: true, model: true, status: true },
      },
      sim: {
        select: { id: true, iccid: true, imsi: true, msisdn: true, provider: true, status: true },
      },
      vehicle: { select: { id: true, licensePlate: true, brand: true, model: true, vin: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function createDraftOrder(
  input: CreateActivationOrderInput,
  ctx: Ctx
): Promise<ActivationOrder> {
  return prisma.$transaction(async (tx) => {
    const orderNumber = await generateOrderNumber();
    const order = await tx.activationOrder.create({
      data: {
        orderNumber,
        customerId: input.customerId,
        subCustomerId: input.subCustomerId ?? null,
        productId: input.productId,
        desiredStartDate: input.desiredStartDate,
        monthlyPrice: input.monthlyPrice,
        billingCycle: input.billingCycle ?? "MONTHLY",
        trackerId: input.trackerId ?? null,
        simId: input.simId ?? null,
        vehicleId: input.vehicleId ?? null,
        internalNotes: input.internalNotes ?? null,
        status: "DRAFT" as any,
        createdById: ctx.userId,
      },
    });
    await logAudit(tx, {
      entityType: "activationOrder",
      entityId: order.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: order as unknown as Record<string, unknown>,
    });
    return order;
  });
}

export async function updateOrder(
  id: string,
  input: Partial<UpdateActivationOrderInput>,
  ctx: Ctx
): Promise<ActivationOrder> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });
    if (existing.status !== "DRAFT") {
      throw new Error(
        `Alleen DRAFT orders kunnen bewerkt worden (huidige status: ${existing.status}).`
      );
    }
    const data: Prisma.ActivationOrderUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }
    const updated = await tx.activationOrder.update({ where: { id }, data });
    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "activationOrder",
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

export async function markReady(id: string, ctx: Ctx): Promise<ActivationOrder> {
  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
      include: {
        tracker: true,
        sim: true,
        customer: true,
        product: true,
      },
    });
    assertOrderTransition(existing.status, "READY");

    const missing: string[] = [];
    if (!existing.customer) missing.push("klant");
    if (!existing.product) missing.push("product");
    if (!existing.tracker) missing.push("tracker");
    else if (existing.tracker.status !== "IN_STOCK" && existing.tracker.status !== "RESERVED") {
      missing.push(`tracker status moet IN_STOCK/RESERVED (nu ${existing.tracker.status})`);
    }
    if (!existing.sim) missing.push("sim");
    else if (existing.sim.status !== "IN_STOCK" && existing.sim.status !== "RESERVED") {
      missing.push(`SIM status moet IN_STOCK/RESERVED (nu ${existing.sim.status})`);
    }
    if (!existing.desiredStartDate) missing.push("gewenste startdatum");
    if (!existing.monthlyPrice) missing.push("maandprijs");

    if (missing.length) {
      throw new Error(
        `Nog niet READY: ontbrekend of ongeldig: ${missing.join(", ")}.`
      );
    }
    const updated = await tx.activationOrder.update({
      where: { id },
      data: { status: "READY" as any },
    });
    await logAudit(tx, {
      entityType: "activationOrder",
      entityId: updated.id,
      action: "UPDATE",
      userId: ctx.userId,
      oldValues: { status: existing.status } as any,
      newValues: { status: updated.status } as any,
    });
    return updated;
  });
}

export async function cancelOrder(
  id: string,
  ctx: Ctx,
  reason?: string
): Promise<ActivationOrder> {
  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });
    assertOrderTransition(existing.status, "CANCELLED");
    const updated = await tx.activationOrder.update({
      where: { id },
      data: {
        status: "CANCELLED" as any,
        internalNotes: reason
          ? `${existing.internalNotes ? `${existing.internalNotes}\n\n` : ""}[CANCELLED] ${reason}`
          : existing.internalNotes,
      },
    });
    await logAudit(tx, {
      entityType: "activationOrder",
      entityId: updated.id,
      action: "CANCEL",
      userId: ctx.userId,
      oldValues: { status: existing.status } as any,
      newValues: { status: updated.status, reason } as any,
    });
    return updated;
  });
}

export async function retryFailed(id: string, ctx: Ctx): Promise<ActivationOrder> {
  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });
    assertOrderTransition(existing.status, "READY");
    const updated = await tx.activationOrder.update({
      where: { id },
      data: {
        status: "READY" as any,
        failureReason: existing.failureReason,
        failedAt: existing.failedAt,
      },
    });
    await logAudit(tx, {
      entityType: "activationOrder",
      entityId: updated.id,
      action: "UPDATE",
      userId: ctx.userId,
      oldValues: { status: existing.status } as any,
      newValues: { status: updated.status } as any,
    });
    return updated;
  });
}

async function markFailed(
  tx: any,
  id: string,
  reason: string,
  userId: string
) {
  const updated = await tx.activationOrder.update({
    where: { id },
    data: {
      status: "FAILED" as any,
      failureReason: reason,
      failedAt: new Date(),
    },
  });
  await logAudit(tx, {
    entityType: "activationOrder",
    entityId: updated.id,
    action: "FAIL_ACTIVATION",
    userId,
    newValues: { status: "FAILED", failureReason: reason } as any,
  });
  return updated;
}

/**
 * De 6-staps transactionele activatie zoals spec.md §5.
 * Isolation level Serializable om races (AC-5) af te vangen.
 */
export async function completeActivation(id: string, ctx: Ctx) {
  return prisma.$transaction(async (tx) => {
    const order: any = await tx.activationOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        product: true,
        tracker: true,
        sim: true,
        vehicle: true,
      },
    });
    if (!order) throw new Error("Order niet gevonden");
    if (order.status !== "READY" && order.status !== "FAILED") {
      throw new Error(`Alleen READY of FAILED orders kunnen geactiveerd worden (status ${order.status}).`);
    }
    if (!order.tracker || !order.sim || !order.customer || !order.product) {
      throw new Error(
        `Incomplete order: ontbreekt ${!order.customer ? "klant " : ""}${!order.product ? "product " : ""}${!order.tracker ? "tracker " : ""}${!order.sim ? "SIM" : ""}`
      );
    }

    // 1. Mark order PROCESSING
    await tx.activationOrder.update({
      where: { id },
      data: { status: "PROCESSING" as any },
    });

    try {
      // 2 + 3. Re-lock & re-check assets status + geen actieve assignment
      const tracker = await tx.tracker.findUnique({
        where: { id: order.tracker.id, deletedAt: null },
      });
      if (!tracker || (tracker.status !== "IN_STOCK" && tracker.status !== "RESERVED")) {
        throw new Error(
          `Tracker status veranderd: nu ${tracker?.status ?? "deleted"}`
        );
      }
      const sim = await tx.sIM.findUnique({
        where: { id: order.sim.id, deletedAt: null },
      });
      if (!sim || (sim.status !== "IN_STOCK" && sim.status !== "RESERVED")) {
        throw new Error(`SIM status veranderd: nu ${sim?.status ?? "deleted"}`);
      }

      const hasTrackerAssign = await tx.trackerAssignment.findFirst({
        where: { trackerId: order.tracker.id, endAt: null },
      });
      if (hasTrackerAssign) {
        throw new Error(`Tracker heeft reeds een actieve assignment.`);
      }
      const hasSimAssign = await tx.simAssignment.findFirst({
        where: { simId: order.sim.id, endAt: null },
      });
      if (hasSimAssign) {
        throw new Error(`SIM heeft reeds een actieve assignment.`);
      }

      // 4. Maak subscription PENDING_ACTIVATION, direct ACTIVE
      const subNumber = await generateSubscriptionNumber(tx as any);
      const subscription = await tx.subscription.create({
        data: {
          subscriptionNumber: subNumber,
          customerId: order.customerId,
          productId: order.productId,
          startDate: order.desiredStartDate,
          monthlyPrice: order.monthlyPrice,
          billingCycle: order.billingCycle,
          status: "PENDING_ACTIVATION" as any,
          notes: order.internalNotes,
        },
      });
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE" as any },
      });

      // 5. Assignments + asset status updates ACTIVE
      const trackerUpdated = await tx.tracker.update({
        where: { id: order.tracker.id },
        data: { status: "ACTIVE" as any },
      });
      const simUpdated = await tx.sIM.update({
        where: { id: order.sim.id },
        data: { status: "ACTIVE" as any },
      });

      await tx.trackerAssignment.create({
        data: {
          subscriptionId: subscription.id,
          trackerId: order.tracker.id,
          vehicleId: order.vehicleId ?? null,
          startAt: new Date(),
          reason: "INITIAL" as any,
          createdById: ctx.userId,
        },
      });

      await tx.simAssignment.create({
        data: {
          subscriptionId: subscription.id,
          simId: order.sim.id,
          startAt: new Date(),
          reason: "INITIAL" as any,
          createdById: ctx.userId,
        },
      });

      // 6. Mark order COMPLETED, link subscriptionId
      const completed = await tx.activationOrder.update({
        where: { id },
        data: {
          status: "COMPLETED" as any,
          subscriptionId: subscription.id,
          completedAt: new Date(),
        },
      });

      await logAudit(tx, {
        entityType: "subscription",
        entityId: subscription.id,
        action: "CREATE",
        userId: ctx.userId,
        newValues: {
          subscriptionNumber: subNumber,
          status: "ACTIVE",
          orderId: order.id,
        } as any,
      });
      await logAudit(tx, {
        entityType: "activationOrder",
        entityId: completed.id,
        action: "COMPLETE_ACTIVATION",
        userId: ctx.userId,
        newValues: {
          subscriptionId: subscription.id,
          trackerId: trackerUpdated.id,
          simId: simUpdated.id,
        } as any,
      });

      return { order: completed, subscription };
    } catch (err: any) {
      await markFailed(
        tx,
        id,
        err?.message ? err.message : "Onbekende fout tijdens activatie.",
        ctx.userId
      );
      throw err;
    }
  }, { isolationLevel: "Serializable" });
}
