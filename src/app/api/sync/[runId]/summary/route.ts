import { NextResponse, type NextRequest } from "next/server";
import { requirePermission, pickAuth } from "@/lib/rbac";
import { getCurrentUserOrNull } from "@/lib/auth/session";
import {
  getCurrentState,
  subscribe,
  type SyncProgressState,
} from "@/lib/progress/sync-progress-registry";
import { prisma } from "@/lib/prisma";
import { RoleScope } from "@/types/enums";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    await requirePermission(pickAuth(user as any), "import_from_inserve", "customer");
  } catch {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const anyUser = user as any;
  if (anyUser.roleScope && anyUser.roleScope !== RoleScope.INTERNAL) {
    return NextResponse.json({ ok: false, error: "Scope" }, { status: 403 });
  }

  const immediate = getCurrentState(runId);
  if (immediate?.finalSummary) {
    return NextResponse.json({
      ok: true,
      summary: immediate.finalSummary,
      overallStatus: immediate.overallStatus,
      percent: immediate.percent,
    });
  }

  // Wacht maximaal 2.5 seconden op finalisatie via subscribe
  const waitUpToMs = 2500;
  const result = await new Promise<{ summary: unknown; overallStatus?: SyncProgressState["overallStatus"]; percent?: number } | null>((resolve) => {
    const t = setTimeout(() => resolve(null), waitUpToMs);
    const unsub = subscribe(runId, (s) => {
      if (
        s.finalSummary ||
        (s.overallStatus !== "RUNNING" && s.overallStatus !== "PENDING")
      ) {
        clearTimeout(t);
        try {
          unsub();
        } catch {
          /* noop */
        }
        resolve({
          summary: s.finalSummary ?? null,
          overallStatus: s.overallStatus,
          percent: s.percent,
        });
      }
    });
  });
  if (result?.summary) {
    return NextResponse.json({
      ok: true,
      summary: result.summary,
      overallStatus: result.overallStatus,
      percent: result.percent,
    });
  }

  // Fallback: DB SyncJobRun recordsAffected Json
  try {
    const row = await prisma.syncJobRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        recordsAffected: true,
        status: true,
        errorMessage: true,
        endedAt: true,
        durationMs: true,
      },
    });
    if (row) {
      const records = (row.recordsAffected ?? null) as unknown;
      return NextResponse.json({
        ok: !!records || !!row.status,
        summary: records ?? null,
        overallStatus: (row.status as string) ?? undefined,
        dbStatus: row.status,
        dbErrorMessage: row.errorMessage ?? null,
        dbEndedAt: row.endedAt ? row.endedAt.toISOString() : null,
        dbDurationMs: row.durationMs ?? null,
        note: records
          ? undefined
          : "Run resultaat is niet (meer) beschikbaar in het geheugen. Het database record is mogelijk niet afgerond of bevat geen gedetailleerde summary. Herlaad de Sync Jobs-pagina voor de status op database-niveau.",
      });
    }
  } catch {
    /* no DB summary */
  }
  return NextResponse.json(
    {
      ok: false,
      error:
        "Run resultaat is niet (meer) beschikbaar in het geheugen. Herlaad de Sync Jobs-pagina voor de status op database-niveau.",
    },
    { status: 404 }
  );
}
