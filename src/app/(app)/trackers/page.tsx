import { auth } from "@/auth";
import { findManyTrackers } from "@/server/services/tracker.service";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { TrackerListWithImport } from "./_components/tracker-list-with-import";

export default async function TrackersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [result] = await Promise.all([
    findManyTrackers({
      page: 1,
      perPage: 500,
      viewerRole: session.user.role,
    }),
  ]);

  const canCreate = canUserRole(session.user.role, "create", "tracker");
  const canEdit = canUserRole(session.user.role, "edit", "tracker");
  const canDelete = canUserRole(session.user.role, "delete", "tracker");
  const canImport = canUserRole(session.user.role, "import", "tracker");

  return (
    <TrackerListWithImport
      trackers={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      canImport={canImport}
    />
  );
}
