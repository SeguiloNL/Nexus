import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { VehicleForm } from "../_components/vehicle-form";
import { createVehicleAction } from "../actions";
import { prisma } from "@/lib/prisma";

export default async function NewVehiclePage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "vehicle")) {
    redirectForbidden();
  }

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;
  const customerScopeCustomer: any = hasScope ? { id: { in: customerIds } } : undefined;

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, ...customerScopeCustomer },
    select: { id: true, companyName: true, customerNumber: true },
    orderBy: { companyName: "asc" },
  });

  return (
    <VehicleForm
      mode="create"
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      action={createVehicleAction as any}
    />
  );
}
