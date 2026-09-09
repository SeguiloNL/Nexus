import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SimForm } from "../_components/sim-form";
import { createSimAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";

export default async function NewSimPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "sim")) {
    throw new PermissionError("Je mag geen SIM-kaarten aanmaken.");
  }

  return <SimForm mode="create" action={createSimAction as any} />;
}
