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

const THRESHOLD_LEVEL_TO_PERCENT: Record<AlertThresholdLevel, number> = {
  [AlertThresholdLevel.WARNING_70]: 70,
  [AlertThresholdLevel.WARNING_80]: 80,
  [AlertThresholdLevel.WARNING_90]: 90,
  [AlertThresholdLevel.CRITICAL_100]: 100,
};

const PERCENT_TO_THRESHOLD_LEVEL: Record<number, AlertThresholdLevel> = {
  70: AlertThresholdLevel.WARNING_70,
  80: AlertThresholdLevel.WARNING_80,
  90: AlertThresholdLevel.WARNING_90,
  100: AlertThresholdLevel.CRITICAL_100,
};

export const DEFAULT_THRESHOLD_LEVELS: AlertThresholdLevel[] = [
  AlertThresholdLevel.WARNING_80,
];

export const USAGE_ALERT_CHECK_INTERVAL_OPTIONS: Array<{
  value: number;
  label: string;
}> = [
  { value: 15, label: "Elke 15 minuten" },
  { value: 30, label: "Elke 30 minuten" },
  { value: 60, label: "Elk uur" },
  { value: 120, label: "Elke 2 uur" },
  { value: 240, label: "Elke 4 uur" },
  { value: 360, label: "Elke 6 uur" },
  { value: 720, label: "Elke 12 uur" },
  { value: 1440, label: "Eenmaal per dag" },
];

export function thresholdLevelToPercent(
  level: AlertThresholdLevel
): number {
  return THRESHOLD_LEVEL_TO_PERCENT[level] ?? 80;
}

export function percentToThresholdLevel(
  pct: number
): AlertThresholdLevel | null {
  return PERCENT_TO_THRESHOLD_LEVEL[Number(pct)] ?? null;
}

export function resolveUserThresholdLevels(
  settings: Pick<
    UserNotificationSettings,
    "thresholdLevels" | "dataThresholdPercent"
  >
): AlertThresholdLevel[] {
  if (
    Array.isArray(settings.thresholdLevels) &&
    settings.thresholdLevels.length > 0
  ) {
    return settings.thresholdLevels;
  }
  const legacy = percentToThresholdLevel(settings.dataThresholdPercent ?? 80);
  if (legacy) return [legacy];
  return DEFAULT_THRESHOLD_LEVELS;
}

export function resolveUserCheckIntervalMinutes(
  settings: Pick<UserNotificationSettings, "usageAlertCheckIntervalMinutes">
): number {
  const raw = settings.usageAlertCheckIntervalMinutes ?? 60;
  if (!Number.isFinite(raw) || raw < 1) return 60;
  return Math.round(raw);
}

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
  usersSkippedInterval: number;
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
    checkIntervalMinutes: number;
    thresholdLevels: string[];
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
  if (thresholdPercent <= 0 || thresholdPercent > 100) {
    thresholdPercent = 80;
  }
  if (sim.dataUsedBytes === null || sim.dataUsedBytes <= 0n) return false;
  const limit = getEffectiveDataLimit(sim);
  if (limit === null || limit <= 0n) return false;
  const pctBig = BigInt(Math.round(thresholdPercent));
  if (thresholdPercent >= 100) {
    return sim.dataUsedBytes >= limit;
  }
  return sim.dataUsedBytes * 200n + limit >= 2n * limit * pctBig;
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

export async function getAllActiveSimsWithUsage(): Promise<
  SimWithCustomerAndUsage[]
> {
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

  return rows.map((s) => {
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
}

export function getSimsAboveThresholdLevels(
  allSims: SimWithCustomerAndUsage[],
  levels: AlertThresholdLevel[]
): SimWithCustomerAndUsage[] {
  if (levels.length === 0) return [];
  const percents = levels.map((l) => thresholdLevelToPercent(l));
  return allSims.filter((s) =>
    percents.some((p) => isDataAboveThreshold(s, p))
  );
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
        thresholdLevels: DEFAULT_THRESHOLD_LEVELS,
        usageAlertCheckIntervalMinutes: 60,
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

type AlertKey = string;
const alertKeyOf = (
  userId: string,
  simId: string,
  thresholdLevel: AlertThresholdLevel,
  usagePeriodStart: Date | null
): AlertKey =>
  usagePeriodStart
    ? `${userId}|${simId}|${thresholdLevel}|${usagePeriodStart.toISOString()}`
    : `${userId}|${simId}|${thresholdLevel}|__no_period__`;

function highestLevelPercentForSim(
  sim: SimWithCustomerAndUsage,
  levels: AlertThresholdLevel[]
): number {
  const sorted = [...levels]
    .map((l) => thresholdLevelToPercent(l))
    .sort((a, b) => b - a);
  for (const p of sorted) {
    if (isDataAboveThreshold(sim, p)) return p;
  }
  return 0;
}

function levelForSimAndPercent(
  percent: number
): AlertThresholdLevel | null {
  return percentToThresholdLevel(percent);
}

export async function runUsageAlertNotificationCycle(
  opts: {
    thresholdPercentOverride?: number;
    limitUsers?: number;
    dryRunForce?: boolean;
  } = {}
): Promise<UsageAlertCycleReport> {
  const users = await getAllEligibleUsersWithDefaults();
  const allSims = await getAllActiveSimsWithUsage();

  const maxPercentAcrossAllUsers = Math.max(
    80,
    ...users.flatMap((u) =>
      resolveUserThresholdLevels(u).map((l) => thresholdLevelToPercent(l))
    )
  );
  const allAtAnyThreshold = allSims.filter((s) =>
    isDataAboveThreshold(s, Math.min(70, maxPercentAcrossAllUsers))
  );

  const report: UsageAlertCycleReport = {
    usersChecked: users.length,
    usersEnabledForEmail: users.length,
    usersSkippedInterval: 0,
    usersWithAlerts: 0,
    usersNotified: 0,
    usersNotifiedDryRun: 0,
    userSendFailures: 0,
    simsAtThresholdTotal: allAtAnyThreshold.length,
    simsSkippedAlreadySent: 0,
    simsSkippedScope: 0,
    simsReportedEmails: 0,
    alertsCreated: 0,
    dryRun: !!opts.dryRunForce,
    details: [],
  };

  if (users.length === 0 || allAtAnyThreshold.length === 0) return report;

  const allThresholdLevels = Object.values(AlertThresholdLevel) as AlertThresholdLevel[];
  const alreadySentRows = await prisma.simUsageAlert.findMany({
    where: {
      simId: { in: allAtAnyThreshold.map((s) => s.id) },
      thresholdLevel: { in: allThresholdLevels },
      channel: NotificationChannel.EMAIL,
    },
    select: {
      userId: true,
      simId: true,
      thresholdLevel: true,
      usagePeriodStart: true,
    },
  });

  const alreadySent = new Set<AlertKey>(
    alreadySentRows.map((r) =>
      alertKeyOf(r.userId, r.simId, r.thresholdLevel, r.usagePeriodStart)
    )
  );

  const limitUsers = opts.limitUsers ?? 2000;
  const nowCycle = new Date();

  let processedUsers = 0;
  for (const row of users) {
    if (processedUsers++ >= limitUsers) break;

    const u = row.user;
    if (!u.email) continue;

    const userLevels = opts.thresholdPercentOverride
      ? [percentToThresholdLevel(opts.thresholdPercentOverride) ?? AlertThresholdLevel.WARNING_80]
      : resolveUserThresholdLevels(row);
    const userLevelPercents = userLevels.map((l) => thresholdLevelToPercent(l));
    const userInterval = resolveUserCheckIntervalMinutes(row);
    const roleScope = u.roleScope;
    const isInternal = roleScope === "INTERNAL";
    const useAllSims = isInternal && !!row.notifyAllSims;

    const lastAt = row.lastNotificationAt;
    if (
      !opts.dryRunForce &&
      !opts.thresholdPercentOverride &&
      lastAt
    ) {
      const diffMs = nowCycle.getTime() - lastAt.getTime();
      const diffMin = diffMs / (1000 * 60);
      if (diffMin < userInterval) {
        report.usersSkippedInterval++;
        report.details.push({
          userId: u.id,
          email: u.email,
          name: u.name,
          notifyAllSims: !!row.notifyAllSims,
          roleScope,
          checkIntervalMinutes: userInterval,
          thresholdLevels: userLevels.map((l) => String(l)),
          simsTotalInScopeAtThreshold: 0,
          simsToReport: 0,
          simsPreviouslyAlerted: 0,
          emailResult: null,
          errorMessage: `Overgeslagen: laatste notificatie was ${Math.round(
            diffMin
          )} min geleden (interval: ${userInterval} min).`,
        });
        continue;
      }
    }

    let scopeCustomerIds: Set<string> | null = null;
    if (!useAllSims) {
      const ids = await collectUserCustomerIds(u.id).catch(() => [] as string[]);
      scopeCustomerIds = new Set(ids);
      if (scopeCustomerIds.size === 0) {
        const filteredByStatus = allAtAnyThreshold.filter((s) => {
          if (!userLevelPercents.some((p) => isDataAboveThreshold(s, p)))
            return false;
          return true;
        });
        report.simsSkippedScope += filteredByStatus.length;
        report.details.push({
          userId: u.id,
          email: u.email,
          name: u.name,
          notifyAllSims: !!row.notifyAllSims,
          roleScope,
          checkIntervalMinutes: userInterval,
          thresholdLevels: userLevels.map((l) => String(l)),
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
    for (const sim of allAtAnyThreshold) {
      if (!userLevelPercents.some((p) => isDataAboveThreshold(sim, p))) continue;
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
        checkIntervalMinutes: userInterval,
        thresholdLevels: userLevels.map((l) => String(l)),
        simsTotalInScopeAtThreshold: 0,
        simsToReport: 0,
        simsPreviouslyAlerted: 0,
        emailResult: null,
      });
      continue;
    }

    type SimWithAlertInfo = SimWithCustomerAndUsage & {
      highestPercent: number;
      alertLevel: AlertThresholdLevel;
    };

    const simsWithLevels: SimWithAlertInfo[] = simsInScope
      .map((s) => {
        const highestPct = highestLevelPercentForSim(s, userLevels);
        const level = levelForSimAndPercent(highestPct);
        if (!level || highestPct === 0) return null;
        return { ...s, highestPercent: highestPct, alertLevel: level };
      })
      .filter((x): x is SimWithAlertInfo => x !== null);

    const simsToReport: SimWithAlertInfo[] = [];
    let alreadyAlertedCount = 0;
    for (const sim of simsWithLevels) {
      const k = alertKeyOf(
        u.id,
        sim.id,
        sim.alertLevel,
        buildPeriodKey(sim.usagePeriodStart)
      );
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
        checkIntervalMinutes: userInterval,
        thresholdLevels: userLevels.map((l) => String(l)),
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
      thresholdPercent: s.highestPercent,
      thresholdLevel: s.alertLevel,
      detailUrl: SIM_DETAIL_PATH(s.id),
    }));

    const overallThreshold = Math.max(
      ...items.map((i) => i.thresholdPercent)
    );

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
          thresholdPercent: overallThreshold,
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
        thresholdLevel: s.alertLevel,
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
          alreadySent.add(
            alertKeyOf(u.id, d.simId, d.thresholdLevel, d.usagePeriodStart)
          );
        } catch (e) {
          if (
            e instanceof Error &&
            /unique|duplicate/i.test((e as any)?.code ?? (e as any)?.message ?? "")
          ) {
            report.simsSkippedAlreadySent++;
          }
        }
      }

      const storedLevels =
        Array.isArray(row.thresholdLevels) && row.thresholdLevels.length > 0
          ? { set: row.thresholdLevels }
          : undefined;

      await prisma.userNotificationSettings
        .upsert({
          where: { userId: u.id },
          create: {
            userId: u.id,
            enabledEmail: row.enabledEmail,
            enabledDataThresholdAlert: row.enabledDataThresholdAlert,
            dataThresholdPercent: row.dataThresholdPercent ?? 80,
            thresholdLevels: storedLevels?.set ?? DEFAULT_THRESHOLD_LEVELS,
            usageAlertCheckIntervalMinutes: userInterval,
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
      checkIntervalMinutes: userInterval,
      thresholdLevels: userLevels.map((l) => String(l)),
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
