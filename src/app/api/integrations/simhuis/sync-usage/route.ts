import { NextResponse } from "next/server";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  syncActiveSimsUsageFromSimhuis,
  type SimhuisUsageSyncResult,
} from "@/server/services/simhuis-sim-sync.service";
import {
  completeSyncJobRun,
  createSyncJobRun,
  getSyncJobConfig,
  shouldRunNow,
} from "@/server/services/sync-schedule.service";
import {
  SyncJobId,
  SyncJobStatus,
  SyncJobTrigger,
} from "@/types/enums";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQ_TOKEN_VAR = "SIMHUIS_SYNC_API_TOKEN";
const JOB_ID = SyncJobId.SIMHUIS_USAGE;

function bearerTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token;
  if (scheme?.toLowerCase() === "basic" && token) return token;
  return null;
}

function determineTriggeredBy(req: Request, via: "session" | "api_token"): SyncJobTrigger {
  if (via === "session") return SyncJobTrigger.MANUAL_ADMIN;
  const hdr = (req.headers.get("x-sync-triggered-by") ?? "").toLowerCase();
  if (hdr === "fallback-polling") return SyncJobTrigger.FALLBACK_POLLING;
  if (hdr === "systemd-timer") return SyncJobTrigger.SYSTEMD_TIMER;
  return SyncJobTrigger.API_TOKEN;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const forceRaw = url.searchParams.get("force");
  const force =
    forceRaw === "1" || forceRaw === "true" || forceRaw === "on";

  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const envToken = (process.env[REQ_TOKEN_VAR] ?? "").trim();
    const bearer = bearerTokenFromHeader(authHeader);

    let principal: {
      userId?: string;
      userRole?: any;
      via: "session" | "api_token";
      canForce: boolean;
    } | null = null;

    const user = await getCurrentUser();
    if (user && canUserRole(user.role, "edit", "sim")) {
      principal = { userId: user.id, userRole: user.role, via: "session", canForce: true };
    } else if (envToken && bearer && bearer === envToken) {
      principal = { via: "api_token", canForce: false };
    } else {
      const msg = "Onvoldoende rechten (sim/edit) of ongeldige API-token.";
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 403 }
      );
    }

    if (force && !principal.canForce) {
      return NextResponse.json(
        { ok: false, error: "Forceren is enkel toegestaan voor ingelogde ADMIN/Medewerker." },
        { status: 403 }
      );
    }

    const triggeredBy = determineTriggeredBy(req, principal.via);
    const config = await getSyncJobConfig(JOB_ID);

    if (!force) {
      const guard = shouldRunNow(config, new Date(), { force: false, triggeredBy });
      if (!guard.shouldRun) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: guard.reason,
          authenticatedVia: principal.via,
          triggeredBy,
        });
      }
    }

    const run = await prisma.$transaction(async (tx) =>
      createSyncJobRun(tx, {
        configId: config.id,
        jobId: JOB_ID,
        triggeredBy,
        userId: principal.userId ?? null,
      })
    );
    const startedAt = run.startedAt;

    let result: SimhuisUsageSyncResult;
    try {
      result = await syncActiveSimsUsageFromSimhuis({
        userId: principal.userId,
        userRole: principal.userRole,
      });
    } catch (e: any) {
      await prisma.$transaction(async (tx) =>
        completeSyncJobRun(tx, {
          id: run.id,
          status: SyncJobStatus.FAILED,
          startedAt,
          errorMessage: e?.message ?? "Onverwachte fout in usage-sync.",
          errorDetail: { stack: e?.stack ?? null, name: e?.name ?? null },
        })
      );
      throw e;
    }

    const summary =
      `Usage-sync Simhuis afgerond. Targets in DB: ${result.totalActiveInDb}. ` +
      `Simhuis totaal: ${result.totalInSimhuis}. Gematcht: ${result.matched}. ` +
      `Bijgewerkt: ${result.updated}. Overgeslagen: ${result.skipped}. ` +
      `Fouten: ${result.errors}. Duur: ${result.durationMs}ms.`;

    const finalStatus =
      (result.errors ?? 0) > 0 ? SyncJobStatus.FAILED : SyncJobStatus.SUCCESS;

    await prisma.$transaction(async (tx) =>
      completeSyncJobRun(tx, {
        id: run.id,
        status: finalStatus,
        startedAt,
        recordsAffected: {
          totalActiveInDb: result.totalActiveInDb,
          totalInSimhuis: result.totalInSimhuis,
          matched: result.matched,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors,
        },
        errorMessage:
          (result.errors ?? 0) > 0
            ? `${result.errors} SIMs gaven een fout bij usage-sync.`
            : null,
        errorDetail: (result.failedRows?.length ?? 0) > 0
          ? { failedRows: result.failedRows ?? [] }
          : null,
      })
    );

    return NextResponse.json({
      ok: true,
      summary,
      authenticatedVia: principal.via,
      triggeredBy,
      runId: run.id,
      ...result,
    });
  } catch (e: any) {
    console.error("[api/simhuis-sync-usage] POST failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Onverwachte fout tijdens usage-synchronisatie.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Alleen POST toegestaan. Authenticeer via sessie (sim/edit recht) of via Bearer token (SIMHUIS_SYNC_API_TOKEN). " +
        "Query-parameter ?force=1 is alleen toegestaan voor ingelogde gebruikers.",
    },
    { status: 405 }
  );
}
