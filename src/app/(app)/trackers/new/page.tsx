import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { TrackerForm } from "../_components/tracker-form";
import { createTrackerAction } from "../actions";

export default async function NewTrackerPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "tracker")) {
    redirectForbidden();
  }

  return (
    <TrackerForm
      mode="create"
      action={createTrackerAction as any}
    />
  );
}
