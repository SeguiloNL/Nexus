import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TrackerForm } from "../_components/tracker-form";
import { createTrackerAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";

export default async function NewTrackerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "tracker")) {
    throw new PermissionError("Je mag geen trackers aanmaken.");
  }

  return (
    <TrackerForm
      mode="create"
      action={createTrackerAction as any}
    />
  );
}
