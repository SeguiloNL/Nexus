import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { TrackerForm } from "../_components/tracker-form";
import { createTrackerAction } from "../actions";
import { PermissionError } from "@/lib/rbac";

export default async function NewTrackerPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "tracker")) {
    throw new PermissionError("Je mag geen trackers aanmaken.");
  }

  return (
    <TrackerForm
      mode="create"
      action={createTrackerAction as any}
    />
  );
}
