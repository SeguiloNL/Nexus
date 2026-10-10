import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { generateOrderNumber, generateSubscriptionNumber } from "@/lib/identifiers";
import { pickAuth, requirePermission } from "@/lib/rbac";
import type { Prisma, ActivationOrder, DataPlan } from "@prisma/client";
import { ActivationOrderProductType, BillingCycle, CustomerLinkSource } from "@/types/enums";
import {
  assignSim,
  assignTracker,
} from "./assignments.service";
import { enqueueInserveSubscriptionSync } from "./subscription.service";
import type {
  CreateActivationOrderInput,
  UpdateActivationOrderInput,
} from "@/server/validators/activationOrder";
import type { UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

import {
  activateSim as simhuisActivateSim,
  getSimStatus as simhuisGetSimStatus,
  deactivateSim as simhuisDeactivateSim,
} from "../integrations/simhuis/service";
import {
  initializeProviderRegistry,
  providerRegistry,
} from "@/server/providers/registry";
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

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerScope?: string[];
  permissions?: PermissionBits;
};

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
    customerScope?: string[];
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
    customerScope,
  } = params;

  const where: Prisma.ActivationOrderWhereInput = {};

  if (customerScope && customerScope.length > 0) {
    where.AND = [
      {
        OR: [
          { customerId: { in: customerScope } },
          { subCustomerId: { in: customerScope } },
        ],
      },
    ];
  }

  if (customerId) where.customerId = customerId;
  if (status) where.status = status as any;
  if (search) {
    const s = search.trim();
    const searchOr: Prisma.ActivationOrderWhereInput = {
      OR: [
        { orderNumber: { contains: s, mode: "insensitive" } },
        { tracker: { serialNumber: { contains: s, mode: "insensitive" } } },
        { tracker: { imei: { contains: s, mode: "insensitive" } } },
        { sim: { iccid: { contains: s, mode: "insensitive" } } },
        { sim: { msisdn: { contains: s, mode: "insensitive" } } },
        { customer: { companyName: { contains: s, mode: "insensitive" } } },
        { customer: { customerNumber: { contains: s, mode: "insensitive" } } },
      ],
    };
    if (where.AND) {
      (where.AND as any[]).push(searchOr);
    } else {
      Object.assign(where, searchOr);
    }
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
        dataPlan: { select: { id: true, name: true, dataAmountBytes: true, dataAmountDisplayUnit: true } },
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

export async function findActivationOrderById(id: string, customerScope?: string[]) {
  const where: Prisma.ActivationOrderWhereInput = { id };
  if (customerScope && customerScope.length > 0) {
    where.OR = [
      { customerId: { in: customerScope } },
      { subCustomerId: { in: customerScope } },
    ];
  }
  return prisma.activationOrder.findFirst({
    where,
    include: {
      customer: { select: { id: true, customerNumber: true, companyName: true } },
      subCustomer: { select: { id: true, customerNumber: true, companyName: true } },
      product: { select: { id: true, productCode: true, name: true } },
      dataPlan: { select: { id: true, name: true, dataAmountBytes: true, dataAmountDisplayUnit: true, monthlyPrice: true, currency: true, validityDays: true, validityBillingCycle: true, provider: true, providerPlanRef: true, providerOfferRef: true, isActive: true, simOnlyAvailable: true } },
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
  await requirePermission(pickAuth(ctx), "create", "activation_order");

  const orderType = input.orderType ?? ActivationOrderProductType.TRACKER_WITH_SIM;

  // Sim-only bestellingen vereisen een extra recht (zowel UI als backend guard)
  if (orderType === ActivationOrderProductType.SIM_ONLY_DATA) {
    await requirePermission(pickAuth(ctx), "sim_only_order", "activation_order");
  }

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (!ctx.customerScope.includes(input.customerId)) {
      throw new Error("Customer valt niet binnen je toegang");
    }
    if (input.subCustomerId && !ctx.customerScope.includes(input.subCustomerId)) {
      throw new Error("Sub-customer valt niet binnen je toegang");
    }
  }

  return prisma.$transaction(async (tx) => {
    let snapshotData: any = null;
    if (input.dataPlanId) {
      const plan: DataPlan | null = await tx.dataPlan.findUnique({
        where: { id: input.dataPlanId },
      });
      if (plan) {
        snapshotData = {
          id: plan.id,
          name: plan.name,
          dataAmountBytes: plan.dataAmountBytes ? plan.dataAmountBytes.toString() : null,
          dataAmountDisplayUnit: plan.dataAmountDisplayUnit,
          monthlyPrice: plan.monthlyPrice ? plan.monthlyPrice.toString() : null,
          currency: plan.currency,
          provider: plan.provider,
          providerPlanRef: plan.providerPlanRef,
          providerOfferRef: plan.providerOfferRef,
          isActive: plan.isActive,
          simOnlyAvailable: plan.simOnlyAvailable,
        };
      }
    }

    const orderNumber = await generateOrderNumber();
    const order = await tx.activationOrder.create({
      data: {
        orderNumber,
        customerId: input.customerId,
        subCustomerId: input.subCustomerId ?? null,
        productId: input.productId,
        dataPlanId: input.dataPlanId ?? null,
        orderType: orderType as any,
        dataPlanSnapshot: snapshotData,
        desiredStartDate: input.desiredStartDate,
        monthlyPrice: input.monthlyPrice,
        billingCycle: input.billingCycle ?? BillingCycle.MONTHLY,
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
  await requirePermission(pickAuth(ctx), "edit", "activation_order");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const customerInScope = existing.customerId && ctx.customerScope.includes(existing.customerId);
      const subCustomerInScope = existing.subCustomerId && ctx.customerScope.includes(existing.subCustomerId);
      if (!customerInScope && !subCustomerInScope) {
        throw new Error("Activation order valt niet binnen je toegang");
      }
      if (input.customerId && !ctx.customerScope.includes(input.customerId)) {
        throw new Error("Nieuwe customer valt niet binnen je toegang");
      }
      if (input.subCustomerId && !ctx.customerScope.includes(input.subCustomerId)) {
        throw new Error("Nieuwe sub-customer valt niet binnen je toegang");
      }
    }

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
  await requirePermission(pickAuth(ctx), "edit", "activation_order");

  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
      include: {
        tracker: true,
        sim: true,
        customer: true,
        product: true,
        dataPlan: true,
      },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const customerInScope = existing.customerId && ctx.customerScope.includes(existing.customerId);
      const subCustomerInScope = existing.subCustomerId && ctx.customerScope.includes(existing.subCustomerId);
      if (!customerInScope && !subCustomerInScope) {
        throw new Error("Activation order valt niet binnen je toegang");
      }
    }

    assertOrderTransition(existing.status, "READY");

    const orderType: ActivationOrderProductType = existing.orderType || ActivationOrderProductType.TRACKER_WITH_SIM;
    const isSimOnly = orderType === ActivationOrderProductType.SIM_ONLY_DATA;

    if (isSimOnly) {
      await requirePermission(pickAuth(ctx), "sim_only_order", "activation_order");
    }

    const missing: string[] = [];
    if (!existing.customer) missing.push("klant");
    if (!existing.product) missing.push("product");

    if (!isSimOnly) {
      if (!existing.tracker) missing.push("tracker");
      else if (existing.tracker.status !== "IN_STOCK" && existing.tracker.status !== "RESERVED") {
        missing.push(`tracker status moet IN_STOCK/RESERVED (nu ${existing.tracker.status})`);
      }
    }

    if (!existing.sim) missing.push("sim");
    else if (existing.sim.status !== "IN_STOCK" && existing.sim.status !== "RESERVED") {
      missing.push(`SIM status moet IN_STOCK/RESERVED (nu ${existing.sim.status})`);
    }

    if (isSimOnly) {
      if (!existing.dataPlan) missing.push("dataplan");
      else {
        if (!existing.dataPlan.isActive) missing.push("dataplan is inactief");
        if (!existing.dataPlan.simOnlyAvailable) missing.push("dataplan is niet beschikbaar voor Sim-only bestellingen");
      }
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
  await requirePermission(pickAuth(ctx), "edit", "activation_order");

  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const customerInScope = existing.customerId && ctx.customerScope.includes(existing.customerId);
      const subCustomerInScope = existing.subCustomerId && ctx.customerScope.includes(existing.subCustomerId);
      if (!customerInScope && !subCustomerInScope) {
        throw new Error("Activation order valt niet binnen je toegang");
      }
    }

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
  await requirePermission(pickAuth(ctx), "edit", "activation_order");

  return prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const customerInScope = existing.customerId && ctx.customerScope.includes(existing.customerId);
      const subCustomerInScope = existing.subCustomerId && ctx.customerScope.includes(existing.subCustomerId);
      if (!customerInScope && !subCustomerInScope) {
        throw new Error("Activation order valt niet binnen je toegang");
      }
    }

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

export async function deleteOrder(id: string, ctx: Ctx): Promise<void> {
  await requirePermission(pickAuth(ctx), "delete", "activation_order");

  await prisma.$transaction(async (tx) => {
    const existing: any = await tx.activationOrder.findUniqueOrThrow({
      where: { id },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const customerInScope = existing.customerId && ctx.customerScope.includes(existing.customerId);
      const subCustomerInScope = existing.subCustomerId && ctx.customerScope.includes(existing.subCustomerId);
      if (!customerInScope && !subCustomerInScope) {
        throw new Error("Activation order valt niet binnen je toegang");
      }
    }

    const PROTECTED_STATUS = ["PROCESSING"] as const;
    if (PROTECTED_STATUS.includes(existing.status as typeof PROTECTED_STATUS[number])) {
      throw new Error(
        `Orders met status "${existing.status}" kunnen niet verwijderd worden. Wacht tot de order verwerkt is of annuleer hem eerst.`
      );
    }
    await logAudit(tx, {
      entityType: "activation_order",
      entityId: existing.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });
    await tx.activationOrder.delete({
      where: { id },
    });
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
 *  3. Externe stap 2: Registreer tracker bij Navixy met device_model (idempotent, skip indien NIET geconfigureerd OF SIM_ONLY order)
 *     → Bij falen Navixy: compensatie (deactiveer SIM indien stap 2a geslaagd)
 *  4. Interne transactie: Re-lock assets, assignments, subscription, COMPLETED
 *     → Bij SIM_ONLY: skip tracker assignment, tracker status update, Navixy-koppeling
 *     → Bij falen interne transactie: best-effort compensatie (suspend tracker + deactivate SIM)
 *  5. Na succes: Inserve sync queue.
 */
export async function completeActivation(id: string, ctx: Ctx) {
  await requirePermission(pickAuth(ctx), "edit", "activation_order");

  const initial = await prisma.activationOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      product: true,
      dataPlan: true,
      tracker: true,
      sim: true,
      vehicle: true,
    },
  });
  if (!initial) throw new Error("Order niet gevonden");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    const customerInScope = initial.customerId && ctx.customerScope.includes(initial.customerId);
    const subCustomerInScope = initial.subCustomerId && ctx.customerScope.includes(initial.subCustomerId);
    if (!customerInScope && !subCustomerInScope) {
      throw new Error("Activation order valt niet binnen je toegang");
    }
  }

  if (initial.status !== "READY" && initial.status !== "FAILED") {
    throw new Error(`Alleen READY of FAILED orders kunnen geactiveerd worden (status ${initial.status}).`);
  }

  const orderType: ActivationOrderProductType = (initial as any).orderType || ActivationOrderProductType.TRACKER_WITH_SIM;
  const isSimOnly = orderType === ActivationOrderProductType.SIM_ONLY_DATA;

  if (isSimOnly) {
    await requirePermission(pickAuth(ctx), "sim_only_order", "activation_order");
  }

  // Validatie van optionele/verplichte velden per order type
  if (isSimOnly) {
    if (!initial.sim || !initial.customer || !initial.product) {
      throw new Error(
        `Incomplete Sim-only order: ontbreekt ${!initial.customer ? "klant " : ""}${!initial.product ? "product " : ""}${!initial.sim ? "SIM " : ""}${!(initial as any).dataPlan ? "dataplan" : ""}`
      );
    }
  } else {
    if (!initial.tracker || !initial.sim || !initial.customer || !initial.product) {
      throw new Error(
        `Incomplete order: ontbreekt ${!initial.customer ? "klant " : ""}${!initial.product ? "product " : ""}${!initial.tracker ? "tracker " : ""}${!initial.sim ? "SIM" : ""}`
      );
    }
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
    // --- STAP 2: SIM activeren (via provider-registry) ---
    await initializeProviderRegistry();
    const adapter = initial.sim
      ? await providerRegistry.resolveForSim(initial.sim as { providerKey?: string | null; provider?: string | null })
      : await providerRegistry.require("simhuis");
    const simProviderConfigured = await providerRegistry.isConfigured(adapter.providerKey);
    if (simProviderConfigured) {
      if (!adapter.capabilities.activateSim) {
        const msg = `Provider “${adapter.providerKey}” ondersteunt geen SIM-activatie (capability activateSim=false).`;
        console.error(`[Activation] ${msg}`);
        await markFailedTx(id, msg, ctx.userId);
        throw new Error(msg);
      }
      await providerRegistry.guardActivated(adapter.providerKey);
      try {
        // Default producten: eerst adapter.getDefaultProducts, fallback op getSimhuisSettings
        const adapterDefaults =
          (await adapter.getDefaultProducts?.()) ??
          { defaultOfferId: null, defaultPlanId: null, defaultProductName: null, resellerId: null };
        const simhuisSettings =
          adapter.providerKey === "simhuis" ? await getSimhuisSettings() : null;
        const defaultOfferId =
          adapterDefaults.defaultOfferId ?? simhuisSettings?.defaultOfferId ?? null;
        const defaultPlanId =
          adapterDefaults.defaultPlanId ?? simhuisSettings?.defaultPlanId ?? null;
        const resellerId = adapterDefaults.resellerId ?? simhuisSettings?.resellerId ?? null;

        // Gebruik dataplan-specifieke refs indien gekoppeld (anders val terug op globals)
        const dataPlanOfferId = (initial as any).dataPlan?.providerOfferRef ?? null;
        const dataPlanPlanId = (initial as any).dataPlan?.providerPlanRef ?? null;
        const effectiveOfferId = dataPlanOfferId ?? defaultOfferId;
        const effectivePlanId = dataPlanPlanId ?? defaultPlanId;

        if (effectiveOfferId || effectivePlanId) {
          console.info(
            `[Activation] Gebruik ${adapter.providerKey}-product: offer_id=${effectiveOfferId ?? "-"}, plan_id=${effectivePlanId ?? "-"} (reseller_id=${resellerId ?? "-"}, dataPlan=${(initial as any).dataPlan?.name ?? "default"})`
          );
        }

        const preStatus = await simhuisGetSimStatus(initial.sim.iccid);
        if (preStatus.status === "active") {
          console.info(`[Activation] SIM ${initial.sim.iccid} reeds actief in ${adapter.providerKey} — overslaan`);
          rollbackCtx.simActivated = preStatus;
        } else {
          const activated = await simhuisActivateSim({
            iccid: initial.sim.iccid,
            customerRef: initial.customer.customerNumber ?? `${initial.customer.id}`,
            offerId: effectiveOfferId,
            planId: effectivePlanId,
            resellerId: resellerId,
          });
          rollbackCtx.simActivated = activated;
        }
      } catch (simErr: any) {
        const msg = `${adapter.providerKey} activatie mislukt voor SIM ${initial.sim.iccid}: ${simErr?.message ?? simErr}`;
        console.error(`[Activation] ${msg}`);
        await markFailedTx(id, msg, ctx.userId);
        throw new Error(msg);
      }
    } else {
      console.info(`[Activation] ${adapter.providerKey} niet geconfigureerd — skip SIM activatie`);
    }

    // --- STAP 3: Tracker registreren (Navixy) — ALLEEN bij NIET-SIM_ONLY ---
    if (!isSimOnly && initial.tracker) {
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
              if (adapter.capabilities.deactivateSim) {
                await simhuisDeactivateSim(initial.sim.iccid);
              } else {
                console.warn(`[Activation] Provider ${adapter.providerKey} heeft geen deactivateSim-capability — skip rollback`);
              }
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
    } else if (isSimOnly) {
      console.info(`[Activation] Order ${initial.orderNumber} is SIM_ONLY — skip Navixy tracker-registratie`);
    }

    // --- STAP 4: Interne transactionele stappen ---
    const result = await prisma.$transaction(async (tx) => {
      const order: any = await tx.activationOrder.findUnique({
        where: { id },
        include: {
          customer: true,
          product: true,
          dataPlan: true,
          tracker: true,
          sim: true,
          vehicle: true,
        },
      });
      if (!order) throw new Error("Order niet gevonden tijdens interne stap");
      if (order.status !== "PROCESSING") {
        throw new Error(`Order onverwachte status in interne stap: ${order.status}`);
      }

      const orderTypeInner: ActivationOrderProductType = order.orderType || ActivationOrderProductType.TRACKER_WITH_SIM;
      const isSimOnlyInner = orderTypeInner === ActivationOrderProductType.SIM_ONLY_DATA;

      // Tracker checks (alleen bij niet-sim-only)
      let trackerUpdated: any = null;
      if (!isSimOnlyInner) {
        const tracker = await tx.tracker.findUnique({
          where: { id: order.tracker.id, deletedAt: null },
        });
        if (!tracker || (tracker.status !== "IN_STOCK" && tracker.status !== "RESERVED")) {
          throw new Error(
            `Tracker status veranderd: nu ${tracker?.status ?? "deleted"}`
          );
        }
        const hasTrackerAssign = await tx.trackerAssignment.findFirst({
          where: { trackerId: order.tracker.id, endAt: null },
        });
        if (hasTrackerAssign) {
          throw new Error(`Tracker heeft reeds een actieve assignment.`);
        }
      }

      // SIM checks (altijd)
      const sim = await tx.sIM.findUnique({
        where: { id: order.sim.id, deletedAt: null },
      });
      if (!sim || (sim.status !== "IN_STOCK" && sim.status !== "RESERVED")) {
        throw new Error(`SIM status veranderd: nu ${sim?.status ?? "deleted"}`);
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
          dataPlanId: order.dataPlanId ?? null,
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

      if (!isSimOnlyInner) {
        trackerUpdated = await tx.tracker.update({
          where: { id: order.tracker.id },
          data: { status: "ACTIVE" as any },
        });
      }

      // Bepaal SIM customerLink guard: NIET overschrijven als INSERVE_ASSET/MANUAL met andere klant
      // Opmerking: Prisma's SIMUpdateInput (checked) vereist relation-nested inputs; wij gebruiken
      // de scalar-FK velden en geven die direct door via SIMUncheckedUpdateInput-achtig object.
      const updateSimData: Record<string, unknown> = {
        status: "ACTIVE" as any,
        dataPlanId: order.dataPlanId ?? null,
      };
      const existingCustomerId = sim.customerId;
      const existingLinkSource = sim.customerLinkSource as CustomerLinkSource | null;
      const targetCustomerId = order.customerId;

      if (!existingCustomerId) {
        // Leeg: direct vullen
        updateSimData.customerId = targetCustomerId;
        updateSimData.customerLinkedAt = new Date();
        updateSimData.customerLinkSource = isSimOnlyInner
          ? ("MANUAL" as any)
          : ("SUBSCRIPTION_DERIVED" as any);
      } else if (existingCustomerId === targetCustomerId) {
        // Dezelfde klant: bron alleen updaten indien leeg of subscription-gerelateerd
        if (!existingLinkSource || existingLinkSource === CustomerLinkSource.SUBSCRIPTION_DERIVED) {
          updateSimData.customerLinkSource = isSimOnlyInner
            ? ("MANUAL" as any)
            : ("SUBSCRIPTION_DERIVED" as any);
        }
        // customerLinkedAt: alleen zetten indien leeg
        if (!sim.customerLinkedAt) {
          updateSimData.customerLinkedAt = new Date();
        }
      } else {
        // ANDERE klant dan reeds gekoppeld
        if (existingLinkSource === CustomerLinkSource.INSERVE_ASSET) {
          // Beschermd: NIET overschrijven. Geen warning, gewoon overslaan (bron vertelt dat dit InServe masterdata is)
          console.info(`[Activation] SIM ${sim.iccid} reeds gekoppeld aan andere klant via INSERVE_ASSET — koppeling NIET overschreven.`);
        } else if (existingLinkSource === CustomerLinkSource.MANUAL) {
          // Handmatige koppeling: NIET zomaar overschrijven (tenzij expliciet geweten); we laten staan.
          console.warn(`[Activation] SIM ${sim.iccid} reeds handmatig gekoppeld aan andere klant (${existingCustomerId} vs ${targetCustomerId}) — koppeling NIET overschreven.`);
        } else {
          // SUBSCRIPTION_DERIVED of leeg: wel overschrijven (oude abonnement-koppeling)
          updateSimData.customerId = targetCustomerId;
          updateSimData.customerLinkedAt = new Date();
          updateSimData.customerLinkSource = isSimOnlyInner
            ? ("MANUAL" as any)
            : ("SUBSCRIPTION_DERIVED" as any);
        }
      }

      const simUpdated = await tx.sIM.update({
        where: { id: order.sim.id },
        data: updateSimData,
      });

      if (!isSimOnlyInner) {
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
      }

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
          orderType: order.orderType,
          dataPlanId: order.dataPlanId,
        } as any,
      });
      await logAudit(tx, {
        entityType: "activation_order",
        entityId: completed.id,
        action: "COMPLETE_ACTIVATION",
        userId: ctx.userId,
        newValues: {
          subscriptionId: subscription.id,
          trackerId: trackerUpdated?.id ?? null,
          simId: simUpdated.id,
          orderType: order.orderType,
          dataPlanId: order.dataPlanId,
        } as any,
      });

      return { order: completed, subscription, isSimOnly: isSimOnlyInner };
    }, { isolationLevel: "Serializable" });

    // --- STAP 5: Async externe syncs (geen blokking) ---
    enqueueInserveSubscriptionSync(result.subscription.id, ctx);
    return result;
  } catch (err: any) {
    const isAlreadyMarkedFailed = (err?.message ?? "").startsWith("Simhuis")
      || (err?.message ?? "").startsWith("Navixy");

    // Best-effort compensatie indien interne transactie of onverwachte fout
    if (!isAlreadyMarkedFailed) {
      // Navixy compensatie: alleen als tracker NIET SIM_ONLY is
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
          await initializeProviderRegistry();
          const rbAdapter = initial.sim
            ? await providerRegistry.resolveForSim(initial.sim as { providerKey?: string | null; provider?: string | null })
            : await providerRegistry.require("simhuis");
          if (rbAdapter.capabilities.deactivateSim) {
            await simhuisDeactivateSim(initial.sim.iccid);
          } else {
            console.warn(`[Activation] Provider ${rbAdapter.providerKey} heeft geen deactivateSim-capability — skip rollback`);
          }
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
