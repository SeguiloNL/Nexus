import { prisma } from "@/lib/prisma";
import { logAudit, diffObject } from "./audit.service";
import type {
  CreateSimInput,
  PaginatedResult,
  SimFilterParams,
  UpdateSimInput,
} from "@/types/domain";
import type { SimStatus, UserRole } from "@/types/enums";
import type { Prisma, SIM as PrismaSim } from "@prisma/client";

type Ctx = { userId: string; userRole: UserRole };

function includeDetail(): Prisma.SIMInclude {
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
      },
    },
  };
}

export async function findManySims(
  params: SimFilterParams & { viewerRole?: UserRole }
): Promise<PaginatedResult<PrismaSim>> {
  const {
    page = 1,
    perPage = 25,
    sort = "createdAt",
    order = "desc",
    search,
    status,
    provider,
  } = params;

  const where: Prisma.SIMWhereInput = { deletedAt: null };

  if (status) (where.status as any) = status;
  if (provider) where.provider = { contains: provider, mode: "insensitive" };

  if (search) {
    const s = search.trim();
    where.OR = [
      { iccid: { contains: s } },
      { msisdn: { contains: s } },
      { imsi: { contains: s } },
      { provider: { contains: s, mode: "insensitive" } },
    ];
  }

  const sortKey: keyof Prisma.SIMOrderByWithRelationInput =
    sort === "iccid"
      ? "iccid"
      : sort === "msisdn"
        ? "msisdn"
        : sort === "provider"
          ? "provider"
          : sort === "status"
            ? "status"
            : "createdAt";

  const skip = (page - 1) * perPage;

  const [total, data] = await Promise.all([
    prisma.sIM.count({ where }),
    prisma.sIM.findMany({
      where,
      orderBy: { [sortKey]: order } as Prisma.SIMOrderByWithRelationInput,
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

export async function findSimById(id: string) {
  return prisma.sIM.findUnique({
    where: { id, deletedAt: null },
    include: includeDetail(),
  });
}

export async function createSim(
  input: CreateSimInput,
  ctx: Ctx
): Promise<PrismaSim> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.sIM.create({
      data: {
        iccid: input.iccid,
        msisdn: input.msisdn ?? null,
        imsi: input.imsi ?? null,
        provider: input.provider.trim(),
        simType: input.simType ?? null,
        apn: input.apn ?? null,
        status: (input.status ?? "IN_STOCK") as SimStatus,
        providerActivationDate: input.providerActivationDate ?? null,
        providerDeactivationDate: input.providerDeactivationDate ?? null,
        notes: input.notes ?? null,
      },
    });

    await logAudit(tx, {
      entityType: "sim",
      entityId: created.id,
      action: "CREATE",
      userId: ctx.userId,
      newValues: created as unknown as Record<string, unknown>,
    });

    return created;
  });
}

export async function updateSim(
  id: string,
  input: UpdateSimInput,
  ctx: Ctx
): Promise<PrismaSim> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sIM.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const data: Prisma.SIMUpdateInput = {};
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) (data as any)[k] = v;
    }

    const updated = await tx.sIM.update({
      where: { id },
      data,
    });

    const { oldValues, newValues } = diffObject(
      existing as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>
    );

    if (oldValues || newValues) {
      await logAudit(tx, {
        entityType: "sim",
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

export async function softDeleteSim(
  id: string,
  ctx: Ctx
): Promise<PrismaSim> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sIM.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });

    const updated = await tx.sIM.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await logAudit(tx, {
      entityType: "sim",
      entityId: updated.id,
      action: "DELETE",
      userId: ctx.userId,
      oldValues: existing as unknown as Record<string, unknown>,
    });

    return updated;
  });
}

export async function listAssignableSims() {
  return prisma.sIM
    .findMany({
      where: {
        deletedAt: null,
        status: "IN_STOCK",
        assignments: { none: { endAt: null } },
      },
      select: {
        id: true,
        iccid: true,
        msisdn: true,
        provider: true,
      },
      orderBy: { iccid: "asc" },
    })
    .then((rows) =>
      rows.map((r) => ({
        id: r.id,
        label: `${r.provider} · ICCID ${r.iccid}${r.msisdn ? ` · MSISDN ${r.msisdn}` : ""}`,
      }))
    );
}

export interface SimCsvImportRow {
  iccid: string;
  msisdn?: string;
  imsi?: string;
  provider: string;
  simType?: string;
  apn?: string;
  providerActivationDate?: string;
  providerDeactivationDate?: string;
  notes?: string;
}

import { CreateSimSchema } from "@/server/validators/sim";

export interface SimCsvImportPreviewResult {
  valid: Array<{ row: number; data: CreateSimInput }>;
  invalid: Array<{ row: number; errors: Record<string, string[]>; raw: any }>;
  total: number;
}

export function previewSimCsvImport(
  rows: SimCsvImportRow[]
): SimCsvImportPreviewResult {
  const valid: SimCsvImportPreviewResult["valid"] = [];
  const invalid: SimCsvImportPreviewResult["invalid"] = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const result = CreateSimSchema.safeParse(raw);
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

export async function bulkImportSims(
  validRows: SimCsvImportPreviewResult["valid"],
  ctx: Ctx
): Promise<{ count: number; ids: string[] }> {
  const ids: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const { row, data } of validRows) {
      const created = await tx.sIM.create({
        data: {
          iccid: data.iccid,
          msisdn: data.msisdn ?? null,
          imsi: data.imsi ?? null,
          provider: data.provider.trim(),
          simType: data.simType ?? null,
          apn: data.apn ?? null,
          status: (data.status ?? "IN_STOCK") as SimStatus,
          providerActivationDate: data.providerActivationDate ?? null,
          providerDeactivationDate: data.providerDeactivationDate ?? null,
          notes: data.notes ?? null,
        },
      });
      ids.push(created.id);
      await logAudit(tx, {
        entityType: "sim",
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
