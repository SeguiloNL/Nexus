import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { findTrackerById } from "@/server/services/tracker.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { TrackerDetail } from "../_components/tracker-detail";
import { deleteTrackerAction, updateTrackerAction } from "../actions";

export default async function TrackerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "tracker")) {
    redirectForbidden();
  }

  const [tracker, auditResult] = await Promise.all([
    findTrackerById(params.id, user.customerIds),
    findManyAuditLogs({
      entityType: "tracker",
      perPage: 50,
      order: "desc",
      viewerUserId: user.id,
      viewerRole: user.role,
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
      role={user.role}
      updateAction={updateTrackerAction}
      deleteAction={deleteTrackerAction}
      trackerId={params.id}
      auditLogs={auditResult as any}
    />
  );
}
