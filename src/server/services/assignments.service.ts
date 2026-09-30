import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import { pickAuth, requirePermission, PermissionError } from "@/lib/rbac";
import type { Prisma } from "@prisma/client";
import type {
  TrackerAssignment,
  SimAssignment,
  Tracker,
  SIM,
  TrackerStatus as TrackerStatusEnum,
  SimStatus as SimStatusEnum,
  AssignmentReason,
} from "@prisma/client";
import type { UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

type Ctx = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerScope?: string[];
  permissions?: PermissionBits;
};

export async function findActiveTrackerAssignment(tx: any, trackerId: string) {
  return tx.trackerAssignment.findFirst({
    where: { trackerId, endAt: null },
    orderBy: { startAt: "desc" as const },
  });
}

export async function findActiveSimAssignment(tx: any, simId: string) {
  return tx.simAssignment.findFirst({
    where: { simId, endAt: null },
    orderBy: { startAt: "desc" as const },
  });
}

export async function assignTracker(
  subscriptionId: string,
  trackerId: string,
  ctx: Ctx,
  opts: { vehicleId?: string; reason?: AssignmentReason } = {}
): Promise<TrackerAssignment> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId, deletedAt: null },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const tracker = await tx.tracker.findUniqueOrThrow({
      where: { id: trackerId, deletedAt: null },
    });

    if (tracker.status !== "IN_STOCK" && tracker.status !== "RESERVED") {
      throw new Error(
        `Tracker status is ${tracker.status}; alleen IN_STOCK of RESERVED kan toegewezen worden.`
      );
    }

    const active: any = await findActiveTrackerAssignment(tx, trackerId);
    if (active) {
      throw new Error(
        `Tracker ${tracker.serialNumber} heeft reeds een actieve assignment (id=${active.id}).`
      );
    }

    const updated = await tx.tracker.update({
      where: { id: trackerId },
      data: { status: "ACTIVE" as TrackerStatusEnum },
    });

    const assignment = await tx.trackerAssignment.create({
      data: {
        subscriptionId: sub.id,
        trackerId: tracker.id,
        vehicleId: opts.vehicleId ?? null,
        startAt: new Date(),
        reason: opts.reason ?? ("INITIAL" as any),
        createdById: ctx.userId,
      },
    });

    await logAudit(tx, {
      entityType: "trackerAssignment",
      entityId: assignment.id,
      action: "ASSIGN_TRACKER",
      userId: ctx.userId,
      newValues: {
        subscriptionId: sub.id,
        trackerId: tracker.id,
        vehicleId: opts.vehicleId ?? null,
        reason: opts.reason ?? "INITIAL",
      } as any,
    });

    return assignment;
  }, { isolationLevel: "Serializable" });
}

export async function unassignTracker(
  trackerId: string,
  ctx: Ctx,
  opts: { newStatus?: TrackerStatusEnum; reason?: string } = {}
): Promise<TrackerAssignment> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    const active: any = await findActiveTrackerAssignment(tx, trackerId);
    if (!active) {
      throw new Error(`Geen actieve tracker assignment gevonden.`);
    }

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const sub = await tx.subscription.findUnique({
        where: { id: active.subscriptionId },
        select: { customerId: true },
      });
      if (!sub || !ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const closed = await tx.trackerAssignment.update({
      where: { id: active.id },
      data: {
        endAt: new Date(),
        reason: opts.reason ? ("REMOVED" as any) : active.reason,
      },
    });
    const updatedTracker = await tx.tracker.update({
      where: { id: trackerId },
      data: { status: opts.newStatus ?? ("IN_STOCK" as any) },
    });

    await logAudit(tx, {
      entityType: "trackerAssignment",
      entityId: closed.id,
      action: "UNASSIGN_TRACKER",
      userId: ctx.userId,
      oldValues: { endAt: null, trackerStatus: "ACTIVE" } as any,
      newValues: {
        endAt: closed.endAt,
        trackerStatus: updatedTracker.status,
        reason: opts.reason ?? null,
      } as any,
    });

    return closed;
  });
}

export async function replaceTracker(
  subscriptionId: string,
  oldTrackerId: string,
  newTrackerId: string,
  oldTrackerStatus: TrackerStatusEnum,
  ctx: Ctx,
  reason?: AssignmentReason
): Promise<{ old: TrackerAssignment; replacement: TrackerAssignment }> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    if (oldTrackerId === newTrackerId) {
      throw new Error("Nieuwe tracker is dezelfde als de oude.");
    }

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const sub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: { customerId: true },
      });
      if (!sub || !ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const newTracker = await tx.tracker.findUniqueOrThrow({
      where: { id: newTrackerId, deletedAt: null },
    });
    if (newTracker.status !== "IN_STOCK" && newTracker.status !== "RESERVED") {
      throw new Error(
        `Nieuwe tracker status is ${newTracker.status}; alleen IN_STOCK of RESERVED is toegestaan.`
      );
    }

    const active: any = await findActiveTrackerAssignment(tx, oldTrackerId);
    if (!active) {
      throw new Error(`Oude tracker heeft geen actieve assignment.`);
    }

    const oldClosed = await tx.trackerAssignment.update({
      where: { id: active.id },
      data: {
        endAt: new Date(),
        reason: reason ?? ("REPLACEMENT" as any),
      },
    });

    await tx.tracker.update({
      where: { id: oldTrackerId },
      data: { status: oldTrackerStatus },
    });

    const newAssigned = await tx.tracker.update({
      where: { id: newTrackerId },
      data: { status: "ACTIVE" as TrackerStatusEnum },
    });

    const newAssignment = await tx.trackerAssignment.create({
      data: {
        subscriptionId,
        trackerId: newTrackerId,
        vehicleId: active.vehicleId ?? null,
        startAt: new Date(),
        reason: reason ?? ("REPLACEMENT" as any),
        createdById: ctx.userId,
      },
    });

    await logAudit(tx, {
      entityType: "subscription",
      entityId: subscriptionId,
      action: "REPLACE_TRACKER",
      userId: ctx.userId,
      oldValues: {
        trackerId: oldTrackerId,
      } as any,
      newValues: {
        trackerId: newTrackerId,
        reason: reason ?? "REPLACEMENT",
      } as any,
    });

    return { old: oldClosed, replacement: newAssignment };
  }, { isolationLevel: "Serializable" });
}

// -------- SIM assignments --------

export async function assignSim(
  subscriptionId: string,
  simId: string,
  ctx: Ctx,
  opts: { reason?: AssignmentReason } = {}
): Promise<SimAssignment> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId, deletedAt: null },
    });

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      if (!ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const sim = await tx.sIM.findUniqueOrThrow({
      where: { id: simId, deletedAt: null },
    });

    if (sim.status !== "IN_STOCK" && sim.status !== "RESERVED") {
      throw new Error(
        `SIM status is ${sim.status}; alleen IN_STOCK of RESERVED kan toegewezen worden.`
      );
    }

    const active = await findActiveSimAssignment(tx, simId);
    if (active) {
      throw new Error(`SIM ${sim.iccid} heeft reeds een actieve assignment.`);
    }

    await tx.sIM.update({
      where: { id: simId },
      data: { status: "ACTIVE" as SimStatusEnum },
    });

    const assignment = await tx.simAssignment.create({
      data: {
        subscriptionId: sub.id,
        simId: sim.id,
        startAt: new Date(),
        reason: opts.reason ?? ("INITIAL" as any),
        createdById: ctx.userId,
      },
    });

    await logAudit(tx, {
      entityType: "simAssignment",
      entityId: assignment.id,
      action: "ASSIGN_SIM",
      userId: ctx.userId,
      newValues: {
        subscriptionId: sub.id,
        simId: sim.id,
        reason: opts.reason ?? "INITIAL",
      } as any,
    });

    return assignment;
  }, { isolationLevel: "Serializable" });
}

export async function unassignSim(
  simId: string,
  ctx: Ctx,
  opts: { newStatus?: SimStatusEnum; reason?: string } = {}
): Promise<SimAssignment> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    const active: any = await findActiveSimAssignment(tx, simId);
    if (!active) {
      throw new Error(`Geen actieve SIM assignment gevonden.`);
    }

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const sub = await tx.subscription.findUnique({
        where: { id: active.subscriptionId },
        select: { customerId: true },
      });
      if (!sub || !ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const closed = await tx.simAssignment.update({
      where: { id: active.id },
      data: {
        endAt: new Date(),
        reason: opts.reason ? ("REMOVED" as any) : active.reason,
      },
    });
    const updatedSim = await tx.sIM.update({
      where: { id: simId },
      data: { status: opts.newStatus ?? ("IN_STOCK" as any) },
    });

    await logAudit(tx, {
      entityType: "simAssignment",
      entityId: closed.id,
      action: "UNASSIGN_SIM",
      userId: ctx.userId,
      oldValues: { endAt: null, simStatus: "ACTIVE" } as any,
      newValues: {
        endAt: closed.endAt,
        simStatus: updatedSim.status,
        reason: opts.reason ?? null,
      } as any,
    });

    return closed;
  });
}

export async function replaceSim(
  subscriptionId: string,
  oldSimId: string,
  newSimId: string,
  oldSimStatus: SimStatusEnum,
  ctx: Ctx,
  reason?: AssignmentReason
): Promise<{ old: SimAssignment; replacement: SimAssignment }> {
  await requirePermission(pickAuth(ctx), "edit", "subscription");
  return prisma.$transaction(async (tx) => {
    if (oldSimId === newSimId) {
      throw new Error("Nieuwe SIM is dezelfde als de oude.");
    }

    if (ctx.customerScope && ctx.customerScope.length > 0) {
      const sub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: { customerId: true },
      });
      if (!sub || !ctx.customerScope.includes(sub.customerId)) {
        throw new PermissionError("Onvoldoende rechten: deze subscription valt niet binnen je toegang.");
      }
    }

    const newSim = await tx.sIM.findUniqueOrThrow({
      where: { id: newSimId, deletedAt: null },
    });
    if (newSim.status !== "IN_STOCK" && newSim.status !== "RESERVED") {
      throw new Error(
        `Nieuwe SIM status is ${newSim.status}; alleen IN_STOCK of RESERVED is toegestaan.`
      );
    }
    const active: any = await findActiveSimAssignment(tx, oldSimId);
    if (!active) {
      throw new Error(`Oude SIM heeft geen actieve assignment.`);
    }
    const oldClosed = await tx.simAssignment.update({
      where: { id: active.id },
      data: {
        endAt: new Date(),
        reason: reason ?? ("REPLACEMENT" as any),
      },
    });
    await tx.sIM.update({
      where: { id: oldSimId },
      data: { status: oldSimStatus },
    });
    await tx.sIM.update({
      where: { id: newSimId },
      data: { status: "ACTIVE" as SimStatusEnum },
    });
    const newAssignment = await tx.simAssignment.create({
      data: {
        subscriptionId,
        simId: newSimId,
        startAt: new Date(),
        reason: reason ?? ("REPLACEMENT" as any),
        createdById: ctx.userId,
      },
    });
    await logAudit(tx, {
      entityType: "subscription",
      entityId: subscriptionId,
      action: "REPLACE_SIM",
      userId: ctx.userId,
      oldValues: { simId: oldSimId } as any,
      newValues: { simId: newSimId, reason: reason ?? "REPLACEMENT" } as any,
    });
    return { old: oldClosed, replacement: newAssignment };
  }, { isolationLevel: "Serializable" });
}
