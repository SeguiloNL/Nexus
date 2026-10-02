import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { SimForm } from "../_components/sim-form";
import { createSimAction } from "../actions";
import { PermissionError } from "@/lib/rbac";

export default async function NewSimPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten aanmaken.");
  }

  return <SimForm mode="create" action={createSimAction as any} />;
}
