import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import type {
  AssignSimInput,
  AssignTrackerInput,
  OperationContext,
  ReplaceSimInput,
  ReplaceTrackerInput,
  UnassignSimInput,
  UnassignTrackerInput,
} from "@/types/domain";
import { AuditAction, AssignmentReason } from "@/types/enums";
import { TrackerStatus, SimStatus } from "@/types/enums";
import type { PrismaClient, TrackerAssignment, SimAssignment } from "@prisma/client";

type TxAware = Omit<PrismaClient, never>;

function withTx(tx?: PrismaClient): TxAware {
  return (tx ?? prisma) as unknown as TxAware;
}

class AssetAssignedError extends Error {
  constructor(assetType: "tracker" | "sim", id: string) {
    super(
      assetType === "tracker"
        ? `Tracker is al actief toegewezen (${id})`
        : `SIM is al actief toegewezen (${id})`
    );
    this.name = "AssetAssignedError";
  }
}

class AssetNotAssignableError extends Error {
  constructor(
    assetType: "tracker" | "sim",
    id: string,
    status: string,
    expected: string[]
  ) {
    super(
      `${assetType === "tracker" ? "Tracker" : "SIM"} ${id} heeft status ${status}, moet een van: ${expected.join(", ")}`
    );
    this.name = "AssetNotAssignableError";
  }
}

// ---- TRACKER ----

export async function assignTracker(
  input: AssignTrackerInput,
  ctx: OperationContext,
  tx?: PrismaClient
): Promise<TrackerAssignment> {
  const db = withTx(tx);
  return (db as any).$transaction(async (trx: any) => {
    const { trackerId, subscriptionId, vehicleId, reason } = input;
    await trx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { id: true, customerId: true },
    });

    const trackerLocked = await trx.$queryRawUnsafe(
      `SELECT "id", "status"::text AS status FROM "trackers" WHERE "id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      trackerId
    ) as Array<{ id: string; status: string }>;
    if (!trackerLocked.length) {
      throw new Error(`Tracker ${trackerId} niet gevonden`);
    }
    const tracker = trackerLocked[0];
    const assignable = [
      String(TrackerStatus.IN_STOCK),
      String(TrackerStatus.RESERVED),
    ];
    if (!assignable.includes(tracker.status)) {
      throw new Error(
        `Tracker ${trackerId} heeft status ${tracker.status}, moet een van: ${assignable.join(", ")}`
      );
    }

    const active = await trx.trackerAssignment.findFirst({
      where: { trackerId, endAt: null },
      select: { id: true },
    });
    if (active) {
      throw new Error(`Tracker is al actief toegewezen (${trackerId})`);
    }

    const now = new Date();
    const assignment = await trx.trackerAssignment.create({
      data: {
        subscriptionId,
        trackerId,
        vehicleId: vehicleId ?? null,
        startAt: now,
        reason: reason ?? AssignmentReason.INITIAL,
        createdById: ctx.userId,
      },
    });

    await trx.tracker.update({
      where: { id: trackerId },
      data: { status: TrackerStatus.ACTIVE },
    });

    await logAudit(trx as any, {
      entityType: "tracker",
      entityId: trackerId,
      action: AuditAction.ASSIGN_TRACKER,
      userId: ctx.userId,
      newValues: {
        subscriptionId,
        vehicleId: vehicleId ?? null,
        newStatus: "ACTIVE",
        reason: reason ?? AssignmentReason.INITIAL,
      },
      metadata: { subscriptionId, assignmentId: assignment.id },
    });

    return assignment;
  });
}

export async function unassignTracker(
  input: UnassignTrackerInput,
  ctx: OperationContext,
  tx: PrismaClient = require("@/lib/prisma").prisma as unknown as PrismaClient
): Promise<TrackerAssignment> {
  return (tx as any).$transaction(async (db: any) => {
    const { trackerId, newTrackerStatus, reason } = input;

    const trackerLocked = await db.$queryRawUnsafe(
      `SELECT "id" FROM "trackers" WHERE "id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      trackerId
    ) as Array<{ id: string }>;
    if (!trackerLocked.length) {
      throw new Error(`Tracker ${trackerId} niet gevonden`);
    }

    const assignment = await db.trackerAssignment.findFirstOrThrow({
      where: { trackerId, endAt: null },
      orderBy: { startAt: "desc" },
    });

    const now = new Date();
    const updated = await db.trackerAssignment.update({
      where: { id: assignment.id },
      data: {
        endAt: now,
        reason: reason ?? AssignmentReason.REMOVED,
      },
    });

    const nextStatus =
      newTrackerStatus &&
      [
        TrackerStatus.IN_STOCK,
        TrackerStatus.RESERVED,
        TrackerStatus.DEFECTIVE,
        TrackerStatus.RETIRED,
        TrackerStatus.RMA,
        TrackerStatus.LOST,
      ].includes(newTrackerStatus)
        ? newTrackerStatus
        : TrackerStatus.IN_STOCK;

    await db.tracker.update({
      where: { id: trackerId },
      data: { status: nextStatus },
    });

    await logAudit(db as any, {
      entityType: "tracker",
      entityId: trackerId,
      action: AuditAction.UNASSIGN_TRACKER,
      userId: ctx.userId,
      oldValues: { status: "ACTIVE" },
      newValues: { status: nextStatus, assignmentEnd: now.toISOString() },
      metadata: { assignmentId: updated.id, reason: reason },
    });

    return updated;
  }) as Promise<TrackerAssignment>;
}

export async function replaceTracker(
  input: ReplaceTrackerInput,
  ctx: OperationContext,
  tx?: PrismaClient
): Promise<{
  oldAssignment: TrackerAssignment;
  newAssignment: TrackerAssignment;
}> {
  const db = withTx(tx);
  return (db as any).$transaction(async (trx: any) => {
    const oldAssignment = await unassignTracker(
      {
        trackerId: input.oldTrackerId,
        newTrackerStatus: input.oldTrackerDisposition as any,
        reason: AssignmentReason.REPLACEMENT,
      },
      ctx,
      trx as any
    );
    const newAssignment = await assignTracker(
      {
        subscriptionId: input.subscriptionId,
        trackerId: input.newTrackerId,
        reason: AssignmentReason.REPLACEMENT,
      },
      ctx,
      trx as any
    );
    return { oldAssignment, newAssignment };
  });
}

// ---- SIM ----

export async function assignSim(
  input: AssignSimInput,
  ctx: OperationContext,
  tx?: PrismaClient
): Promise<SimAssignment> {
  const db = withTx(tx);
  return (db as any).$transaction(async (trx: any) => {
    const { simId, subscriptionId, reason } = input;
    await trx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: { id: true },
    });

    const simLocked = await trx.$queryRawUnsafe(
      `SELECT "id", "status"::text AS status FROM "sims" WHERE "id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      simId
    ) as Array<{ id: string; status: string }>;
    if (!simLocked.length) {
      throw new Error(`SIM ${simId} niet gevonden`);
    }
    const sim = simLocked[0];
    const assignable = [String(SimStatus.IN_STOCK), String(SimStatus.RESERVED)];
    if (!assignable.includes(sim.status)) {
      throw new Error(
        `SIM ${simId} heeft status ${sim.status}, moet een van: ${assignable.join(", ")}`
      );
    }

    const active = await trx.simAssignment.findFirst({
      where: { simId, endAt: null },
      select: { id: true },
    });
    if (active) {
      throw new Error(`SIM is al actief toegewezen (${simId})`);
    }

    const now = new Date();
    const assignment = await trx.simAssignment.create({
      data: {
        subscriptionId,
        simId,
        startAt: now,
        reason: reason ?? AssignmentReason.INITIAL,
        createdById: ctx.userId,
      },
    });

    await trx.sIM.update({
      where: { id: simId },
      data: { status: SimStatus.ACTIVE },
    });

    await logAudit(trx as any, {
      entityType: "sim",
      entityId: simId,
      action: AuditAction.ASSIGN_SIM,
      userId: ctx.userId,
      newValues: {
        subscriptionId,
        newStatus: "ACTIVE",
        reason: reason ?? AssignmentReason.INITIAL,
      },
      metadata: { subscriptionId, assignmentId: assignment.id },
    });

    return assignment;
  });
}

export async function unassignSim(
  input: UnassignSimInput,
  ctx: OperationContext,
  tx?: PrismaClient
): Promise<SimAssignment> {
  const db = withTx(tx);
  return (db as any).$transaction(async (trx: any) => {
    const { simId, newSimStatus, reason } = input;

    const simLocked = await trx.$queryRawUnsafe(
      `SELECT "id" FROM "sims" WHERE "id" = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      simId
    ) as Array<{ id: string }>;
    if (!simLocked.length) {
      throw new Error(`SIM ${simId} niet gevonden`);
    }

    const assignment = await trx.simAssignment.findFirstOrThrow({
      where: { simId, endAt: null },
      orderBy: { startAt: "desc" },
    });

    const now = new Date();
    const updated = await trx.simAssignment.update({
      where: { id: assignment.id },
      data: {
        endAt: now,
        reason: reason ?? AssignmentReason.REMOVED,
      },
    });

    const allowedNext = [
      SimStatus.IN_STOCK,
      SimStatus.RESERVED,
      SimStatus.BLOCKED,
      SimStatus.RETIRED,
      SimStatus.CANCELLED,
    ];
    const nextStatus =
      newSimStatus && allowedNext.includes(newSimStatus as any)
        ? (newSimStatus as SimStatus)
        : SimStatus.IN_STOCK;

    await trx.sIM.update({
      where: { id: simId },
      data: { status: nextStatus },
    });

    await logAudit(trx as any, {
      entityType: "sim",
      entityId: simId,
      action: AuditAction.UNASSIGN_SIM,
      userId: ctx.userId,
      oldValues: { status: "ACTIVE" },
      newValues: { status: nextStatus, assignmentEnd: now.toISOString() },
      metadata: { assignmentId: updated.id, reason },
    });

    return updated;
  });
}

export async function replaceSim(
  input: ReplaceSimInput,
  ctx: OperationContext,
  tx: PrismaClient = require("@/lib/prisma").prisma as unknown as PrismaClient
): Promise<{
  oldAssignment: SimAssignment;
  newAssignment: SimAssignment;
}> {
  return (tx as any).$transaction(async (db: any) => {
    const oldAssignment = await unassignSim(
      {
        simId: input.oldSimId,
        newSimStatus: input.oldSimDisposition as any,
        reason: AssignmentReason.REPLACEMENT,
      },
      ctx,
      db as any
    );
    const newAssignment = await assignSim(
      {
        subscriptionId: input.subscriptionId,
        simId: input.newSimId,
        reason: AssignmentReason.REPLACEMENT,
      },
      ctx,
      db as any
    );
    return { oldAssignment, newAssignment };
  }) as Promise<{ oldAssignment: SimAssignment; newAssignment: SimAssignment }>;
}
