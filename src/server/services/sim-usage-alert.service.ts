import { prisma } from "@/lib/prisma";
import { collectUserCustomerIds } from "@/lib/rbac";
import { RoleScope } from "@/types/enums";
import {
  AlertThresholdLevel,
  NotificationChannel,
  type SIM,
  type User,
  type UserNotificationSettings,
  type Role,
} from "@prisma/client";
import {
  sendSimUsageThresholdEmail,
  type SimUsageThresholdEmailItem,
  type EmailSendResult,
} from "./email.service";

type RbacRoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export interface SimWithCustomerAndUsage {
  id: string;
  iccid: string | null;
  msisdn: string | null;
  simName: string | null;
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  lowestDataLimitBytes: bigint | null;
  usagePeriodStart: Date | null;
  usageLocalProductName: string | null;
  status: string;
  customerId: string | null;
  customerName: string | null;
  customerNumber: string | null;
}

type UserCoreWithRoleId = Pick<
  User,
  "id" | "name" | "email" | "isActive" | "roleId"
>;

export type UserCoreScoped = UserCoreWithRoleId & {
  roleScope: RbacRoleScope | null;
};

export interface UserNotificationSettingsWithUser
  extends UserNotificationSettings {
  user: UserCoreScoped;
}

export interface UsageAlertCycleReport {
  usersChecked: number;
  usersEnabledForEmail: number;
  usersWithAlerts: number;
  usersNotified: number;
  usersNotifiedDryRun: number;
  userSendFailures: number;
  simsAtThresholdTotal: number;
  simsSkippedAlreadySent: number;
  simsSkippedScope: number;
  simsReportedEmails: number;
  alertsCreated: number;
  dryRun: boolean;
  details: Array<{
    userId: string;
    email: string;
    name: string;
    notifyAllSims: boolean;
    roleScope: string | null;
    simsTotalInScopeAtThreshold: number;
    simsToReport: number;
    simsPreviouslyAlerted: number;
    emailResult: EmailSendResult | null;
    errorMessage?: string;
  }>;
}

export function getEffectiveDataLimit(sim: {
  dataLimitBytes: bigint | null;
  lowestDataLimitBytes: bigint | null;
}): bigint | null {
  if (sim.dataLimitBytes !== null && sim.dataLimitBytes > 0n) return sim.dataLimitBytes;
  if (sim.lowestDataLimitBytes !== null && sim.lowestDataLimitBytes > 0n)
    return sim.lowestDataLimitBytes;
  return null;
}

export function isDataAboveThreshold(
  sim: {
    dataUsedBytes: bigint | null;
    dataLimitBytes: bigint | null;
    lowestDataLimitBytes: bigint | null;
  },
  thresholdPercent: number = 80
): boolean {
  if (thresholdPercent <= 0 || thresholdPercent >= 100) {
    thresholdPercent = 80;
  }
  if (sim.dataUsedBytes === null || sim.dataUsedBytes <= 0n) return false;
  const limit = getEffectiveDataLimit(sim);
  if (limit === null || limit <= 0n) return false;
  const pctBig = BigInt(Math.round(thresholdPercent));
  return sim.dataUsedBytes * 100n >= limit * pctBig;
}

export function actualUsagePercent(sim: {
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  lowestDataLimitBytes: bigint | null;
}): number {
  if (sim.dataUsedBytes === null || sim.dataUsedBytes <= 0n) return 0;
  const limit = getEffectiveDataLimit(sim);
  if (limit === null || limit <= 0n) return 0;
  return Math.min(
    999,
    Math.round((Number(sim.dataUsedBytes) / Number(limit)) * 100)
  );
}

export async function getSimsRequiringAlert(
  thresholdPercent: number = 80
): Promise<SimWithCustomerAndUsage[]> {
  const rows = await prisma.sIM.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      iccid: true,
      msisdn: true,
      simName: true,
      dataUsedBytes: true,
      dataLimitBytes: true,
      lowestDataLimitBytes: true,
      usagePeriodStart: true,
      usageLocalProductName: true,
      status: true,
      assignments: {
        where: { endAt: null },
        take: 1,
        select: {
          subscription: {
            select: {
              customer: {
                select: { id: true, companyName: true, customerNumber: true },
              },
            },
          },
        },
      },
    },
  });

  const mapped: SimWithCustomerAndUsage[] = rows.map((s) => {
    const ass = s.assignments[0];
    const cust = ass?.subscription?.customer ?? null;
    return {
      id: s.id,
      iccid: s.iccid,
      msisdn: s.msisdn,
      simName: s.simName,
      dataUsedBytes: s.dataUsedBytes,
      dataLimitBytes: s.dataLimitBytes,
      lowestDataLimitBytes: s.lowestDataLimitBytes,
      usagePeriodStart: s.usagePeriodStart ?? null,
      usageLocalProductName: s.usageLocalProductName,
      status: s.status,
      customerId: cust?.id ?? null,
      customerName: cust?.companyName ?? null,
      customerNumber: cust?.customerNumber ?? null,
    };
  });

  return mapped.filter((s) => isDataAboveThreshold(s, thresholdPercent));
}

async function buildRoleScopeMap(
  roleIds: string[]
): Promise<Map<string, RbacRoleScope>> {
  const uniq = Array.from(new Set(roleIds.filter((x) => !!x)));
  if (uniq.length === 0) return new Map();
  const roles: Array<Pick<Role, "id" | "scope">> = await prisma.role.findMany({
    where: { id: { in: uniq } },
    select: { id: true, scope: true },
  });
  const map = new Map<string, RbacRoleScope>();
  for (const r of roles) {
    map.set(r.id, r.scope as RbacRoleScope);
  }
  return map;
}

function attachScope<U extends UserCoreWithRoleId>(
  user: U,
  roleScopes: Map<string, RbacRoleScope>
): U & { roleScope: RbacRoleScope | null } {
  return {
    ...user,
    roleScope: user.roleId ? roleScopes.get(user.roleId) ?? null : null,
  };
}

export async function getUsersEligibleForAlerts(): Promise<
  Array<UserNotificationSettings & { user: UserCoreWithRoleId }>
> {
  const rows = await prisma.userNotificationSettings.findMany({
    where: {
      enabledEmail: true,
      enabledDataThresholdAlert: true,
      user: { isActive: true },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          roleId: true,
        },
      },
    },
  });
  return rows as Array<
    UserNotificationSettings & { user: UserCoreWithRoleId }
  >;
}

async function getAllEligibleUsersWithDefaults(): Promise<
  UserNotificationSettingsWithUser[]
> {
  const explicit = await getUsersEligibleForAlerts();
  const explicitIds = new Set(explicit.map((r) => r.userId));

  const implicitUsers: UserCoreWithRoleId[] = await prisma.user.findMany({
    where: {
      isActive: true,
      email: { not: "" },
      NOT: { id: { in: Array.from(explicitIds) } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      roleId: true,
    },
  });

  const allRoleIds = [
    ...explicit.map((r) => r.user.roleId),
    ...implicitUsers.map((u) => u.roleId),
  ].filter((x): x is string => !!x);
  const roleScopes = await buildRoleScopeMap(allRoleIds);

  const explicitWithScope: UserNotificationSettingsWithUser[] = explicit.map(
    (r) => ({
      ...r,
      user: attachScope(r.user, roleScopes),
    })
  );

  const implicitRows: UserNotificationSettingsWithUser[] = implicitUsers.map(
    (u) => {
      const us = attachScope(u, roleScopes);
      return {
        id: "virtual_" + u.id,
        userId: u.id,
        enabledEmail: true,
        enabledDataThresholdAlert: true,
        dataThresholdPercent: 80,
        notifyAllSims: false,
        channels: [NotificationChannel.EMAIL],
        lastNotificationAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: us,
      };
    }
  );

  return [...explicitWithScope, ...implicitRows];
}

const SIM_DETAIL_PATH = (simId: string) => `/sims/${simId}`;

function buildPeriodKey(usagePeriodStart: Date | null): Date | null {
  if (usagePeriodStart) return usagePeriodStart;
  return null;
}

export async function runUsageAlertNotificationCycle(
  opts: {
    thresholdPercentOverride?: number;
    limitUsers?: number;
    dryRunForce?: boolean;
  } = {}
): Promise<UsageAlertCycleReport> {
  const users = await getAllEligibleUsersWithDefaults();
  const allAtThreshold = await getSimsRequiringAlert(80);

  const report: UsageAlertCycleReport = {
    usersChecked: users.length,
    usersEnabledForEmail: users.length,
    usersWithAlerts: 0,
    usersNotified: 0,
    usersNotifiedDryRun: 0,
    userSendFailures: 0,
    simsAtThresholdTotal: allAtThreshold.length,
    simsSkippedAlreadySent: 0,
    simsSkippedScope: 0,
    simsReportedEmails: 0,
    alertsCreated: 0,
    dryRun: !!opts.dryRunForce,
    details: [],
  };

  if (users.length === 0 || allAtThreshold.length === 0) return report;

  const alreadySentRows = await prisma.simUsageAlert.findMany({
    where: {
      simId: { in: allAtThreshold.map((s) => s.id) },
      thresholdLevel: AlertThresholdLevel.WARNING_80,
      channel: NotificationChannel.EMAIL,
    },
    select: {
      userId: true,
      simId: true,
      thresholdLevel: true,
      usagePeriodStart: true,
    },
  });

  type AlertKey = string;
  const alertKeyOf = (
    userId: string,
    simId: string,
    usagePeriodStart: Date | null
  ): AlertKey =>
    usagePeriodStart
      ? `${userId}|${simId}|${usagePeriodStart.toISOString()}`
      : `${userId}|${simId}|__no_period__`;

  const alreadySent = new Set<AlertKey>(
    alreadySentRows.map((r) => alertKeyOf(r.userId, r.simId, r.usagePeriodStart))
  );

  const limitUsers = opts.limitUsers ?? 2000;

  let processedUsers = 0;
  for (const row of users) {
    if (processedUsers++ >= limitUsers) break;

    const u = row.user;
    if (!u.email) continue;

    const userPct = opts.thresholdPercentOverride ?? row.dataThresholdPercent ?? 80;
    const roleScope = u.roleScope;
    const isInternal = roleScope === "INTERNAL";
    const useAllSims = isInternal && !!row.notifyAllSims;

    let scopeCustomerIds: Set<string> | null = null;
    if (!useAllSims) {
      const ids = await collectUserCustomerIds(u.id).catch(() => [] as string[]);
      scopeCustomerIds = new Set(ids);
      if (scopeCustomerIds.size === 0) {
        const filteredByStatus = allAtThreshold.filter((s) => {
          if (!isDataAboveThreshold(s, userPct)) return false;
          return true;
        });
        report.simsSkippedScope += filteredByStatus.length;
        report.details.push({
          userId: u.id,
          email: u.email,
          name: u.name,
          notifyAllSims: !!row.notifyAllSims,
          roleScope,
          simsTotalInScopeAtThreshold: 0,
          simsToReport: 0,
          simsPreviouslyAlerted: 0,
          emailResult: null,
          errorMessage:
            "Lege customer scope — geen SIMs om over te rapporteren (en 'Alle SIMs' staat uit).",
        });
        continue;
      }
    }

    const simsInScope: SimWithCustomerAndUsage[] = [];
    for (const sim of allAtThreshold) {
      if (!isDataAboveThreshold(sim, userPct)) continue;
      if (useAllSims) {
        simsInScope.push(sim);
      } else if (sim.customerId && scopeCustomerIds!.has(sim.customerId)) {
        simsInScope.push(sim);
      } else {
        report.simsSkippedScope++;
      }
    }

    if (simsInScope.length === 0) {
      report.details.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        notifyAllSims: !!row.notifyAllSims,
        roleScope,
        simsTotalInScopeAtThreshold: 0,
        simsToReport: 0,
        simsPreviouslyAlerted: 0,
        emailResult: null,
      });
      continue;
    }

    const simsToReport: SimWithCustomerAndUsage[] = [];
    let alreadyAlertedCount = 0;
    for (const sim of simsInScope) {
      const k = alertKeyOf(u.id, sim.id, buildPeriodKey(sim.usagePeriodStart));
      if (alreadySent.has(k)) {
        alreadyAlertedCount++;
        report.simsSkippedAlreadySent++;
      } else {
        simsToReport.push(sim);
      }
    }

    report.usersWithAlerts++;
    if (simsToReport.length === 0) {
      report.details.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        notifyAllSims: !!row.notifyAllSims,
        roleScope,
        simsTotalInScopeAtThreshold: simsInScope.length,
        simsToReport: 0,
        simsPreviouslyAlerted: alreadyAlertedCount,
        emailResult: null,
        errorMessage:
          "Alle SIMs in scope werden reeds gerapporteerd in deze periode (anti-spam guard).",
      });
      continue;
    }

    const items: SimUsageThresholdEmailItem[] = simsToReport.map((s) => ({
      simId: s.id,
      simName: s.simName,
      iccid: s.iccid,
      msisdn: s.msisdn,
      customerName: s.customerName,
      dataUsedBytes: s.dataUsedBytes ?? 0n,
      dataLimitBytes: getEffectiveDataLimit(s) ?? 0n,
      thresholdPercent: userPct,
      detailUrl: SIM_DETAIL_PATH(s.id),
    }));

    let emailResult: EmailSendResult;
    if (opts.dryRunForce) {
      emailResult = {
        dryRun: true,
        accepted: [],
        rejected: [],
        error: "Geforceerde dry-run via optie.",
      };
    } else {
      try {
        emailResult = await sendSimUsageThresholdEmail({
          toEmail: u.email,
          toName: u.name || "Gebruiker",
          thresholdPercent: userPct,
          items,
        });
      } catch (e: any) {
        emailResult = {
          dryRun: false,
          accepted: [],
          rejected: [u.email],
          error: e?.message ?? String(e),
        };
      }
    }

    if (emailResult.dryRun) {
      report.usersNotifiedDryRun++;
    } else if (
      emailResult.accepted.length > 0 &&
      !emailResult.rejected.includes(u.email) &&
      !emailResult.error
    ) {
      report.usersNotified++;
    } else {
      report.userSendFailures++;
    }

    let alertsCreatedForUser = 0;
    const actuallySent =
      !emailResult.dryRun &&
      emailResult.accepted.length > 0 &&
      !emailResult.rejected.includes(u.email) &&
      !emailResult.error;

    if (actuallySent && !opts.dryRunForce) {
      const now = new Date();
      const createData = simsToReport.map((s) => ({
        userId: u.id,
        simId: s.id,
        thresholdLevel: AlertThresholdLevel.WARNING_80,
        dataUsedBytes: s.dataUsedBytes ?? 0n,
        dataLimitBytes: getEffectiveDataLimit(s) ?? 0n,
        usagePeriodStart: s.usagePeriodStart,
        channel: NotificationChannel.EMAIL,
        sentAt: now,
      }));

      for (const d of createData) {
        try {
          await prisma.simUsageAlert.create({ data: d });
          alertsCreatedForUser++;
          report.alertsCreated++;
          alreadySent.add(alertKeyOf(u.id, d.simId, d.usagePeriodStart));
        } catch (e) {
          if (
            e instanceof Error &&
            /unique|duplicate/i.test((e as any)?.code ?? (e as any)?.message ?? "")
          ) {
            report.simsSkippedAlreadySent++;
          }
        }
      }

      await prisma.userNotificationSettings
        .upsert({
          where: { userId: u.id },
          create: {
            userId: u.id,
            enabledEmail: row.enabledEmail,
            enabledDataThresholdAlert: row.enabledDataThresholdAlert,
            dataThresholdPercent: row.dataThresholdPercent,
            notifyAllSims: row.notifyAllSims,
            channels: { set: [NotificationChannel.EMAIL] },
            lastNotificationAt: now,
          },
          update: { lastNotificationAt: now },
        })
        .catch(() => null);
    }

    report.simsReportedEmails += simsToReport.length;

    report.details.push({
      userId: u.id,
      email: u.email,
      name: u.name,
      notifyAllSims: !!row.notifyAllSims,
      roleScope,
      simsTotalInScopeAtThreshold: simsInScope.length,
      simsToReport: simsToReport.length,
      simsPreviouslyAlerted: alreadyAlertedCount,
      emailResult,
      errorMessage:
        emailResult.error ??
        (emailResult.rejected.length > 0
          ? `Niet geaccepteerd: ${emailResult.rejected.join(", ")}`
          : undefined),
    });
  }

  return report;
}
