import { NextResponse } from "next/server";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  syncAllPendingToInserve,
  type InserveBatchSyncResult,
} from "@/server/services/inserve-batch-sync.service";
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
const JOB_ID = SyncJobId.INSERVE;

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
    if (user && canUserRole(user.role, "edit", "setting")) {
      principal = { userId: user.id, userRole: user.role, via: "session", canForce: true };
    } else if (envToken && bearer && bearer === envToken) {
      principal = { via: "api_token", canForce: false };
    } else {
      const msg = "Onvoldoende rechten (setting/edit) of ongeldige API-token.";
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

    let result: InserveBatchSyncResult;
    try {
      result = await syncAllPendingToInserve({
        userId: principal.userId ?? "inserve_sync_job",
        userRole: principal.userRole ?? "ADMIN",
      });
    } catch (e: any) {
      await prisma.$transaction(async (tx) =>
        completeSyncJobRun(tx, {
          id: run.id,
          status: SyncJobStatus.FAILED,
          startedAt,
          errorMessage: e?.message ?? "Onverwachte fout in Inserve batch sync.",
          errorDetail: { stack: e?.stack ?? null, name: e?.name ?? null },
        })
      );
      throw e;
    }

    const summary =
      `Inserve sync afgerond. Sub: ok=${result.subscriptions.synced} skip=${result.subscriptions.skipped} fail=${result.subscriptions.failed}. ` +
      `Inv: ok=${result.invoices.synced} skip=${result.invoices.skipped} fail=${result.invoices.failed}. ` +
      `Duur: ${result.durationMs}ms.`;

    const totalFailed = result.subscriptions.failed + result.invoices.failed;
    const finalStatus = totalFailed > 0 ? SyncJobStatus.FAILED : SyncJobStatus.SUCCESS;

    await prisma.$transaction(async (tx) =>
      completeSyncJobRun(tx, {
        id: run.id,
        status: finalStatus,
        startedAt,
        recordsAffected: {
          subscriptions: {
            total: result.subscriptions.total,
            synced: result.subscriptions.synced,
            skipped: result.subscriptions.skipped,
            failed: result.subscriptions.failed,
          },
          invoices: {
            total: result.invoices.total,
            synced: result.invoices.synced,
            skipped: result.invoices.skipped,
            failed: result.invoices.failed,
          },
          subscriptionErrors: result.subscriptions.failedDetails,
          invoiceErrors: result.invoices.failedDetails,
        } as any,
        errorMessage:
          totalFailed > 0
            ? `${totalFailed} Inserve-items gaven een fout (zie errorDetail voor IDs).`
            : null,
        errorDetail:
          totalFailed > 0
            ? {
                subscriptionsFailed: result.subscriptions.failedDetails,
                invoicesFailed: result.invoices.failedDetails,
              }
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
    console.error("[api/inserve-sync] POST failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Onverwachte fout tijdens Inserve-sync.",
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
        "Alleen POST toegestaan. Authenticeer via sessie (setting/edit recht) of via Bearer token (SIMHUIS_SYNC_API_TOKEN). " +
        "Query-parameter ?force=1 is alleen toegestaan voor ingelogde gebruikers.",
    },
    { status: 405 }
  );
}
