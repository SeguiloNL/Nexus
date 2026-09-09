import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findTrackerById } from "@/server/services/tracker.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { TrackerDetail } from "../_components/tracker-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { deleteTrackerAction, updateTrackerAction } from "../actions";

export default async function TrackerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "tracker")) {
    throw new PermissionError("Je mag geen trackers bekijken.");
  }

  const [tracker, auditResult] = await Promise.all([
    findTrackerById(params.id),
    findManyAuditLogs({
      entityType: "tracker",
      perPage: 50,
      order: "desc",
      viewerUserId: session.user.id,
      viewerRole: session.user.role,
    }).then((r) =>
      Promise.all(
        r.data.map(async (log: any) => {
          const u = log.user
            ? { name: log.user.name, email: log.user.email }
            : null;
          return {
            id: log.id,
            timestamp: log.timestamp,
            action: log.action,
            entityType: log.entityType,
            entityId: log.entityId,
            oldValues: log.oldValues,
            newValues: log.newValues,
            user: u,
          };
        })
      )
    ),
  ]);
  if (!tracker) notFound();

  return (
    <TrackerDetail
      tracker={tracker as any}
      role={session.user.role}
      updateAction={updateTrackerAction}
      deleteAction={deleteTrackerAction}
      trackerId={params.id}
      auditLogs={auditResult as any}
    />
  );
}
