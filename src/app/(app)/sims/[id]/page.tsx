import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findSimById } from "@/server/services/sim.service";
import { findManyAuditLogs } from "@/server/services/audit.service";
import { SimDetail } from "../_components/sim-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { deleteSimAction, updateSimAction } from "../actions";

export default async function SimDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten bekijken.");
  }

  const [sim, auditResult] = await Promise.all([
    findSimById(params.id),
    findManyAuditLogs({
      entityType: "sim",
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
  if (!sim) notFound();

  return (
    <SimDetail
      sim={sim as any}
      role={session.user.role}
      updateAction={updateSimAction}
      deleteAction={deleteSimAction}
      simId={params.id}
      auditLogs={auditResult as any}
    />
  );
}
