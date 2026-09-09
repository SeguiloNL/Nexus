import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { VehicleForm } from "../_components/vehicle-form";
import { createVehicleAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function NewVehiclePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen aanmaken.");
  }

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
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
