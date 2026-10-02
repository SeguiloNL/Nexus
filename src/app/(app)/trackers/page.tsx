import { auth } from "@/auth";
import { findManyTrackers } from "@/server/services/tracker.service";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { TrackerListWithImport } from "./_components/tracker-list-with-import";
import { PermissionError } from "@/lib/rbac";

export default async function TrackersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (!canUserRole(session.user.permissions, "view", "tracker")) {
    throw new PermissionError("Je mag geen trackers bekijken.");
  }

  const [result] = await Promise.all([
    findManyTrackers({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
      customerScope: session.user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(session.user.permissions, "create", "tracker");
  const canEdit = canUserRole(session.user.permissions, "edit", "tracker");
  const canDelete = canUserRole(session.user.permissions, "delete", "tracker");
  const canImport = canUserRole(session.user.permissions, "import", "tracker");
  const canExport = canUserRole(session.user.permissions, "export", "tracker");

  return (
    <TrackerListWithImport
      trackers={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
      canExport={canExport}
    />
  );
}
