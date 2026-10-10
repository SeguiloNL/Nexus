import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { DataPlanForm } from "../_components/data-plan-form";
import { createDataPlanAction } from "../actions";

export default async function NewDataPlanPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "data_plan")) {
    redirectForbidden();
  }

  return (
    <DataPlanForm
      mode="create"
      action={createDataPlanAction as any}
    />
  );
}
