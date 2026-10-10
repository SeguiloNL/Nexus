import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { findManyDataPlans } from "@/server/services/data-plan.service";
import { DataPlanList } from "./_components/data-plan-list";

export default async function DataPlansPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "data_plan")) {
    redirectForbidden();
  }

  const [result] = await Promise.all([
    findManyDataPlans({ page: 1, perPage: 500 }),
  ]);

  const canCreate = canUserRole(user.permissions, "create", "data_plan");
  const canEdit = canUserRole(user.permissions, "edit", "data_plan");
  const canDelete = canUserRole(user.permissions, "delete", "data_plan");

  return (
    <DataPlanList
      dataPlans={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
