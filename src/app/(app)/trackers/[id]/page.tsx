import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findTrackerById } from "@/server/services/tracker.service";
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

  const tracker = await findTrackerById(params.id);
  if (!tracker) notFound();

  const deleteAction: any = deleteTrackerAction.bind(null, params.id);
  const updateAction: any = async (
    prev: any,
    formData: FormData
  ) => updateTrackerAction(params.id, prev, formData);

  return (
    <TrackerDetail
      tracker={tracker as any}
      role={session.user.role}
      updateAction={updateAction}
      deleteAction={deleteAction}
      trackerId={params.id}
    />
  );
}
