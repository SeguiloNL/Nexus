import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { VehicleForm } from "../_components/vehicle-form";
import { createVehicleAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function NewVehiclePage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen aanmaken.");
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
