import { NextResponse } from "next/server";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import {
  getSchedulerHealth,
  listSyncJobConfigs,
  listRecentSyncJobRuns,
} from "@/server/services/sync-schedule.service";
import type { SyncJobId, SyncJobStatus } from "@/types/enums";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canUserRole(user.role, "view", "setting")) {
    return NextResponse.json(
      { ok: false, error: "Onvoldoende rechten (setting/view)." },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const includeConfigs = url.searchParams.get("includeConfigs") !== "0";
  const includeRecent = url.searchParams.get("includeRecent") === "1";
  const jobFilter = (url.searchParams.get("jobId") || undefined) as
    | SyncJobId
    | undefined;
  const statusFilter = (url.searchParams.get("status") || undefined) as
    | SyncJobStatus
    | undefined;

  const [health, configs, runs] = await Promise.all([
    getSchedulerHealth(),
    includeConfigs ? listSyncJobConfigs() : Promise.resolve(null),
    includeRecent
      ? listRecentSyncJobRuns({
          jobId: jobFilter,
          status: statusFilter,
          limit: 50,
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    health,
    configs: configs ?? undefined,
    runs: runs ?? undefined,
  });
}
