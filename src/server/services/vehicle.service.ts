import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import { requirePermission } from "@/lib/rbac";
import type {
  CreateVehicleInput,
  PaginatedResult,
  UpdateVehicleInput,
} from "@/types/domain";
import type { UserRole } from "@/types/enums";
import type { Prisma, Vehicle as PrismaVehicle } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

function includeDetail(): Prisma.VehicleInclude {
  return {
    customer: { select: { id: true, companyName: true, customerNumber: true } },
    trackerAssignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" as const },
      take: 5,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        tracker: {
          select: {
            id: true,
            serialNumber: true,
            imei: true,
            brand: true,
            model: true,
          },
        },
      },
    },
  };
}

export async function findManyVehicles(
  params: {
    page?: number;
    perPage?: number;
    sort?: string;
    order?: "asc" | "desc";
    search?: string;
    customerId?: string;
  } & { viewerRole?: UserRole }
): Promise<PaginatedResult<PrismaVehicle>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    customerId,
  } = params;

  const where: Prisma.VehicleWhereInput = { deletedAt: null };
  if (customerId) where.customerId = customerId;

  if (search) {
    const s = search.trim();
    where.OR = [
      { licensePlate: { contains: s, mode: "insensitive" } },
      { vin: { contains: s, mode: "insensitive" } },
      { brand: { contains: s, mode: "insensitive" } },
      { model: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.VehicleOrderByWithRelationInput =
    sort === "licensePlate"
      ? "licensePlate"
      : sort === "vin"
        ? "vin"
        : sort === "brand"
          ? "brand"
          : sort === "model"
            ? "model"
            : "createdAt";

  const skip = (page - 1) * perPage;
  const [total, data] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      include: {
        customer: { select: { id: true, companyName: true } },
      },
      orderBy: { [sortKey]: order } as Prisma.VehicleOrderByWithRelationInput,
      take: perPage,
      skip,
    }),
  ]);

  return {
    data: data as PrismaVehicle[],
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function findVehicleById(id: string) {
  return prisma.vehicle.findUnique({
    where: { id, deletedAt: null },
    include: includeDetail(),
  });
}

export async function createVehicle(
  input: CreateVehicleInput,
  ctx: Ctx
): Promise<PrismaVehicle> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.vehicle.create({
      data: {
        customerId: input.customerId,
        licensePlate: input.licensePlate ?? null,
        vin: input.vin ?? null,
        brand: input.brand ?? null,
        model: input.model ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
      },
    });
    await logAudit(tx, {
      entityType: "vehicle",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });
    return created;
  });
}

export async function updateVehicle(
  id: string,
  input: UpdateVehicleInput,
  ctx: Ctx
): Promise<PrismaVehicle> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
    const data: Prisma.VehicleUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }
    const updated = await tx.vehicle.update({ where: { id }, data });
    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );
    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "vehicle",
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

export async function softDeleteVehicle(
  id: string,
  ctx: Ctx
): Promise<PrismaVehicle> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vehicle.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
    const updated = await tx.vehicle.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await logAudit(tx, {
      entityType: "vehicle",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });
    return updated;
  });
}

export async function bulkSoftDeleteVehicles(
  ids: string[],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  requirePermission(ctx.userRole, "delete", "vehicle");
  if (!ids.length) return { count: 0, ids: [] };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.vehicle.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    if (!rows.length) return { count: 0, ids: [] };
    const targets = rows.map((r) => r.id);
    const deletedAt = new Date();
    const audits = rows.map((r) =>
      logAudit(tx, {
        entityType: "vehicle",
        entityId: r.id,
        action: "DELETE",
        userId: ctx.userId,
        oldValues: r as unknown as Record<string, unknown>,
      })
    );
    await Promise.all([
      tx.vehicle.updateMany({
        where: { id: { in: targets } },
        data: { deletedAt },
      }),
      ...audits,
    ]);
    return { count: targets.length, ids: targets };
  });
}
