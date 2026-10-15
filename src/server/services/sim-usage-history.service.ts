/**
 * Historisch dataverbruik per SIM per maand
 * ---------------------------------------------------------
 * De usage-sync schrijft uitsluitend de ACTUELE teller op het SIM-record.
 * Deze service bewaart daarnaast een maandsnapshot per SIM, zodat het
 * dashboard de afgelopen 12 maanden kan vergelijken.
 *
 * Kernidee:
 *   - Bij elke wijziging wordt een snapshot ge-upsert op (simId, monthKey).
 *   - Binnen een maand geldt een MONOTONE MAX-GUARD: de teller mag alleen
 *     stijgen. Zodra de provider een nieuwe periode start, verandert de
 *     maandsleutel en blijft de oude rij automatisch op zijn eindwaarde staan.
 *   - Alleen periodegebonden bronnen (BUNDLE_COUNTER / CDR_STATS) worden
 *     opgeslagen; een niet-periodegebonden teller is niet vergelijkbaar en
 *     wordt bewust overgeslagen (geen "silent default").
 */

import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { nl } from "date-fns/locale/nl";

export const USAGE_HISTORY_MONTHS = 12;
export const USAGE_HISTORY_RETENTION_MONTHS = 24;

const PERIOD_BOUND_USAGE_SOURCES = new Set(["BUNDLE_COUNTER", "CDR_STATS"]);

const SNAPSHOT_WRITE_CHUNK = 200;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let lastPruneAt = 0;

// ============================================================
// Pure helpers (los testbaar, zonder Prisma)
// ============================================================

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function validDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as unknown as string);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Alleen periodegebonden tellers zijn als maandverbruik op te slaan. */
export function isPeriodBoundUsageSource(
  source: string | null | undefined
): boolean {
  return !!source && PERIOD_BOUND_USAGE_SOURCES.has(source);
}

/** 'YYYY-MM' op basis van lokale tijd (TZ=Europe/Amsterdam). */
export function formatMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * Bepaalt de maandsleutel volgens de vaste bucketing-regel:
 *   1. kalendermaand van periodStart
 *   2. anders kalendermaand van periodEnd
 *   3. anders kalendermaand van refDate
 * Geeft null wanneer de bron niet periodegebonden is.
 */
export function deriveMonthKey(
  periodStart: Date | null | undefined,
  periodEnd: Date | null | undefined,
  usageSource: string | null | undefined,
  refDate: Date = new Date()
): string | null {
  if (!isPeriodBoundUsageSource(usageSource)) return null;
  const anchor =
    validDate(periodStart) ?? validDate(periodEnd) ?? validDate(refDate);
  return anchor ? formatMonthKey(anchor) : null;
}

/** Rolling window van maandsleutels, oudste eerst (inclusief refDate-maand). */
export function buildMonthWindow(
  months: number,
  refDate: Date = new Date()
): string[] {
  const out: string[] = [];
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  for (let i = months - 1; i >= 0; i--) {
    out.push(formatMonthKey(new Date(year, month - i, 1)));
  }
  return out;
}

/** Maandlabel voor weergave, bijv. 'oktober 2026'. */
export function monthLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return monthKey;
  return format(new Date(y, m - 1, 1), "MMMM yyyy", { locale: nl });
}

function maxBigInt(a: bigint | null, b: bigint | null): bigint | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function maxInt(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export type UsageTotals = {
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  smsUsedCount: number | null;
};

/**
 * Monotone samenvoeging van een bestaande maandrij met een nieuwe waarneming.
 * - dataUsedBytes / smsUsedCount: alleen verhogen
 * - dataLimitBytes: nieuwste niet-null waarde
 */
export function mergeMonotonicUsage(
  existing: UsageTotals,
  incoming: UsageTotals
): UsageTotals {
  return {
    dataUsedBytes: maxBigInt(existing.dataUsedBytes, incoming.dataUsedBytes),
    dataLimitBytes: incoming.dataLimitBytes ?? existing.dataLimitBytes,
    smsUsedCount: maxInt(existing.smsUsedCount, incoming.smsUsedCount),
  };
}

// ============================================================
// Opname van snapshots
// ============================================================

export type UsageSnapshotInput = {
  simId: string;
  iccid: string;
  usageSource: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dataUsedBytes: bigint | null;
  dataLimitBytes: bigint | null;
  smsUsedCount: number | null;
  /** Referentiedatum voor de fallback-bucketing (standaard: nu). */
  refDate?: Date;
};

export type CaptureResult = { captured: number; skipped: number };

/**
 * Upsert maandsnapshots met monotone max-guard.
 * - Leest de bestaande rijen in één query (geen N+1).
 * - Schrijft in begrensde transacties.
 * - Markeert eerdere maanden van dezelfde SIM als definitief.
 * Faalt nooit hard: een fout mag de hoofd-sync niet blokkeren.
 */
export async function captureUsageSnapshots(
  entries: UsageSnapshotInput[]
): Promise<CaptureResult> {
  const now = new Date();
  let skipped = 0;

  // 1. Bucket + dedupliceren op (simId, monthKey), met monotone merge.
  const candidates = new Map<
    string,
    { entry: UsageSnapshotInput; monthKey: string }
  >();
  for (const entry of entries) {
    const monthKey = deriveMonthKey(
      entry.periodStart,
      entry.periodEnd,
      entry.usageSource,
      entry.refDate ?? now
    );
    if (!monthKey || entry.dataUsedBytes === null) {
      skipped++;
      continue;
    }
    const key = `${entry.simId}:${monthKey}`;
    const prev = candidates.get(key);
    if (prev) {
      const merged = mergeMonotonicUsage(
        {
          dataUsedBytes: prev.entry.dataUsedBytes,
          dataLimitBytes: prev.entry.dataLimitBytes,
          smsUsedCount: prev.entry.smsUsedCount,
        },
        {
          dataUsedBytes: entry.dataUsedBytes,
          dataLimitBytes: entry.dataLimitBytes,
          smsUsedCount: entry.smsUsedCount,
        }
      );
      candidates.set(key, {
        monthKey,
        entry: { ...prev.entry, ...merged },
      });
    } else {
      candidates.set(key, { entry, monthKey });
    }
  }

  if (candidates.size === 0) return { captured: 0, skipped };

  const simIds = [...new Set([...candidates.values()].map((c) => c.entry.simId))];

  // 2. Bestaande rijen in één keer ophalen.
  const existingRows = await prisma.simMonthlyUsage.findMany({
    where: { simId: { in: simIds } },
    select: {
      simId: true,
      monthKey: true,
      dataUsedBytes: true,
      dataLimitBytes: true,
      smsUsedCount: true,
      periodStart: true,
      periodEnd: true,
    },
  });
  const existingMap = new Map(
    existingRows.map((r) => [`${r.simId}:${r.monthKey}`, r])
  );

  // 3. Upserts bouwen met de monotone merge.
  const ops = [];
  for (const { entry, monthKey } of candidates.values()) {
    const key = `${entry.simId}:${monthKey}`;
    const prev = existingMap.get(key);
    const merged = mergeMonotonicUsage(
      {
        dataUsedBytes: prev?.dataUsedBytes ?? null,
        dataLimitBytes: prev?.dataLimitBytes ?? null,
        smsUsedCount: prev?.smsUsedCount ?? null,
      },
      {
        dataUsedBytes: entry.dataUsedBytes,
        dataLimitBytes: entry.dataLimitBytes,
        smsUsedCount: entry.smsUsedCount,
      }
    );

    ops.push(
      prisma.simMonthlyUsage.upsert({
        where: { simId_monthKey: { simId: entry.simId, monthKey } },
        create: {
          simId: entry.simId,
          iccid: entry.iccid,
          monthKey,
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          dataUsedBytes: merged.dataUsedBytes,
          dataLimitBytes: merged.dataLimitBytes,
          smsUsedCount: merged.smsUsedCount,
          usageSource: entry.usageSource,
          firstCapturedAt: now,
          lastCapturedAt: now,
          isFinal: false,
        },
        update: {
          iccid: entry.iccid,
          periodStart: entry.periodStart ?? prev?.periodStart ?? null,
          periodEnd: entry.periodEnd ?? prev?.periodEnd ?? null,
          dataUsedBytes: merged.dataUsedBytes,
          dataLimitBytes: merged.dataLimitBytes,
          smsUsedCount: merged.smsUsedCount,
          usageSource: entry.usageSource,
          lastCapturedAt: now,
        },
      })
    );
  }

  for (let i = 0; i < ops.length; i += SNAPSHOT_WRITE_CHUNK) {
    await prisma.$transaction(ops.slice(i, i + SNAPSHOT_WRITE_CHUNK));
  }

  // 4. Eerdere maanden van dezelfde SIM definitief markeren.
  const perThreshold = new Map<string, string[]>();
  for (const { entry, monthKey } of candidates.values()) {
    const list = perThreshold.get(monthKey) ?? [];
    list.push(entry.simId);
    perThreshold.set(monthKey, list);
  }
  for (const [threshold, ids] of perThreshold) {
    await prisma.simMonthlyUsage.updateMany({
      where: { simId: { in: ids }, isFinal: false, monthKey: { lt: threshold } },
      data: { isFinal: true },
    });
  }

  await maybePruneUsageHistory();

  return { captured: ops.length, skipped };
}

/** Ruimt maandrijen ouder dan de retentie op; maximaal 1× per dag. */
export async function maybePruneUsageHistory(
  keepMonths = USAGE_HISTORY_RETENTION_MONTHS
): Promise<number> {
  if (Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) return 0;
  lastPruneAt = Date.now();
  return pruneUsageHistory(keepMonths);
}

export async function pruneUsageHistory(
  keepMonths = USAGE_HISTORY_RETENTION_MONTHS
): Promise<number> {
  const oldestKept = buildMonthWindow(keepMonths, new Date())[0];
  const result = await prisma.simMonthlyUsage.deleteMany({
    where: { monthKey: { lt: oldestKept } },
  });
  return result.count;
}

// ============================================================
// Aggregatie voor het dashboard
// ============================================================

export type UsageHistoryMonth = {
  monthKey: string;
  label: string;
  totalUsedBytes: bigint | null;
  totalLimitBytes: bigint | null;
  /** Aantal SIMs met een snapshot in deze maand. */
  simCount: number;
};

export type UsageHistoryMonthDetail = {
  monthKey: string;
  label: string;
  totalUsedBytes: bigint;
  totalLimitBytes: bigint | null;
  simCount: number;
  topSims: Array<{ name: string; usedBytes: number }>;
};

/** Totaalverbruik per maand over het rolling window (oudste eerst). */
export async function getUsageHistory(
  months = USAGE_HISTORY_MONTHS,
  refDate: Date = new Date()
): Promise<UsageHistoryMonth[]> {
  const windowKeys = buildMonthWindow(months, refDate);
  const grouped = await prisma.simMonthlyUsage.groupBy({
    by: ["monthKey"],
    where: { monthKey: { in: windowKeys } },
    _sum: { dataUsedBytes: true, dataLimitBytes: true },
    _count: { _all: true },
  });
  const map = new Map(grouped.map((g) => [g.monthKey, g]));

  return windowKeys.map((monthKey) => {
    const g = map.get(monthKey);
    return {
      monthKey,
      label: monthLabelFromKey(monthKey),
      totalUsedBytes: g?._sum.dataUsedBytes ?? null,
      totalLimitBytes: g?._sum.dataLimitBytes ?? null,
      simCount: g?._count._all ?? 0,
    };
  });
}

/** Totalen + top-N SIMs van één specifieke maand. */
export async function getUsageHistoryForMonth(
  monthKey: string,
  topN = 10
): Promise<UsageHistoryMonthDetail | null> {
  const [agg, rows] = await Promise.all([
    prisma.simMonthlyUsage.aggregate({
      where: { monthKey },
      _sum: { dataUsedBytes: true, dataLimitBytes: true },
      _count: { _all: true },
    }),
    prisma.simMonthlyUsage.findMany({
      where: { monthKey },
      orderBy: { dataUsedBytes: "desc" },
      take: topN,
      select: {
        iccid: true,
        dataUsedBytes: true,
        sim: { select: { simName: true, msisdn: true } },
      },
    }),
  ]);

  const simCount = agg._count._all ?? 0;
  if (simCount === 0) return null;

  const topSims = rows
    .map((r) => {
      const raw = r.dataUsedBytes;
      if (raw === null || raw === undefined) return null;
      const usedBytes = Number(raw);
      if (!Number.isFinite(usedBytes) || usedBytes <= 0) return null;
      const name =
        (r.sim?.simName && r.sim.simName.trim()) ||
        (r.sim?.msisdn && r.sim.msisdn.trim()) ||
        (r.iccid ? r.iccid.slice(-10) : "Onbekend");
      return { name, usedBytes };
    })
    .filter((v): v is { name: string; usedBytes: number } => v !== null);

  return {
    monthKey,
    label: monthLabelFromKey(monthKey),
    totalUsedBytes: agg._sum.dataUsedBytes ?? 0n,
    totalLimitBytes: agg._sum.dataLimitBytes ?? null,
    simCount,
    topSims,
  };
}
