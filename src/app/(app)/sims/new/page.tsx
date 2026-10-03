import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { SimForm } from "../_components/sim-form";
import { createSimAction } from "../actions";

export default async function NewSimPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "sim")) {
    redirectForbidden();
  }

  return <SimForm mode="create" action={createSimAction as any} />;
}
