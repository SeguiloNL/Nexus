import { NextResponse } from "next/server";
import {
  bearerTokenFromHeader,
  getCurrentUserOrNull,
  canUserRole,
  tokensEqual,
} from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  runUsageAlertNotificationCycle,
  type UsageAlertCycleReport,
} from "@/server/services/sim-usage-alert.service";
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
const JOB_ID = SyncJobId.SIMHUIS_USAGE_ALERT_NOTIFY;

function determineTriggeredBy(
  req: Request,
  via: "session" | "api_token"
): SyncJobTrigger {
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
    const authHeader =
      req.headers.get("authorization") ?? req.headers.get("Authorization");
    const envToken = (process.env[REQ_TOKEN_VAR] ?? "").trim();
    const bearer = bearerTokenFromHeader(authHeader);

    let principal: {
      userId?: string;
      userRole?: any;
      via: "session" | "api_token";
      canForce: boolean;
    } | null = null;

    if (bearer && envToken) {
      if (tokensEqual(bearer, envToken)) {
        principal = { via: "api_token", canForce: false };
      }
    }

    if (!principal) {
      const user = await getCurrentUserOrNull();
      if (user && canUserRole(user.role, "edit", "setting")) {
        principal = {
          userId: user.id,
          userRole: user.role,
          via: "session",
          canForce: true,
        };
      }
    }

    if (!principal) {
      return NextResponse.json(
        {
          ok: false,
          error: bearer
            ? "Ongeldige Bearer-token (SIMHUIS_SYNC_API_TOKEN komt niet overeen)."
            : "Niet geauthenticeerd: log in (setting/edit) of stuur een geldige Bearer-token (SIMHUIS_SYNC_API_TOKEN) mee.",
        },
        { status: 403 }
      );
    }

    if (force && !principal.canForce) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Forceren is enkel toegestaan voor ingelogde ADMIN/Medewerker.",
        },
        { status: 403 }
      );
    }

    const triggeredBy = determineTriggeredBy(req, principal.via);
    const config = await getSyncJobConfig(JOB_ID);

    if (!force) {
      const guard = shouldRunNow(config, new Date(), {
        force: false,
        triggeredBy,
      });
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

    let report: UsageAlertCycleReport;
    try {
      report = await runUsageAlertNotificationCycle({
        thresholdPercentOverride: undefined,
        limitUsers: undefined,
        dryRunForce: false,
      });
    } catch (e: any) {
      await prisma.$transaction(async (tx) =>
        completeSyncJobRun(tx, {
          id: run.id,
          status: SyncJobStatus.FAILED,
          startedAt,
          errorMessage:
            e?.message ?? "Onverwachte fout in usage-alert notificatiecyclus.",
          errorDetail: {
            stack: e?.stack ?? null,
            name: e?.name ?? null,
          },
        })
      );
      throw e;
    }

    const summary =
      `Usage alert notificaties afgerond. Gebruikers gecheckt: ${report.usersChecked}. ` +
      `Gebruikers gerapporteerd: ${report.usersWithAlerts}. ` +
      `Notificaties verstuurd: ${report.usersNotified}. Dry-run: ${report.usersNotifiedDryRun}. ` +
      `Falen: ${report.userSendFailures}. SIMs boven drempel: ${report.simsAtThresholdTotal}. ` +
      `Gerapporteerde SIMs: ${report.simsReportedEmails}. Overgeslagen (anti-spam): ${report.simsSkippedAlreadySent}.`;

    const status =
      report.userSendFailures > 0
        ? SyncJobStatus.FAILED
        : SyncJobStatus.SUCCESS;

    await prisma.$transaction(async (tx) =>
      completeSyncJobRun(tx, {
        id: run.id,
        status,
        startedAt,
        recordsAffected: {
          usersChecked: report.usersChecked,
          usersWithAlerts: report.usersWithAlerts,
          usersNotified: report.usersNotified,
          usersNotifiedDryRun: report.usersNotifiedDryRun,
          userSendFailures: report.userSendFailures,
          simsAtThresholdTotal: report.simsAtThresholdTotal,
          simsReportedEmails: report.simsReportedEmails,
          simsSkippedAlreadySent: report.simsSkippedAlreadySent,
          simsSkippedScope: report.simsSkippedScope,
          alertsCreated: report.alertsCreated,
        },
        errorMessage:
          report.userSendFailures > 0
            ? `${report.userSendFailures} gebruikers konden geen e-mail ontvangen.`
            : null,
        errorDetail: null,
      })
    );

    return NextResponse.json({
      ok: true,
      summary,
      authenticatedVia: principal.via,
      triggeredBy,
      runId: run.id,
      report,
    });
  } catch (e: any) {
    console.error("[api/simhuis-notify-usage-alerts] POST failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error:
          e?.message ??
          "Onverwachte fout tijdens usage-alert notificatiecyclus.",
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
