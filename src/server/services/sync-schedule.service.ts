import { prisma } from "@/lib/prisma";
import {
  SyncFrequency,
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
  type RoleScope,
} from "@/types/enums";
import type {
  SyncJobConfig as PrismaSyncConfig,
  SyncJobRun as PrismaSyncRun,
  Prisma as PrismaClient,
} from "@prisma/client";
import { logAudit, diffObject } from "./audit.service";
import {
  SaveSyncScheduleInput,
  SaveSyncScheduleSchema,
} from "../validators/schedule";

type TxAware = PrismaClient.TransactionClient | typeof prisma;

export type AuditUser = {
  id: string;
  email?: string | null;
  role?: any;
  roleScope?: RoleScope;
  permissions?: unknown;
};

/* =============================== CONFIG DEFAULTS =============================== */

export const HISTORIC_HOURLY_WINDOWS: Record<SyncJobId, number[]> = {
  [SyncJobId.SIMHUIS_USAGE]: Array.from({ length: 24 }, (_, i) => i),
  [SyncJobId.SIMHUIS_SIMS]: [3, 9, 15, 21],
  [SyncJobId.SIMHUIS_USAGE_ALERT_NOTIFY]: Array.from({ length: 24 }, (_, i) => i),
  [SyncJobId.INSERVE]: [2, 8, 14, 20],
  [SyncJobId.INSERVE_CUSTOMER_IMPORT]: [1, 7, 13, 19],
};

export function getDefaultSyncJobConfig(jobId: SyncJobId): SaveSyncScheduleInput {
  switch (jobId) {
    case SyncJobId.SIMHUIS_USAGE:
      return {
        jobId,
        enabled: true,
        frequency: SyncFrequency.EVERY_15_MINUTES,
        hour: 0,
        minute: 0,
        dayOfWeek: 1,
        dayOfMonth: 1,
        timezone: "Europe/Amsterdam",
        comment:
          "Verbruiksdata van actieve SIMs bijwerken. Afgestemd op systemd-timer die elke 15 minuten afvuurt (:00/:15/:30/:45).",
      };
    case SyncJobId.SIMHUIS_SIMS:
      return {
        jobId,
        enabled: true,
        frequency: SyncFrequency.DAILY,
        hour: 3,
        minute: 0,
        dayOfWeek: 1,
        dayOfMonth: 1,
        timezone: "Europe/Amsterdam",
        comment:
          "SIM-voorraad (aanmaak/wijzigingen) vanuit Simhuis bijwerken. Standaard 4x per dag (03:00 / 09:00 / 15:00 / 21:00).",
      };
    case SyncJobId.SIMHUIS_USAGE_ALERT_NOTIFY:
      return {
        jobId,
        enabled: true,
        frequency: SyncFrequency.EVERY_15_MINUTES,
        hour: 0,
        minute: 5,
        dayOfWeek: 1,
        dayOfMonth: 1,
        timezone: "Europe/Amsterdam",
        comment:
          "Verstuur e-mail notificaties wanneer SIMs de 70/80/90/100% data-drempel bereiken. " +
          "Standaard elke 15 minuten zodat gebruikers met korte intervallen snel gewaarschuwd worden. " +
          "Per gebruiker wordt persoonlijke interval gehonoreerd (anti-spam).",
      };
    case SyncJobId.INSERVE:
      return {
        jobId,
        enabled: true,
        frequency: SyncFrequency.DAILY,
        hour: 2,
        minute: 0,
        dayOfWeek: 1,
        dayOfMonth: 1,
        timezone: "Europe/Amsterdam",
        comment:
          "Inserve abonnementen en facturen synchroniseren. Standaard 4x per dag (02:00 / 08:00 / 14:00 / 20:00).",
      };
    default:
      return {
        jobId,
        enabled: false,
        frequency: SyncFrequency.DAILY,
        hour: 0,
        minute: 0,
        dayOfWeek: 1,
        dayOfMonth: 1,
        timezone: "Europe/Amsterdam",
        comment: null,
      };
  }
}

/* =============================== READERS =============================== */

export async function getSyncJobConfig(
  jobId: SyncJobId
): Promise<PrismaSyncConfig> {
  const row = await prisma.syncJobConfig.findUnique({ where: { jobId } });
  if (row) {
    if (row.lastAppliedAt === null) {
      try {
        return await prisma.syncJobConfig.update({
          where: { jobId },
          data: { lastAppliedAt: new Date() },
        });
      } catch (e: any) {
        console.warn(
          "[sync-schedule] Eenmalig bijwerken lastAppliedAt voor job",
          jobId,
          "mislukt (door naar fallback-pad):",
          e?.message ?? String(e)
        );
      }
    }
    return row;
  }
  const defaults = getDefaultSyncJobConfig(jobId);
  return prisma.syncJobConfig.upsert({
    where: { jobId },
    update: {},
    create: {
      jobId,
      enabled: defaults.enabled,
      frequency: defaults.frequency,
      hour: defaults.hour,
      minute: defaults.minute,
      dayOfWeek: defaults.dayOfWeek,
      dayOfMonth: defaults.dayOfMonth,
      timezone: defaults.timezone,
      lastAppliedAt: new Date(),
    },
  });
}

export async function listSyncJobConfigs(): Promise<PrismaSyncConfig[]> {
  const rows = await prisma.syncJobConfig.findMany();

  const needLastApplied = rows.filter((r) => r.lastAppliedAt === null);
  if (needLastApplied.length > 0) {
    try {
      await Promise.all(
        needLastApplied.map((r) =>
          prisma.syncJobConfig.update({
            where: { id: r.id },
            data: { lastAppliedAt: new Date() },
          })
        )
      );
      for (const r of needLastApplied) {
        const updated = rows.find((x) => x.id === r.id);
        if (updated) updated.lastAppliedAt = new Date();
      }
    } catch (e: any) {
      console.warn(
        "[sync-schedule] Eenmalig bijwerken lastAppliedAt voor",
        needLastApplied.length,
        "jobs mislukt:",
        e?.message ?? String(e)
      );
    }
  }

  const expectedIds = new Set(rows.map((r) => r.jobId));
  const missing = (Object.values(SyncJobId) as SyncJobId[]).filter(
    (id) => !expectedIds.has(id)
  );
  if (missing.length > 0) {
    const inserts = missing.map((id) => {
      const d = getDefaultSyncJobConfig(id);
      return prisma.syncJobConfig.upsert({
        where: { jobId: id },
        update: {},
        create: {
          jobId: id,
          enabled: d.enabled,
          frequency: d.frequency,
          hour: d.hour,
          minute: d.minute,
          dayOfWeek: d.dayOfWeek,
          dayOfMonth: d.dayOfMonth,
          timezone: d.timezone,
          lastAppliedAt: new Date(),
        },
      });
    });
    const created = await Promise.all(inserts);
    return [...rows, ...created];
  }
  return rows;
}

/* =============================== WRITERS =============================== */

export async function saveSyncJobConfig(
  db: TxAware,
  input: SaveSyncScheduleInput,
  user: AuditUser
): Promise<PrismaSyncConfig> {
  const validated = SaveSyncScheduleSchema.parse(input);

  const existing =
    (await (db as typeof prisma).syncJobConfig.findUnique({
      where: { jobId: validated.jobId },
    })) ?? null;

  await validateNoOverlap(db, validated, { excludeJobId: validated.jobId });

  const effectiveDayOfWeek =
    validated.dayOfWeek !== undefined && validated.dayOfWeek !== null
      ? validated.dayOfWeek
      : 1;
  const effectiveDayOfMonth =
    validated.dayOfMonth !== undefined && validated.dayOfMonth !== null
      ? validated.dayOfMonth
      : 1;

  const oldValues = existing
    ? diffObject(
        {
          enabled: existing.enabled,
          frequency: existing.frequency,
          hour: existing.hour,
          minute: existing.minute,
          dayOfWeek: existing.dayOfWeek ?? 1,
          dayOfMonth: existing.dayOfMonth ?? 1,
          timezone: existing.timezone,
        },
        {
          enabled: validated.enabled,
          frequency: validated.frequency,
          hour: validated.hour,
          minute: validated.minute,
          dayOfWeek: effectiveDayOfWeek,
          dayOfMonth: effectiveDayOfMonth,
          timezone: validated.timezone,
        }
      )
    : null;

  const saved = await (db as typeof prisma).syncJobConfig.upsert({
    where: { jobId: validated.jobId },
    update: {
      enabled: validated.enabled,
      frequency: validated.frequency,
      hour: validated.hour,
      minute: validated.minute,
      dayOfWeek: effectiveDayOfWeek,
      dayOfMonth: effectiveDayOfMonth,
      timezone: validated.timezone,
      updatedById: user.id,
      lastAppliedAt: new Date(),
    },
    create: {
      jobId: validated.jobId,
      enabled: validated.enabled,
      frequency: validated.frequency,
      hour: validated.hour,
      minute: validated.minute,
      dayOfWeek: effectiveDayOfWeek,
      dayOfMonth: effectiveDayOfMonth,
      timezone: validated.timezone,
      updatedById: user.id,
      lastAppliedAt: new Date(),
    },
  });

  try {
    await logAudit(db, {
      entityType: "SyncJobConfig",
      entityId: saved.id,
      action: "UPDATE_SETTINGS",
      userId: user.id,
      oldValues,
      newValues: {
        jobId: saved.jobId,
        enabled: saved.enabled,
        frequency: saved.frequency,
        hour: saved.hour,
        minute: saved.minute,
        dayOfWeek: saved.dayOfWeek ?? 1,
        dayOfMonth: saved.dayOfMonth ?? 1,
        timezone: saved.timezone,
      },
      metadata: {
        scope: "sync_schedule",
        comment: validated.comment ?? undefined,
      },
    });
  } catch (auditErr: any) {
    console.error(
      "[audit-faal] Audit logging SyncJobConfig kon niet geschreven worden (config wel opgeslagen):",
      auditErr?.message ?? String(auditErr)
    );
  }

  return saved;
}

export async function resetSyncJobConfig(
  db: TxAware,
  jobId: SyncJobId,
  user: { id: string }
): Promise<PrismaSyncConfig> {
  const defaults = getDefaultSyncJobConfig(jobId);
  const existing = await (db as typeof prisma).syncJobConfig.findUnique({
    where: { jobId },
  });

  const saved = await (db as typeof prisma).syncJobConfig.upsert({
    where: { jobId },
    update: {
      enabled: defaults.enabled,
      frequency: defaults.frequency,
      hour: defaults.hour,
      minute: defaults.minute,
      dayOfWeek: defaults.dayOfWeek,
      dayOfMonth: defaults.dayOfMonth,
      timezone: defaults.timezone,
      updatedById: user.id,
      lastAppliedAt: new Date(),
    },
    create: {
      jobId,
      enabled: defaults.enabled,
      frequency: defaults.frequency,
      hour: defaults.hour,
      minute: defaults.minute,
      dayOfWeek: defaults.dayOfWeek,
      dayOfMonth: defaults.dayOfMonth,
      timezone: defaults.timezone,
      updatedById: user.id,
      lastAppliedAt: new Date(),
    },
  });

  try {
    await logAudit(db, {
      entityType: "SyncJobConfig",
      entityId: saved.id,
      action: "UPDATE_SETTINGS",
      userId: user.id,
      oldValues: existing
        ? {
            ...existing,
            dayOfWeek: existing.dayOfWeek ?? 1,
            dayOfMonth: existing.dayOfMonth ?? 1,
          }
        : null,
      newValues: {
        ...saved,
        dayOfWeek: saved.dayOfWeek ?? 1,
        dayOfMonth: saved.dayOfMonth ?? 1,
      },
      metadata: { scope: "sync_schedule", reset: true },
    });
  } catch (auditErr: any) {
    console.error(
      "[audit-faal] Audit logging reset SyncJobConfig kon niet geschreven worden (reset wel uitgevoerd):",
      auditErr?.message ?? String(auditErr)
    );
  }

  return saved;
}

/* =============================== SCHEDULE GUARD =============================== */

export interface ShouldRunNowResult {
  shouldRun: boolean;
  reason: string;
}

const GRACE_MINUTES = 7;

interface TZInstant {
  hour: number;
  minute: number;
  dowRaw: number;
  dow: number;
  dom: number;
  lastOfMonth: number;
  year: number;
  monthZeroBased: number;
}

function inTZ(date: Date, timezone: string): TZInstant {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = parseInt(getPart("hour"), 10) || 0;
  const minute = parseInt(getPart("minute"), 10) || 0;
  const year = parseInt(getPart("year"), 10) || new Date().getFullYear();
  const monthZeroBased = (parseInt(getPart("month"), 10) || 1) - 1;
  const dom = parseInt(getPart("day"), 10) || 1;
  const weekdayStr = getPart("weekday").toLowerCase();
  const dowRaw = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(weekdayStr.slice(0, 3));
  const dowSafe = dowRaw === -1 ? new Date(date.getTime()).getDay() : dowRaw;
  const dow = dowSafe === 0 ? 7 : dowSafe;
  const lastOfMonth = new Date(year, monthZeroBased + 1, 0).getDate();
  return { hour, minute, dowRaw: dowSafe, dow, dom, lastOfMonth, year, monthZeroBased };
}

function isConfigUnchangedDefault(config: PrismaSyncConfig): boolean {
  if (config.lastAppliedAt) return false;
  const defaults = getDefaultSyncJobConfig(config.jobId as SyncJobId);
  return (
    config.enabled === defaults.enabled &&
    config.frequency === defaults.frequency &&
    config.hour === defaults.hour &&
    config.minute === defaults.minute &&
    (config.dayOfWeek ?? 1) === (defaults.dayOfWeek ?? 1) &&
    (config.dayOfMonth ?? 1) === (defaults.dayOfMonth ?? 1) &&
    (config.timezone || "Europe/Amsterdam") === (defaults.timezone || "Europe/Amsterdam")
  );
}

export function shouldRunNow(
  config: PrismaSyncConfig,
  now: Date = new Date(),
  options: {
    force?: boolean;
    triggeredBy?: SyncJobTrigger;
  } = {}
): ShouldRunNowResult {
  if (options.force) {
    return { shouldRun: true, reason: "force=true (handmatige run)" };
  }
  if (!config.enabled) {
    return {
      shouldRun: false,
      reason: "Taak is uitgeschakeld (enabled=false).",
    };
  }

  const tz = config.timezone || "Europe/Amsterdam";
  const { hour, minute, dow, dom, lastOfMonth } = inTZ(now, tz);

  const withinMinuteWindow = (targetMinute: number) => {
    const diff = ((minute - targetMinute) % 60 + 60) % 60;
    return diff <= GRACE_MINUTES;
  };

  const withinHourWindow = (targetHour: number, targetMinute: number) => {
    if (hour !== targetHour) return false;
    return withinMinuteWindow(targetMinute);
  };

  // §AC-9 backward compat: ongewijzigde default → gebruik historische windows
  if (isConfigUnchangedDefault(config)) {
    const windows = HISTORIC_HOURLY_WINDOWS[config.jobId as SyncJobId];
    for (const h of windows) {
      if (withinHourWindow(h, config.minute)) {
        return { shouldRun: true, reason: "binnen historische default window" };
      }
    }
    return {
      shouldRun: false,
      reason: `buiten default windows (uren: ${windows.join(", ")}).`,
    };
  }

  switch (config.frequency) {
    case SyncFrequency.EVERY_15_MINUTES: {
      const offset = ((config.minute ?? 0) % 15 + 15) % 15;
      const aligned = (() => {
        let test = offset;
        const steps = [0, 15, 30, 45];
        for (const base of steps) {
          const candidate = (base + offset) % 60;
          const diff = ((minute - candidate) % 60 + 60) % 60;
          if (diff <= GRACE_MINUTES) return true;
        }
        return false;
      })();
      return aligned
        ? {
            shouldRun: true,
            reason: `binnen per-15-minuten window (start elke :${String(
              offset
            ).padStart(2, "0")}, :${String(offset + 15).padStart(
              2,
              "0"
            )}, :${String(offset + 30).padStart(2, "0")}, :${String(
              (offset + 45) % 60
            ).padStart(2, "0")} ±${GRACE_MINUTES}m)`,
          }
        : {
            shouldRun: false,
            reason: `buiten per-15-minuten window.`,
          };
    }
    case SyncFrequency.EVERY_30_MINUTES: {
      const offset = ((config.minute ?? 0) % 30 + 30) % 30;
      const candidates = [offset, offset + 30];
      const matches = candidates.some((targetMinute) => {
        const diff = ((minute - targetMinute) % 60 + 60) % 60;
        return diff <= GRACE_MINUTES;
      });
      return matches
        ? {
            shouldRun: true,
            reason: `binnen per-30-minuten window (:${String(
              offset
            ).padStart(2, "0")} en :${String(offset + 30).padStart(
              2,
              "0"
            )} ±${GRACE_MINUTES}m)`,
          }
        : {
            shouldRun: false,
            reason: `buiten per-30-minuten window.`,
          };
    }
    case SyncFrequency.HOURLY:
      return withinMinuteWindow(config.minute)
        ? { shouldRun: true, reason: `binnen per-uur window (:${config.minute} ±${GRACE_MINUTES}m)` }
        : {
            shouldRun: false,
            reason: `buiten per-uur window (:${config.minute}).`,
          };
    case SyncFrequency.DAILY:
      return withinHourWindow(config.hour, config.minute)
        ? {
            shouldRun: true,
            reason: `binnen dagelijkse window (${String(config.hour).padStart(2, "0")}:${String(
              config.minute
            ).padStart(2, "0")} ±${GRACE_MINUTES}m)`,
          }
        : {
            shouldRun: false,
            reason: `buiten dagelijks window (${String(config.hour).padStart(
              2,
              "0"
            )}:${String(config.minute).padStart(2, "0")}).`,
          };
    case SyncFrequency.WEEKLY: {
      const targetDow = config.dayOfWeek ?? 1;
      if (dow !== targetDow) {
        return {
          shouldRun: false,
          reason: `wekelijks is ingesteld op dag ${targetDow}; vandaag is dag ${dow}.`,
        };
      }
      return withinHourWindow(config.hour, config.minute)
        ? {
            shouldRun: true,
            reason: `wekelijks binnen window (dag ${targetDow} ${String(
              config.hour
            ).padStart(2, "0")}:${String(config.minute).padStart(2, "0")})`,
          }
        : {
            shouldRun: false,
            reason: `buiten wekelijks window.`,
          };
    }
    case SyncFrequency.MONTHLY: {
      const targetDom = config.dayOfMonth ?? 1;
      const effectiveTargetDom = targetDom >= 31 ? lastOfMonth : targetDom;
      if (dom !== effectiveTargetDom) {
        return {
          shouldRun: false,
          reason: `maandelijks dag ${effectiveTargetDom}; vandaag dag ${dom}.`,
        };
      }
      return withinHourWindow(config.hour, config.minute)
        ? {
            shouldRun: true,
            reason: `maandelijks binnen window (dag ${effectiveTargetDom} ${String(
              config.hour
            ).padStart(2, "0")}:${String(config.minute).padStart(2, "0")})`,
          }
        : {
            shouldRun: false,
            reason: `buiten maandelijks window.`,
          };
    }
    default:
      return {
        shouldRun: false,
        reason: `Onbekende frequentie: ${config.frequency as string}.`,
      };
  }
}

/* =============================== OVERLAP VALIDATIE =============================== */

type FrequencyLike = SyncFrequency | (string & {});

function buildMinuteSet(frequency: FrequencyLike, configMinute: number): Set<number> {
  const minute = ((configMinute ?? 0) % 60 + 60) % 60;
  switch (frequency) {
    case SyncFrequency.EVERY_15_MINUTES: {
      const offset = minute % 15;
      return new Set([offset, offset + 15, offset + 30, offset + 45]);
    }
    case SyncFrequency.EVERY_30_MINUTES: {
      const offset = minute % 30;
      return new Set([offset, offset + 30]);
    }
    case SyncFrequency.HOURLY:
    case SyncFrequency.DAILY:
    case SyncFrequency.WEEKLY:
    case SyncFrequency.MONTHLY:
    default:
      return new Set([minute]);
  }
}

function minuteOverlap(a: Set<number>, b: Set<number>): number[] {
  const result: number[] = [];
  for (const m of a) if (b.has(m)) result.push(m);
  return result.sort((x, y) => x - y);
}

export async function validateNoOverlap(
  db: TxAware,
  candidate: SaveSyncScheduleInput,
  options: { excludeJobId?: SyncJobId } = {}
): Promise<void> {
  if (!candidate.enabled) return;
  const others = (await (db as typeof prisma).syncJobConfig.findMany({
    where: {
      enabled: true,
      NOT: { jobId: options.excludeJobId ?? undefined },
    },
  })) as unknown as PrismaSyncConfig[];

  const candidateMinute = candidate.minute ?? 0;
  const candidateHour = candidate.hour ?? 0;
  const candidateDow = (candidate.dayOfWeek as number | null | undefined) ?? 1;
  const candidateDom = (candidate.dayOfMonth as number | null | undefined) ?? 1;
  const candidateMinuteSet = buildMinuteSet(candidate.frequency, candidateMinute);

  for (const other of others) {
    const otherMinute = other.minute ?? 0;
    const otherHour = other.hour ?? 0;
    const otherDow = other.dayOfWeek ?? 1;
    const otherDom = other.dayOfMonth ?? 1;
    const otherMinuteSet = buildMinuteSet(other.frequency, otherMinute);

    let clashReason: string | null = null;

    if (
      candidate.frequency === SyncFrequency.EVERY_15_MINUTES ||
      candidate.frequency === SyncFrequency.EVERY_30_MINUTES ||
      candidate.frequency === SyncFrequency.HOURLY ||
      other.frequency === SyncFrequency.EVERY_15_MINUTES ||
      other.frequency === SyncFrequency.EVERY_30_MINUTES ||
      other.frequency === SyncFrequency.HOURLY
    ) {
      const overlap = minuteOverlap(candidateMinuteSet, otherMinuteSet);
      if (overlap.length > 0) {
        clashReason = `minuut-overlap op :${overlap.map((m) => String(m).padStart(2, "0")).join(", :")} (frequenties ${candidate.frequency} vs ${other.frequency})`;
      }
    } else if (candidate.frequency === SyncFrequency.DAILY) {
      const overlap = minuteOverlap(candidateMinuteSet, otherMinuteSet);
      if (candidateHour === otherHour && overlap.length > 0) {
        clashReason = `dagelijks identiek tijdstip ${String(candidateHour).padStart(2, "0")}:${overlap.map((m) => String(m).padStart(2, "0")).join(",")}`;
      }
    } else if (candidate.frequency === SyncFrequency.WEEKLY) {
      const overlap = minuteOverlap(candidateMinuteSet, otherMinuteSet);
      if (candidateHour === otherHour && candidateDow === otherDow && overlap.length > 0) {
        clashReason = `wekelijks identiek (dag ${candidateDow} ${String(candidateHour).padStart(2, "0")}:${overlap.map((m) => String(m).padStart(2, "0")).join(",")})`;
      }
    } else if (candidate.frequency === SyncFrequency.MONTHLY) {
      const overlap = minuteOverlap(candidateMinuteSet, otherMinuteSet);
      if (candidateHour === otherHour && candidateDom === otherDom && overlap.length > 0) {
        clashReason = `maandelijks identiek (dag ${candidateDom} ${String(candidateHour).padStart(2, "0")}:${overlap.map((m) => String(m).padStart(2, "0")).join(",")})`;
      }
    } else {
      if (
        candidate.frequency === other.frequency &&
        candidateHour === otherHour &&
        candidateMinute === otherMinute
      ) {
        clashReason = `identiek tijdstip ${String(candidateHour).padStart(2, "0")}:${String(candidateMinute).padStart(2, "0")}`;
      }
    }

    if (clashReason) {
      throw new Error(
        `Schema-conflict: ${candidate.jobId} en ${other.jobId} hebben ${clashReason}. Verschuif één van beide minimaal 1 minuut.`
      );
    }
  }
}

/* =============================== RUN LOGGING =============================== */

export interface CreateRunInput {
  configId: string;
  jobId: SyncJobId;
  triggeredBy: SyncJobTrigger;
  userId?: string | null;
  status?: SyncJobStatus;
}

export async function createSyncJobRun(
  db: TxAware,
  input: CreateRunInput
): Promise<PrismaSyncRun> {
  return (db as typeof prisma).syncJobRun.create({
    data: {
      configId: input.configId,
      jobId: input.jobId,
      triggeredBy: input.triggeredBy,
      startedAt: new Date(),
      status: input.status ?? SyncJobStatus.RUNNING,
      userId: input.userId ?? undefined,
    },
  });
}

export interface CompleteRunInput {
  id: string;
  status: SyncJobStatus;
  startedAt: Date;
  recordsAffected?: unknown;
  errorMessage?: string | null;
  errorDetail?: unknown;
}

export async function completeSyncJobRun(
  db: TxAware,
  input: CompleteRunInput
): Promise<PrismaSyncRun> {
  const endedAt = new Date();
  const durationMs = endedAt.getTime() - input.startedAt.getTime();
  return (db as typeof prisma).syncJobRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      endedAt,
      durationMs: Math.max(0, durationMs),
      recordsAffected: input.recordsAffected ?? undefined,
      errorMessage: input.errorMessage ?? undefined,
      errorDetail: input.errorDetail ?? undefined,
    },
  });
}

export async function listRecentSyncJobRuns(
  filters: {
    jobId?: SyncJobId;
    status?: SyncJobStatus;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{
  rows: Array<PrismaSyncRun & { user: { name: string | null; email: string } | null }>;
  total: number;
}> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const where = {
    ...(filters.jobId ? { jobId: filters.jobId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.syncJobRun.count({ where }),
    prisma.syncJobRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: offset,
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);
  return { total, rows };
}

/* =============================== SCHEDULER HEALTH =============================== */

export interface SchedulerHealth {
  healthy: boolean;
  lastRunAt: { [key in SyncJobTrigger]?: Date | null };
  fallbackActive: boolean;
  systemdTimersSeenRecently: boolean;
  staleJobs: SyncJobId[];
  warnings: string[];
}

export async function getSchedulerHealth(): Promise<SchedulerHealth> {
  const now = Date.now();
  const windowMs = 30 * 60 * 1000;

  const runs = await prisma.syncJobRun.findMany({
    where: {
      OR: [
        { triggeredBy: SyncJobTrigger.SYSTEMD_TIMER },
        { triggeredBy: SyncJobTrigger.FALLBACK_POLLING },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  const lastRunAt: { [k: string]: Date | null } = {};
  for (const trigger of [
    SyncJobTrigger.SYSTEMD_TIMER,
    SyncJobTrigger.FALLBACK_POLLING,
  ] as SyncJobTrigger[]) {
    const hit = runs.find((r) => r.triggeredBy === trigger);
    lastRunAt[trigger] = hit?.startedAt ?? null;
  }

  const systemdTimersSeenRecently =
    (lastRunAt[SyncJobTrigger.SYSTEMD_TIMER]?.getTime() ?? 0) > now - windowMs;

  const fallbackActive =
    (lastRunAt[SyncJobTrigger.FALLBACK_POLLING]?.getTime() ?? 0) > now - windowMs;

  const configs = await listSyncJobConfigs();
  const staleJobs: SyncJobId[] = [];
  for (const c of configs) {
    if (!c.enabled) continue;
    const last = runs.find((r) => r.jobId === c.jobId);
    if (!last || last.startedAt.getTime() < now - windowMs * 2) {
      staleJobs.push(c.jobId as SyncJobId);
    }
  }

  const warnings: string[] = [];
  if (!systemdTimersSeenRecently) {
    warnings.push(
      "Geen systemd-timer runs gezien de afgelopen 30 minuten. Controleer sudo systemctl list-timers 'stm-*' --all."
    );
  }
  if (fallbackActive) {
    warnings.push(
      "Fallback polling is actief — timers op de VPS-host lopen mogelijk achter. Zie health instructies op de instellingenpagina."
    );
  }
  if (staleJobs.length > 0) {
    warnings.push(
      `De volgende taken hebben >60 minuten geen succesvolle run gehad: ${staleJobs.join(
        ", "
      )}.`
    );
  }

  return {
    healthy: warnings.length === 0,
    lastRunAt: lastRunAt as SchedulerHealth["lastRunAt"],
    fallbackActive,
    systemdTimersSeenRecently,
    staleJobs,
    warnings,
  };
}
