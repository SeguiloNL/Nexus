import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import type {
  CreateProductInput,
  PaginatedResult,
  UpdateProductInput,
} from "@/types/domain";
import type { UserRole } from "@/types/enums";
import type { Prisma, Product as PrismaProduct } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

function includeDetail(): Prisma.ProductInclude {
  return {
    subscriptions: {
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" as const },
      take: 10,
      select: {
        id: true,
        subscriptionNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        customer: {
          select: { id: true, companyName: true, customerNumber: true },
        },
      },
    },
  };
}

export async function findManyProducts(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    isActive?: boolean;
  } & { viewerRole?: UserRole }
): Promise<PaginatedResult<PrismaProduct>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    isActive,
  } = params;

  const where: Prisma.ProductWhereInput = {};

  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    const s = search.trim();
    where.OR = [
      { productCode: { contains: s, mode: "insensitive" } },
      { name: { contains: s, mode: "insensitive" } },
      { description: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.ProductOrderByWithRelationInput =
    sort === "name"
      ? "name"
      : sort === "productCode"
        ? "productCode"
        : sort === "monthlyPrice"
          ? "monthlyPrice"
          : sort === "isActive"
            ? "isActive"
            : "createdAt";

  const skip = (page - 1) * perPage;

  const [total, data] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.ProductOrderByWithRelationInput,
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

export async function findProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: includeDetail(),
  });
}

export async function createProduct(
  input: CreateProductInput,
  ctx: Ctx
): Promise<PrismaProduct> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: input.name.trim(),
        productCode: input.productCode.trim(),
        description: input.description ?? null,
        monthlyPrice: input.monthlyPrice,
        currency: input.currency ?? "EUR",
        isActive: input.isActive ?? true,
      },
    });

    await logAudit(tx, {
      entityType: "product",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
  ctx: Ctx
): Promise<PrismaProduct> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUniqueOrThrow({ where: { id } });

    const data: Prisma.ProductUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }
    if (data.name && typeof data.name === "string") data.name = data.name.trim();
    if (data.productCode && typeof data.productCode === "string")
      data.productCode = data.productCode.trim();

    const updated = await tx.product.update({
      where: { id },
      data,
    });

    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "product",
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

export async function listProductOptions() {
  return prisma.product
    .findMany({
      where: { isActive: true },
      select: { id: true, name: true, productCode: true, monthlyPrice: true },
      orderBy: { name: "asc" },
    })
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: `${r.name} (${r.productCode}) · € ${Number(r.monthlyPrice).toFixed(2)}/mnd`,
      }))
    );
}
