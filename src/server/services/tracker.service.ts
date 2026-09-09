import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import type {
  CreateTrackerInput,
  PaginatedResult,
  TrackerFilterParams,
  UpdateTrackerInput,
} from "@/types/domain";
import type { TrackerStatus, UserRole } from "@/types/enums";
import type { Prisma, Tracker as PrismaTracker } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

function includeDetail(): Prisma.TrackerInclude {
  return {
    assignments: {
      where: { endAt: null },
      orderBy: { startAt: "desc" as const },
      take: 5,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        reason: true,
        subscription: {
          select: {
            id: true,
            subscriptionNumber: true,
            customer: {
              select: { id: true, companyName: true, customerNumber: true },
            },
          },
        },
        vehicle: {
          select: { id: true, licensePlate: true, brand: true, model: true },
        },
      },
    },
  };
}

export async function findManyTrackers(
  params: TrackerFilterParams & { viewerRole?: UserRole }
): Promise<PaginatedResult<PrismaTracker>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    status,
    brand,
    model,
    assignedOnly,
  } = params;

  const where: Prisma.TrackerWhereInput = { deletedAt: null };

  if (status) (where.status as any) = status;
  if (brand) where.brand = { contains: brand, mode: "insensitive" };
  if (model) where.model = { contains: model, mode: "insensitive" };

  if (assignedOnly === true) {
    where.assignments = { some: { endAt: null } };
  } else if (assignedOnly === false) {
    where.assignments = { none: { endAt: null } };
  }

  if (search) {
    const s = search.trim();
    where.OR = [
      { serialNumber: { contains: s, mode: "insensitive" } },
      { imei: { contains: s } },
      { brand: { contains: s, mode: "insensitive" } },
      { model: { contains: s, mode: "insensitive" } },
      { supplier: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.TrackerOrderByWithRelationInput =
    sort === "serialNumber"
      ? "serialNumber"
      : sort === "imei"
        ? "imei"
        : sort === "brand"
          ? "brand"
          : sort === "model"
            ? "model"
            : sort === "status"
              ? "status"
              : sort === "purchaseDate"
                ? "purchaseDate"
                : "createdAt";

  const skip = (page - 1) * perPage;

  const [total, data] = await Promise.all([
    prisma.tracker.count({ where }),
    prisma.tracker.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.TrackerOrderByWithRelationInput,
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

export async function findTrackerById(id: string) {
  return prisma.tracker.findUnique({
    where: { id, deletedAt: null },
    include: includeDetail(),
  });
}

export async function createTracker(
  input: CreateTrackerInput,
  ctx: Ctx
): Promise<PrismaTracker> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.tracker.create({
      data: {
        serialNumber: input.serialNumber,
        imei: input.imei,
        brand: input.brand.trim(),
        model: input.model.trim(),
        hardwareType: input.hardwareType ?? null,
        firmwareVersion: input.firmwareVersion ?? null,
        purchaseDate: input.purchaseDate ?? null,
        supplier: input.supplier ?? null,
        status: (input.status ?? "IN_STOCK") as TrackerStatus,
        notes: input.notes ?? null,
      },
    });

    await logAudit(tx, {
      entityType: "tracker",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateTracker(
  id: string,
  input: UpdateTrackerInput,
  ctx: Ctx
): Promise<PrismaTracker> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tracker.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const data: Prisma.TrackerUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }

    const updated = await tx.tracker.update({
      where: { id },
      data,
    });

    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "tracker",
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

export async function softDeleteTracker(
  id: string,
  ctx: Ctx
): Promise<PrismaTracker> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tracker.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const updated = await tx.tracker.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logAudit(tx, {
      entityType: "tracker",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });

    return updated;
  });
}

export async function listAssignableTrackers() {
  return prisma.tracker
    .findMany({
      where: {
        deletedAt: null,
        status: "IN_STOCK",
        assignments: { none: { endAt: null } },
      },
      select: {
        id: true,
        serialNumber: true,
        imei: true,
        brand: true,
        model: true,
      },
      orderBy: { serialNumber: "asc" },
    })
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: `${r.brand} ${r.model} · ${r.serialNumber} · IMEI ${r.imei}`,
      }))
    );
}

export interface CsvImportRow {
  serialNumber: string;
  imei: string;
  brand: string;
  model: string;
  hardwareType?: string;
  firmwareVersion?: string;
  purchaseDate?: string;
  supplier?: string;
  notes?: string;
}

export interface CsvImportPreviewResult {
  valid: Array<{ row: number; data: CreateTrackerInput }>;
  invalid: Array<{ row: number; errors: Record<string, string[]>; raw: any }>;
  total: number;
}

export function previewTrackerCsvImport(
  rows: CsvImportRow[]
): CsvImportPreviewResult {
  const valid: CsvImportPreviewResult["valid"] = [];
  const invalid: CsvImportPreviewResult["invalid"] = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const result = CreateTrackerInputSchemaSafeParse(raw);
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

import { CreateTrackerSchema } from "@/server/validators/tracker";

function CreateTrackerInputSchemaSafeParse(raw: CsvImportRow) {
  return CreateTrackerSchema.safeParse(raw);
}

export async function bulkImportTrackers(
  validRows: CsvImportPreviewResult["valid"],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  const ids: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { row, data } of validRows) {
      const created = await tx.tracker.create({
        data: {
          serialNumber: data.serialNumber,
          imei: data.imei,
          brand: data.brand.trim(),
          model: data.model.trim(),
          hardwareType: data.hardwareType ?? null,
          firmwareVersion: data.firmwareVersion ?? null,
          purchaseDate: data.purchaseDate ?? null,
          supplier: data.supplier ?? null,
          status: (data.status ?? "IN_STOCK") as TrackerStatus,
          notes: data.notes ?? null,
        },
      });
      ids.push(created.id);
      await logAudit(tx, {
        entityType: "tracker",
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
