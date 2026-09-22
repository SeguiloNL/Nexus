import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { generateOrderNumber, generateSubscriptionNumber } from "@/lib/identifiers";
import type { Prisma, ActivationOrder } from "@prisma/client";
import {
  assignSim,
  assignTracker,
} from "./assignments.service";
import { enqueueInserveSubscriptionSync } from "./subscription.service";
import type {
  CreateActivationOrderInput,
  UpdateActivationOrderInput,
} from "@/server/validators/activationOrder";
import type { UserRole } from "@/types/enums";

import {
  activateSim as simhuisActivateSim,
  getSimStatus as simhuisGetSimStatus,
  deactivateSim as simhuisDeactivateSim,
  simhuisClient,
} from "../integrations/simhuis/service";
import type { SimhuisSimStatus } from "../integrations/simhuis/types";
import { getSimhuisSettings } from "./app-setting.service";

import {
  registerTracker as navixyRegisterTracker,
  getTracker as navixyGetTracker,
  suspendTracker as navixySuspendTracker,
  deleteTracker as navixyDeleteTracker,
  navixyClient,
} from "../integrations/navixy/service";
import type { NavixyTracker } from "../integrations/navixy/types";

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
      entityType: "activation_order",
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
        entityType: "activation_order",
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
      entityType: "activation_order",
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
      entityType: "activation_order",
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
      entityType: "activation_order",
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
    entityType: "activation_order",
    entityId: updated.id,
    action: "FAIL_ACTIVATION",
    userId,
    newValues: { status: "FAILED", failureReason: reason } as any,
  });
  return updated;
}

async function markFailedTx(
  id: string,
  reason: string,
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.activationOrder.update({
      where: { id },
      data: {
        status: "FAILED" as any,
        failureReason: reason,
        failedAt: new Date(),
      },
    });
    await logAudit(tx, {
      entityType: "activation_order",
      entityId: updated.id,
      action: "FAIL_ACTIVATION",
      userId,
      newValues: { status: "FAILED", failureReason: reason } as any,
    });
    return updated;
  });
}

function buildDeviceModel(brand: string | null | undefined, model: string | null | undefined): string {
  const parts = [brand ?? "", model ?? ""].map(p => String(p ?? "").trim()).filter(Boolean);
  if (parts.length === 0) return "generic";
  return parts.join(" ");
}

/**
 * Saga-patroon completeActivation:
 *  0. Preflight: order exists + status OK
 *  1. Markeer PROCESSING (binnen transactie)
 *  2. Externe stap 1: Activeer SIM bij Simhuis (idempotent, skip indien reeds actief of NIET geconfigureerd)
 *  3. Externe stap 2: Registreer tracker bij Navixy met device_model (idempotent, skip indien NIET geconfigureerd)
 *     → Bij falen Navixy: compensatie (deactiveer SIM indien stap 2a geslaagd)
 *  4. Interne transactie: Re-lock assets, assignments, subscription, COMPLETED
 *     → Bij falen interne transactie: best-effort compensatie (suspend tracker + deactivate SIM)
 *  5. Na succes: Inserve sync queue.
 */
export async function completeActivation(id: string, ctx: Ctx) {
  const initial = await prisma.activationOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      product: true,
      tracker: true,
      sim: true,
      vehicle: true,
    },
  });
  if (!initial) throw new Error("Order niet gevonden");
  if (initial.status !== "READY" && initial.status !== "FAILED") {
    throw new Error(`Alleen READY of FAILED orders kunnen geactiveerd worden (status ${initial.status}).`);
  }
  if (!initial.tracker || !initial.sim || !initial.customer || !initial.product) {
    throw new Error(
      `Incomplete order: ontbreekt ${!initial.customer ? "klant " : ""}${!initial.product ? "product " : ""}${!initial.tracker ? "tracker " : ""}${!initial.sim ? "SIM" : ""}`
    );
  }

  // --- STAP 1: Mark order PROCESSING (altijd, zodat UI inzicht heeft) ---
  await prisma.$transaction(async (tx) => {
    await tx.activationOrder.update({
      where: { id },
      data: { status: "PROCESSING" as any },
    });
  });

  const rollbackCtx: {
    simActivated: SimhuisSimStatus | null;
    navixyTracker: NavixyTracker | null;
  } = { simActivated: null, navixyTracker: null };

  try {
    // --- STAP 2: SIM activeren (Simhuis) ---
    const simhuisConfigured = await simhuisClient.isConfigured();
    if (simhuisConfigured) {
      try {
        const simhuisSettings = await getSimhuisSettings();
        const defaultOfferId = simhuisSettings?.defaultOfferId ?? null;
        const defaultPlanId = simhuisSettings?.defaultPlanId ?? null;
        const resellerId = simhuisSettings?.resellerId ?? null;

        if (defaultOfferId || defaultPlanId) {
          console.info(
            `[Activation] Standaard Simhuis-product: offer_id=${defaultOfferId ?? "-"}, plan_id=${defaultPlanId ?? "-"} (reseller_id=${resellerId ?? "-"})`
          );
        }

        const preStatus = await simhuisGetSimStatus(initial.sim.iccid);
        if (preStatus.status === "active") {
          console.info(`[Activation] SIM ${initial.sim.iccid} reeds actief in Simhuis — overslaan`);
          rollbackCtx.simActivated = preStatus;
        } else {
          const activated = await simhuisActivateSim({
            iccid: initial.sim.iccid,
            customerRef: initial.customer.customerNumber ?? `${initial.customer.id}`,
            offerId: defaultOfferId,
            planId: defaultPlanId,
            resellerId: resellerId,
          });
          rollbackCtx.simActivated = activated;
        }
      } catch (simErr: any) {
        const msg = `Simhuis activatie mislukt voor SIM ${initial.sim.iccid}: ${simErr?.message ?? simErr}`;
        console.error(`[Activation] ${msg}`);
        await markFailedTx(id, msg, ctx.userId);
        throw new Error(msg);
      }
    } else {
      console.info("[Activation] Simhuis niet geconfigureerd (username/password leeg) — skip SIM activatie");
    }

    // --- STAP 3: Tracker registreren (Navixy) ---
    const navixyConfigured = await navixyClient.isConfigured();
    if (navixyConfigured) {
      try {
        const deviceModel = buildDeviceModel(initial.tracker.brand, initial.tracker.model);
        const label = initial.tracker.serialNumber
          ? `${initial.tracker.serialNumber} (${initial.customer.companyName ?? initial.customerId})`
          : `${initial.customer.companyName ?? initial.customerId} - ${initial.orderNumber}`;

        const registered = await navixyRegisterTracker({
          imei: initial.tracker.imei,
          deviceModel,
          label,
        });
        rollbackCtx.navixyTracker = registered;
      } catch (navErr: any) {
        // Compensatie: SIM deactiveren (indien geactiveerd)
        if (rollbackCtx.simActivated) {
          console.warn(`[Activation] Navixy registratie mislukt — proberen SIM ${initial.sim.iccid} te deactiveren`);
          try {
            await simhuisDeactivateSim(initial.sim.iccid);
          } catch (rbErr: any) {
            console.error(`[Activation] ⚠️ Compensatie SIM deactiveren mislukt (Handmatig actie vereist): ${rbErr?.message ?? rbErr}`);
          }
        }
        const msg = `Navixy tracker registratie mislukt (IMEI ${initial.tracker.imei}): ${navErr?.message ?? navErr}`;
        console.error(`[Activation] ${msg}`);
        await markFailedTx(id, msg, ctx.userId);
        throw new Error(msg);
      }
    } else {
      console.info("[Activation] Navixy niet geconfigureerd (credentials leeg) — skip tracker registratie");
    }

    // --- STAP 4: Interne transactionele stappen (originele flow) ---
    const result = await prisma.$transaction(async (tx) => {
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
      if (!order) throw new Error("Order niet gevonden tijdens interne stap");
      if (order.status !== "PROCESSING") {
        throw new Error(`Order onverwachte status in interne stap: ${order.status}`);
      }

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
        entityType: "activation_order",
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
    }, { isolationLevel: "Serializable" });

    // --- STAP 5: Async externe syncs (geen blokking) ---
    enqueueInserveSubscriptionSync(result.subscription.id, ctx);
    return result;
  } catch (err: any) {
    const isAlreadyMarkedFailed = (err?.message ?? "").startsWith("Simhuis")
      || (err?.message ?? "").startsWith("Navixy");

    // Best-effort compensatie indien interne transactie of onverwachte fout
    if (!isAlreadyMarkedFailed) {
      if (rollbackCtx.navixyTracker) {
        console.warn(`[Activation] Interne stap mislukt — proberen Navixy tracker ${rollbackCtx.navixyTracker.id} te deactiveren`);
        try {
          await navixySuspendTracker(rollbackCtx.navixyTracker.id, true);
        } catch (rbErr: any) {
          console.error(`[Activation] ⚠️ Compensatie Navixy suspend mislukt: ${rbErr?.message ?? rbErr}`);
        }
      }
      if (rollbackCtx.simActivated && !rollbackCtx.simActivated.status) {
        console.warn(`[Activation] Interne stap mislukt — proberen SIM ${initial.sim.iccid} te deactiveren`);
        try {
          await simhuisDeactivateSim(initial.sim.iccid);
        } catch (rbErr: any) {
          console.error(`[Activation] ⚠️ Compensatie SIM deactiveren mislukt: ${rbErr?.message ?? rbErr}`);
        }
      }

      const msg = err?.message ? err.message : "Onbekende fout tijdens activatie.";
      try {
        await markFailedTx(id, msg, ctx.userId);
      } catch (markErr) {
        console.error(`[Activation] konden order niet op FAILED zetten:`, markErr);
      }
    }
    throw err;
  }
}
