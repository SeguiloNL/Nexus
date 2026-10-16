import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { pickAuth, requirePermission } from "@/lib/rbac";
import type { CreateDataPlanInput, UpdateDataPlanInput } from "@/server/validators/dataPlan";
import type { UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";
import type { Prisma, DataPlan as PrismaDataPlan } from "@prisma/client";
import { DataUnit, ProductTrack } from "@/types/enums";
import { isProductAvailableForTrack } from "@/lib/product-track";

// ---------------------------------------------------------------------------
// Pure availability-logica (geen Prisma) t.b.v. unit tests en hergebruik in de
// activatie-order service. Bepaalt of een dataplan gekozen mag worden voor een
// specifieke klant (klanttype + regio) op een gegeven moment.
// ---------------------------------------------------------------------------

export type DataPlanAvailabilityPlan = {
  isActive: boolean;
  simOnlyAvailable: boolean;
  availableUntil?: Date | string | null;
  targetRegions?: string[] | null;
  targetCustomerTypes?: string[] | null;
  productId?: string | null;
  product?: { isActive: boolean; track?: string | null } | null;
};

export type DataPlanAvailabilityContext = {
  /** Referentietijdstip (default: nu). */
  now?: Date;
  /** Klanttype van de klant (DIRECT/RESELLER/PARTNER). */
  customerType?: string | null;
  /** Regio (bv. landcode) van de klant. */
  region?: string | null;
  /** Of een koppeling met een actief product verplicht is (default true). */
  requireProductLink?: boolean;
};

export type DataPlanAvailabilityResult = {
  available: boolean;
  reasons: string[];
};

function normalizeToken(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toUpperCase();
  return v === "" ? null : v;
}

function normalizeTokenArray(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => normalizeToken(v))
    .filter((v): v is string => v !== null);
}

/**
 * Bepaalt of een dataplan beschikbaar is voor een klant-context.
 * Lege targeting-arrays betekenen "beschikbaar voor alles".
 */
export function isDataPlanAvailableFor(
  plan: DataPlanAvailabilityPlan,
  ctx: DataPlanAvailabilityContext = {},
): DataPlanAvailabilityResult {
  const reasons: string[] = [];
  const now = ctx.now ?? new Date();
  const requireProductLink = ctx.requireProductLink !== false;

  if (!plan.isActive) reasons.push("dataplan is inactief");
  if (!plan.simOnlyAvailable) reasons.push("dataplan is niet beschikbaar voor Sim-only");

  if (plan.availableUntil) {
    const until = plan.availableUntil instanceof Date ? plan.availableUntil : new Date(plan.availableUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) {
      reasons.push("dataplan is vervallen");
    }
  }

  if (requireProductLink) {
    if (!plan.productId) {
      reasons.push("geen factureerbaar product gekoppeld");
    } else if (plan.product && !plan.product.isActive) {
      reasons.push("gekoppeld product is inactief");
    } else if (
      plan.product &&
      !isProductAvailableForTrack(plan.product.track, "SIM_ONLY")
    ) {
      reasons.push("gekoppeld product is niet vrijgegeven voor Sim-only");
    }
  }

  const targetTypes = normalizeTokenArray(plan.targetCustomerTypes);
  const customerType = normalizeToken(ctx.customerType);
  if (targetTypes.length > 0) {
    if (!customerType || !targetTypes.includes(customerType)) {
      reasons.push(
        customerType
          ? `niet beschikbaar voor klanttype ${customerType}`
          : "klanttype onbekend (plan is klanttype-specifiek)",
      );
    }
  }

  const targetRegions = normalizeTokenArray(plan.targetRegions);
  const region = normalizeToken(ctx.region);
  if (targetRegions.length > 0) {
    if (!region || !targetRegions.includes(region)) {
      reasons.push(
        region ? `niet beschikbaar voor regio ${region}` : "regio onbekend (plan is regio-specifiek)",
      );
    }
  }

  return { available: reasons.length === 0, reasons };
}

export type AvailableDataPlanOption = {
  id: string;
  name: string;
  dataAmountBytes: bigint | null;
  dataAmountDisplayUnit: string | null;
  monthlyPrice: unknown;
  currency: string;
  validityDays: number | null;
  validityBillingCycle: string | null;
  provider: string | null;
  productId: string;
  productName: string | null;
  targetRegions: string[];
  targetCustomerTypes: string[];
  availableUntil: Date | null;
};

/**
 * Haalt de actieve, niet-vervallen Sim-only dataplannen op die voor de opgegeven
 * klant beschikbaar zijn (klanttype + regio) EN gekoppeld zijn aan een actief
 * factureerbaar product. Eén geïndexeerde query voor snelheid (<200ms).
 */
export async function listAvailableDataPlansForCustomer(params: {
  customerId: string;
  now?: Date;
}): Promise<{
  customerType: string | null;
  region: string | null;
  plans: AvailableDataPlanOption[];
}> {
  const now = params.now ?? new Date();

  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, deletedAt: null },
    select: { id: true, type: true, country: true },
  });
  if (!customer) {
    throw new Error("Klant niet gevonden of verwijderd.");
  }

  const region = normalizeToken(customer.country);
  const customerType = normalizeToken(customer.type);

  const rows = await prisma.dataPlan.findMany({
    where: {
      isActive: true,
      simOnlyAvailable: true,
      productId: { not: null },
      product: {
        isActive: true,
        // Alleen producten die voor het Sim-only datasimkaart-traject zijn
        // vrijgegeven (of algemeen "beide trajecten").
        track: { in: [ProductTrack.BOTH, ProductTrack.SIM_ONLY] },
      },
      AND: [
        { OR: [{ availableUntil: null }, { availableUntil: { gte: now } }] },
        {
          OR: [
            { targetCustomerTypes: { isEmpty: true } },
            ...(customer.type ? [{ targetCustomerTypes: { has: customer.type } }] : []),
          ],
        },
        region
          ? {
              OR: [
                { targetRegions: { isEmpty: true } },
                { targetRegions: { has: region } },
              ],
            }
          : { targetRegions: { isEmpty: true } },
      ],
    },
    select: {
      id: true,
      name: true,
      dataAmountBytes: true,
      dataAmountDisplayUnit: true,
      monthlyPrice: true,
      currency: true,
      validityDays: true,
      validityBillingCycle: true,
      provider: true,
      productId: true,
      product: { select: { name: true } },
      targetRegions: true,
      targetCustomerTypes: true,
      availableUntil: true,
    },
    orderBy: { name: "asc" },
  });

  return {
    customerType: customer.type ?? null,
    region,
    plans: rows.map((r) => ({
      id: r.id,
      name: r.name,
      dataAmountBytes: r.dataAmountBytes,
      dataAmountDisplayUnit: r.dataAmountDisplayUnit,
      monthlyPrice: r.monthlyPrice,
      currency: r.currency,
      validityDays: r.validityDays,
      validityBillingCycle: r.validityBillingCycle,
      provider: r.provider,
      productId: r.productId as string,
      productName: r.product?.name ?? null,
      targetRegions: r.targetRegions,
      targetCustomerTypes: r.targetCustomerTypes,
      availableUntil: r.availableUntil,
    })),
  };
}


type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerScope?: string[];
  permissions?: PermissionBits;
};

export type PaginatedResult<T> = {
  data: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

type ListParams = {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: "asc" | "desc";
  search?: string;
  isActive?: boolean;
  simOnlyAvailable?: boolean;
};

export async function findManyDataPlans(
  params: ListParams
): Promise<PaginatedResult<PrismaDataPlan>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    isActive,
    simOnlyAvailable,
  } = params;

  const where: Prisma.DataPlanWhereInput = {};

  if (isActive !== undefined) where.isActive = isActive;
  if (simOnlyAvailable !== undefined) where.simOnlyAvailable = simOnlyAvailable;

  if (search) {
    const s = search.trim();
    where.OR = [
      { name: { contains: s, mode: "insensitive" } },
      { description: { contains: s, mode: "insensitive" } },
      { provider: { contains: s, mode: "insensitive" } },
      { providerPlanRef: { contains: s, mode: "insensitive" } },
      { providerOfferRef: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.DataPlanOrderByWithRelationInput =
    sort === "name"
      ? "name"
      : sort === "isActive"
        ? "isActive"
        : sort === "simOnlyAvailable"
          ? "simOnlyAvailable"
          : sort === "provider"
            ? "provider"
            : sort === "monthlyPrice"
              ? "monthlyPrice"
              : sort === "dataAmountBytes"
                ? "dataAmountBytes"
                : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.dataPlan.count({ where }),
    prisma.dataPlan.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.DataPlanOrderByWithRelationInput,
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

export async function findDataPlanById(id: string) {
  return prisma.dataPlan.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, productCode: true, isActive: true } },
      _count: {
        select: {
          activationOrders: true,
          subscriptions: true,
          sims: true,
        },
      },
    },
  });
}

/**
 * Valideert een 1-op-1 productkoppeling: het product moet bestaan, actief zijn en
 * nog niet aan een ander dataplan gekoppeld zijn. Wordt zowel bij create als
 * update afgedwongen (database heeft daarnaast een unieke constraint).
 */
async function assertProductLinkable(
  tx: Prisma.TransactionClient,
  productId: string | null | undefined,
  currentDataPlanId: string | null,
): Promise<void> {
  if (!productId) return;

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, isActive: true },
  });
  if (!product) {
    throw new Error(`Product "${productId}" bestaat niet en kan niet gekoppeld worden.`);
  }
  if (!product.isActive) {
    throw new Error(
      `Product "${product.name}" is niet actief (niet factureerbaar) en kan niet gekoppeld worden.`,
    );
  }

  const existingLink = await tx.dataPlan.findFirst({
    where: {
      productId,
      ...(currentDataPlanId ? { id: { not: currentDataPlanId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (existingLink) {
    throw new Error(
      `Product "${product.name}" is al gekoppeld aan dataplan "${existingLink.name}". Een product kan maar aan één dataplan gekoppeld zijn.`,
    );
  }
}

export async function createDataPlan(
  input: CreateDataPlanInput,
  ctx: Ctx
): Promise<PrismaDataPlan> {
  await requirePermission(pickAuth(ctx), "create", "data_plan");

  return prisma.$transaction(async (tx) => {
    const data: Prisma.DataPlanUncheckedCreateInput = {
      name: input.name.trim(),
    };
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.dataAmountBytes !== undefined) data.dataAmountBytes = input.dataAmountBytes ?? null;
    if (input.dataAmountDisplayUnit !== undefined) data.dataAmountDisplayUnit = input.dataAmountDisplayUnit ?? null as any;
    if (input.validityDays !== undefined) data.validityDays = input.validityDays ?? null;
    if (input.validityBillingCycle !== undefined) data.validityBillingCycle = (input.validityBillingCycle as any) ?? null;
    if (input.monthlyPrice !== undefined) data.monthlyPrice = input.monthlyPrice ?? null;
    if (input.currency) data.currency = input.currency;
    if (input.btwPercentage !== undefined) data.btwPercentage = input.btwPercentage ?? null;
    if (input.provider !== undefined) data.provider = input.provider ?? null;
    if (input.providerPlanRef !== undefined) data.providerPlanRef = input.providerPlanRef ?? null;
    if (input.providerOfferRef !== undefined) data.providerOfferRef = input.providerOfferRef ?? null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.simOnlyAvailable !== undefined) data.simOnlyAvailable = input.simOnlyAvailable;
    if (input.productId !== undefined) data.productId = input.productId ?? null;
    if (input.targetRegions !== undefined) data.targetRegions = input.targetRegions ?? [];
    if (input.targetCustomerTypes !== undefined) {
      data.targetCustomerTypes = (input.targetCustomerTypes as any) ?? [];
    }
    if (input.availableUntil !== undefined) data.availableUntil = input.availableUntil ?? null;

    await assertProductLinkable(tx, data.productId as string | null | undefined, null);

    const created = await tx.dataPlan.create({ data });

    await logAudit(tx, {
      entityType: "data_plan",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateDataPlan(
  id: string,
  input: UpdateDataPlanInput,
  ctx: Ctx
): Promise<PrismaDataPlan> {
  await requirePermission(pickAuth(ctx), "edit", "data_plan");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.dataPlan.findUniqueOrThrow({ where: { id } });

    const data: Prisma.DataPlanUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      (data as any)[k] = v;
    }
    if (typeof data.name === "string") data.name = data.name.trim();
    if (typeof data.description === "string" && data.description) data.description = (data.description as string).trim();

    // Valideer de productkoppeling (1-op-1, actief product) vóór de update.
    if ("productId" in input) {
      await assertProductLinkable(tx, (data as any).productId ?? null, id);
    }

    const updated = await tx.dataPlan.update({ where: { id }, data });

    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "data_plan",
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

export async function listDataPlanOptions(params: {
  simOnlyOnly?: boolean;
  activeOnly?: boolean;
} = {}) {
  const { simOnlyOnly = false, activeOnly = false } = params;

  const where: Prisma.DataPlanWhereInput = {};
  if (activeOnly) where.isActive = true;
  if (simOnlyOnly) {
    where.isActive = true;
    where.simOnlyAvailable = true;
  }

  const rows = await prisma.dataPlan.findMany({
    where,
    select: {
      id: true,
      name: true,
      dataAmountBytes: true,
      dataAmountDisplayUnit: true,
      monthlyPrice: true,
      currency: true,
      validityDays: true,
      validityBillingCycle: true,
      provider: true,
    },
    orderBy: { name: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    dataAmountBytes: r.dataAmountBytes,
    dataAmountDisplayUnit: r.dataAmountDisplayUnit,
    monthlyPrice: r.monthlyPrice,
    currency: r.currency,
    validityDays: r.validityDays,
    validityBillingCycle: r.validityBillingCycle,
    provider: r.provider,
  }));
}

export async function bulkSetActiveDataPlans(
  ids: string[],
  isActive: boolean,
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  await requirePermission(pickAuth(ctx), "edit", "data_plan");
  if (!ids.length) return { count: 0, ids: [] };

  return prisma.$transaction(async (tx) => {
    const rows = await tx.dataPlan.findMany({
      where: { id: { in: ids }, isActive: { not: isActive } },
      select: { id: true, isActive: true, name: true },
    });
    if (!rows.length) return { count: 0, ids: [] };

    const targets = rows.map((r) => r.id);
    const updates = targets.map((id) =>
      tx.dataPlan.update({ where: { id }, data: { isActive } })
    );
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "data_plan",
        entityId: r.id,
        action: "UPDATE",
        userId: ctx.userId,
        oldValues: { isActive: r.isActive } as unknown as Record<string, unknown>,
        newValues: { isActive } as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([...updates, ...audits]);
    return { count: targets.length, ids: targets };
  });
}

export async function deleteDataPlan(id: string, ctx: Ctx): Promise<void> {
  await requirePermission(pickAuth(ctx), "delete", "data_plan");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.dataPlan.findUniqueOrThrow({
      where: { id },
      select: { id: true, name: true },
    });

    const [aoCount, subCount, simCount] = await Promise.all([
      tx.activationOrder.count({ where: { dataPlanId: id } }),
      tx.subscription.count({ where: { dataPlanId: id } }),
      tx.sIM.count({ where: { dataPlanId: id } }),
    ]);

    const blockers: string[] = [];
    if (aoCount > 0) blockers.push(`${aoCount} activeringsorder(s)`);
    if (subCount > 0) blockers.push(`${subCount} abonnement(en)`);
    if (simCount > 0) blockers.push(`${simCount} simkaart(en)`);

    if (blockers.length > 0) {
      throw new Error(
        `Kan dataplan "${existing.name}" niet verwijderen: nog gekoppeld aan ${blockers.join(", ")}. Deactiveer het plan in plaats van te verwijderen.`
      );
    }

    await logAudit(tx, {
      entityType: "data_plan",
      entityId: existing.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });
    await tx.dataPlan.delete({ where: { id } });
  });
}

export async function bulkDeleteDataPlans(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; skipped: { id: string; reason: string }[] }> {
  await requirePermission(pickAuth(ctx), "delete", "data_plan");
  if (!ids.length) return { count: 0, skipped: [] };

  const skipped: { id: string; reason: string }[] = [];
  let count = 0;

  for (const id of ids) {
    try {
      await deleteDataPlan(id, ctx);
      count++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      skipped.push({ id, reason });
    }
  }
  return { count, skipped };
}

/**
 * Converteer een waarde in DataUnit naar BigInt bytes.
 * Retourneert null als unit UNLIMITED of ongeldig.
 */
export function amountUnitToBytes(amount: number | string | null | undefined, unit: DataUnit | string | null | undefined): bigint | null {
  if (amount == null || amount === "") return null;
  const num = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(num) || num < 0) return null;

  switch (unit) {
    case DataUnit.MB:
      return BigInt(Math.round(num * 1024 ** 2));
    case DataUnit.GB:
      return BigInt(Math.round(num * 1024 ** 3));
    case DataUnit.TB:
      return BigInt(Math.round(num * 1024 ** 4));
    case DataUnit.UNLIMITED:
    default:
      return null;
  }
}

/**
 * Human-readable opmaak van databundel: "500 MB", "10 GB", "Onbeperkt", enz.
 */
export function formatDataBundle(
  bytes: bigint | number | string | null | undefined,
  unit: DataUnit | string | null | undefined
): string {
  if (unit === DataUnit.UNLIMITED || (!bytes && unit === DataUnit.UNLIMITED)) {
    return "Onbeperkt";
  }
  if (!bytes) return unit ? `— (${unit})` : "—";

  const b = typeof bytes === "bigint" ? bytes : BigInt(bytes);
  if (unit === DataUnit.MB) {
    const mb = Number(b) / 1024 ** 2;
    return `${mb.toLocaleString("nl-NL", { maximumFractionDigits: mb % 1 === 0 ? 0 : 2 })} MB`;
  }
  if (unit === DataUnit.GB) {
    const gb = Number(b) / 1024 ** 3;
    return `${gb.toLocaleString("nl-NL", { maximumFractionDigits: gb % 1 === 0 ? 0 : 2 })} GB`;
  }
  if (unit === DataUnit.TB) {
    const tb = Number(b) / 1024 ** 4;
    return `${tb.toLocaleString("nl-NL", { maximumFractionDigits: tb % 1 === 0 ? 0 : 2 })} TB`;
  }
  return `${Number(b).toLocaleString("nl-NL")} B`;
}
