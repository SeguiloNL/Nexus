import { prisma } from "@/lib/prisma";
import {
  generateCustomerNumber,
} from "@/lib/identifiers";
import { logAudit, diffObject } from "./audit.service";
import type {
  CustomerFilterParams,
  CreateCustomerInput,
  PaginatedResult,
  UpdateCustomerInput,
} from "@/types/domain";
import { CustomerStatus, UserRole, RoleScope, CustomerType } from "@/types/enums";
import type { Prisma, Customer as PrismaCustomer } from "@prisma/client";
import { CreateCustomerSchema } from "@/server/validators/customer";
import type { PermissionBits } from "@/types/next-auth";
import {
  pickAuth,
  requirePermission,
  isResellerScope,
  isPartnerOrResellerScope,
} from "@/lib/rbac";

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerId?: string | null;
  customerScope?: string[];
  permissions?: PermissionBits;
};

function includeDetail(): Prisma.CustomerInclude {
  return {
    parentCustomer: { select: { id: true, companyName: true, customerNumber: true } },
    subCustomers: {
      select: { id: true, companyName: true, customerNumber: true, status: true },
      where: { deletedAt: null },
      orderBy: { companyName: "asc" as const },
      take: 25,
    },
    subscriptions: {
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" as const },
      take: 10,
      include: {
        trackerAssignments: {
          where: { endAt: null },
          select: {
            id: true,
            startAt: true,
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
                brand: true,
                model: true,
              },
            },
          },
        },
        simAssignments: {
          where: { endAt: null },
          select: {
            id: true,
            startAt: true,
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
      },
    },
    vehicles: {
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" as const },
      take: 10,
      select: { id: true, licensePlate: true, vin: true, brand: true, model: true },
    },
    activationOrders: {
      orderBy: { createdAt: "desc" as const },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        completedAt: true,
        failedAt: true,
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
        sim: {
          select: {
            id: true,
            iccid: true,
            msisdn: true,
            provider: true,
            status: true,
          },
        },
        subscription: {
          select: {
            id: true,
            subscriptionNumber: true,
            status: true,
          },
        },
        vehicle: {
          select: {
            id: true,
            licensePlate: true,
          },
        },
      },
    },
  };
}

export async function findManyCustomers(
  params: CustomerFilterParams & { viewerRole?: UserRole; customerScope?: string[] }
): Promise<PaginatedResult<PrismaCustomer>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    status,
    parentCustomerId,
    isParent,
    customerScope,
  } = params;

  const where: Prisma.CustomerWhereInput = { deletedAt: null };

  if (customerScope && customerScope.length > 0) {
    where.id = { in: customerScope };
  }

  if (status) (where.status as any) = status;
  if (parentCustomerId) where.parentCustomerId = parentCustomerId;
  if (isParent === true) where.parentCustomerId = null;

  if (search) {
    const s = search.trim();
    where.OR = [
      { customerNumber: { contains: s, mode: "insensitive" } },
      { companyName: { contains: s, mode: "insensitive" } },
      { contactPerson: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
      { phone: { contains: s } },
      { city: { contains: s, mode: "insensitive" } },
      { postalCode: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.CustomerOrderByWithRelationInput =
    sort === "companyName"
      ? "companyName"
      : sort === "customerNumber"
        ? "customerNumber"
        : sort === "status"
          ? "status"
          : sort === "city"
            ? "city"
            : "createdAt";

  const skip = (page - 1) * perPage;

  const [total, data] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      include: {
        parentCustomer: { select: { id: true, companyName: true } },
      },
      orderBy: { [sortKey]: order } as Prisma.CustomerOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data: data as PrismaCustomer[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findCustomerById(id: string, customerScope?: string[]) {
  const where: Prisma.CustomerWhereUniqueInput & Prisma.CustomerWhereInput = { id, deletedAt: null };
  if (customerScope && customerScope.length > 0) {
    if (!customerScope.includes(id)) return null;
  }
  return prisma.customer.findUnique({
    where: where as Prisma.CustomerWhereUniqueInput,
    include: includeDetail(),
  });
}

export async function createCustomer(
  input: CreateCustomerInput,
  ctx: Ctx
): Promise<PrismaCustomer> {
  await requirePermission(pickAuth(ctx), "create", "customer");

  const safeInput: CreateCustomerInput = { ...input };

  if (isPartnerOrResellerScope(ctx.roleScope)) {
    if (!ctx.customerId || ctx.customerScope?.length === 0) {
      throw new Error("Kan geen sub-klanten aanmaken: geen eigen customer-id in sessie.");
    }
    if (
      safeInput.parentCustomerId != null &&
      safeInput.parentCustomerId !== ctx.customerId
    ) {
      throw new Error(
        "Parent customer mag alleen je eigen klantrecord zijn (sub-klant onder jezelf)."
      );
    }
    safeInput.parentCustomerId = ctx.customerId;
    safeInput.type = CustomerType.DIRECT;
  } else if (ctx.roleScope === RoleScope.CUSTOMER) {
    throw new Error(
      "Onvoldoende rechten: directe eindklanten kunnen geen sub-klanten aanmaken."
    );
  }

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (safeInput.parentCustomerId && !ctx.customerScope.includes(safeInput.parentCustomerId)) {
      throw new Error("Parent customer valt niet binnen je toegang");
    }
  }

  if (safeInput.parentCustomerId) {
    const parent = await prisma.customer.findUnique({
      where: { id: safeInput.parentCustomerId, deletedAt: null },
      select: { type: true },
    });
    if (!parent) {
      throw new Error(`Parent customer (${safeInput.parentCustomerId}) bestaat niet.`);
    }
    if (parent.type === CustomerType.DIRECT) {
      throw new Error(
        "Parent customer moet van type RESELLER of PARTNER zijn (DIRECT kan geen sub-klanten hebben)."
      );
    }
  }

  if (
    safeInput.type === CustomerType.DIRECT &&
    safeInput.parentCustomerId
  ) {
    // OK: sub-klant van Reseller/Partner
  }
  if (
    (safeInput.type === CustomerType.RESELLER ||
      safeInput.type === CustomerType.PARTNER) &&
    safeInput.parentCustomerId
  ) {
    throw new Error(
      "RESELLER en PARTNER klanten kunnen geen eigen parent hebben (geen geneste resellers/partners)."
    );
  }

  return prisma.$transaction(async (tx) => {
    const customerNumber =
      safeInput.customerNumber?.trim() || (await generateCustomerNumber(tx as any));

    const created = await tx.customer.create({
      data: {
        customerNumber,
        companyName: safeInput.companyName.trim(),
        type: (safeInput.type ?? CustomerType.DIRECT) as any,
        parentCustomerId: safeInput.parentCustomerId ?? null,
        address: safeInput.address ?? null,
        postalCode: safeInput.postalCode ?? null,
        city: safeInput.city ?? null,
        country: safeInput.country ?? null,
        contactPerson: safeInput.contactPerson ?? null,
        phone: safeInput.phone ?? null,
        email: safeInput.email ?? null,
        status: (safeInput.status ?? "PROSPECT") as CustomerStatus,
        notes: safeInput.notes ?? null,
      },
    });

    await logAudit(tx as any, {
      entityType: "customer",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  ctx: Ctx
): Promise<PrismaCustomer> {
  await requirePermission(pickAuth(ctx), "edit", "customer");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (!ctx.customerScope.includes(id)) {
      throw new Error("Customer valt niet binnen je toegang");
    }
    if (input.parentCustomerId && !ctx.customerScope.includes(input.parentCustomerId)) {
      throw new Error("Parent customer valt niet binnen je toegang");
    }
  }

  if (isPartnerOrResellerScope(ctx.roleScope)) {
    if (input.type && input.type !== CustomerType.DIRECT) {
      throw new Error(
        "Resellers en Partners kunnen alleen DIRECT type sub-klanten hebben."
      );
    }
    if (ctx.customerId && id === ctx.customerId) {
      if (input.parentCustomerId != null) {
        throw new Error(
          "Je kunt je eigen klantrecord niet onder een andere parent hangen."
        );
      }
      if (input.type) {
        throw new Error(
          "Je kunt je eigen klanttype (RESELLER/PARTNER) niet zelf wijzigen."
        );
      }
    } else {
      if (
        input.parentCustomerId != null &&
        input.parentCustomerId !== ctx.customerId
      ) {
        throw new Error(
          "Parent customer van sub-klant moet je eigen klantrecord zijn."
        );
      }
      input.parentCustomerId = ctx.customerId;
      input.type = CustomerType.DIRECT;
    }
  }

  if (input.type === CustomerType.DIRECT && input.parentCustomerId) {
    // OK
  }
  if (
    (input.type === CustomerType.RESELLER || input.type === CustomerType.PARTNER) &&
    input.parentCustomerId
  ) {
    throw new Error(
      "RESELLER en PARTNER klanten kunnen geen eigen parent hebben (geen geneste resellers/partners)."
    );
  }

  if (input.parentCustomerId) {
    const parent = await prisma.customer.findUnique({
      where: { id: input.parentCustomerId, deletedAt: null },
      select: { type: true },
    });
    if (!parent) {
      throw new Error(`Parent customer (${input.parentCustomerId}) bestaat niet.`);
    }
    if (parent.type === CustomerType.DIRECT) {
      throw new Error(
        "Parent customer moet van type RESELLER of PARTNER zijn."
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    if (input.type != null && input.parentCustomerId === undefined) {
      // Als type gewijzigd wordt naar DIRECT zonder expliciete parent check,
      // dan moet bestaande parent ook geldig blijven.
      if (existing.parentCustomerId && input.type === CustomerType.DIRECT) {
        // OK: bestaande parent blijft geldig indien van toepassing
      }
      if (
        (input.type === CustomerType.RESELLER || input.type === CustomerType.PARTNER) &&
        existing.parentCustomerId
      ) {
        throw new Error(
          "Kan type niet wijzigen naar RESELLER/PARTNER: klant heeft reeds een parent."
        );
      }
    }

    const updated = await tx.customer.update({
      where: { id },
      data: input as Prisma.CustomerUpdateInput,
    });

    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    if (oldValues || newValues) {
      await logAudit(tx as any, {
        entityType: "customer",
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

export async function softDeleteCustomer(
  id: string,
  ctx: Ctx
): Promise<PrismaCustomer> {
  await requirePermission(pickAuth(ctx), "delete", "customer");

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    if (!ctx.customerScope.includes(id)) {
      throw new Error("Customer valt niet binnen je toegang");
    }
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const updated = await tx.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logAudit(tx as any, {
      entityType: "customer",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });

    return updated;
  });
}

export async function listParentCustomers(customerScope?: string[]) {
  const where: Prisma.CustomerWhereInput = { deletedAt: null, parentCustomerId: null };
  if (customerScope && customerScope.length > 0) {
    where.id = { in: customerScope };
  }
  return prisma.customer
    .findMany({
      where,
      select: { id: true, companyName: true, customerNumber: true },
      orderBy: { companyName: "asc" },
    })
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: `${r.companyName} (${r.customerNumber})`,
      }))
    );
}

export interface CustomerCsvImportRow {
  customerNumber?: string;
  companyName: string;
  type?: string;
  parentCustomerId?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  kvkNr?: string;
  btwNr?: string;
  inserveCompanyId?: string | number;
  status?: string;
  notes?: string;
}

export interface CustomerCsvImportPreviewResult {
  valid: Array<{ row: number; data: CreateCustomerInput }>;
  invalid: Array<{ row: number; errors: Record<string, string[]>; raw: any }>;
  total: number;
}

export function previewCustomerCsvImport(
  rows: CustomerCsvImportRow[]
): CustomerCsvImportPreviewResult {
  const valid: CustomerCsvImportPreviewResult["valid"] = [];
  const invalid: CustomerCsvImportPreviewResult["invalid"] = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const result = CreateCustomerSchema.safeParse(raw);
    if (result.success) {
      valid.push({ row: rowNum, data: result.data });
    } else {
      invalid.push({
        row: rowNum,
        errors: result.error.flatten().fieldErrors as any,
        raw,
      });
    }
  });

  return { valid, invalid, total: rows.length };
}

export async function bulkImportCustomers(
  validRows: CustomerCsvImportPreviewResult["valid"],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  await requirePermission(pickAuth(ctx), "create", "customer");

  const forceParent =
    isPartnerOrResellerScope(ctx.roleScope) ? ctx.customerId : null;

  if (ctx.customerScope && ctx.customerScope.length > 0) {
    for (const { data } of validRows) {
      if (
        data.parentCustomerId &&
        !ctx.customerScope.includes(data.parentCustomerId)
      ) {
        throw new Error(
          "Een of meer parent customers vallen niet binnen je toegang"
        );
      }
    }
  }

  const ids: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { row, data } of validRows) {
      const customerNumber =
        data.customerNumber ?? (await generateCustomerNumber(tx as any));
      const raw = data as any;

      let finalType: CustomerType | undefined = raw.type as CustomerType;
      let finalParent: string | null | undefined = data.parentCustomerId;

      if (isPartnerOrResellerScope(ctx.roleScope)) {
        finalParent = forceParent ?? undefined;
        finalType = CustomerType.DIRECT;
      } else if (finalType == null) {
        finalType = CustomerType.DIRECT;
      }

      const created = await tx.customer.create({
        data: {
          customerNumber,
          companyName: data.companyName.trim(),
          type: (finalType ?? CustomerType.DIRECT) as any,
          parentCustomerId: finalParent ?? null,
          address: data.address ?? null,
          postalCode: data.postalCode ?? null,
          city: data.city ?? null,
          country: data.country ?? null,
          contactPerson: data.contactPerson ?? null,
          phone: data.phone ?? null,
          email: data.email ?? null,
          kvkNr: raw.kvkNr ?? null,
          btwNr: raw.btwNr ?? null,
          inserveCompanyId: raw.inserveCompanyId ?? null,
          status: (data.status ?? "ACTIVE") as CustomerStatus,
          notes: data.notes ?? null,
        },
      });
      ids.push(created.id);
      await logAudit(tx as any, {
        entityType: "customer",
        entityId: created.id,
        action: "CREATE",
        userId: ctx.userId,
        newValues: created as unknown as Record<string, unknown>,
        metadata: { importRow: row, bulkImport: true },
      });
    }
  });
  return { count: ids.length, ids };
}
