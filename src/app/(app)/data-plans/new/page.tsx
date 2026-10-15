import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { DataPlanForm } from "../_components/data-plan-form";
import { createDataPlanAction } from "../actions";
import { prisma } from "@/lib/prisma";

export default async function NewDataPlanPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "data_plan")) {
    redirectForbidden();
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, productCode: true, isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <DataPlanForm
      mode="create"
      productOptions={products}
      action={createDataPlanAction as any}
    />
  );
}
