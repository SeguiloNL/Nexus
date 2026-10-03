import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManyTrackers } from "@/server/services/tracker.service";
import { TrackerListWithImport } from "./_components/tracker-list-with-import";

export default async function TrackersPage() {
  const user = await requireUser();

  if (!canUserRole(user.permissions, "view", "tracker")) {
    redirectForbidden();
  }

  const [result] = await Promise.all([
    findManyTrackers({
      page: 1,
      perPage: 500,
      viewerRole: user.role,
      customerScope: user.customerIds,
    }),
  ]);

  const canCreate = canUserRole(user.permissions, "create", "tracker");
  const canEdit = canUserRole(user.permissions, "edit", "tracker");
  const canDelete = canUserRole(user.permissions, "delete", "tracker");
  const canImport = canUserRole(user.permissions, "import", "tracker");
  const canExport = canUserRole(user.permissions, "export", "tracker");

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
