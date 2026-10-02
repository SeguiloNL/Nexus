import { requireUser, canUserRole } from "@/lib/auth/session";
import { notFound, redirect } from "next/navigation";
import { findVehicleById } from "@/server/services/vehicle.service";
import { VehicleDetail } from "../_components/vehicle-detail";
import { PermissionError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function VehicleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen bekijken.");
  }

  const vehicle = await findVehicleById(params.id, user.customerIds);
  if (!vehicle) notFound();

  const customerIds = user.customerIds ?? [];
  const hasScope = customerIds.length > 0;
  const customerWhere: any = { deletedAt: null };
  if (hasScope) customerWhere.id = { in: customerIds };

  const customers = await prisma.customer.findMany({
    where: customerWhere,
    select: { id: true, companyName: true, customerNumber: true },
    orderBy: { companyName: "asc" },
  });

  return (
    <VehicleDetail
      vehicle={vehicle as any}
      role={user.role}
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      vehicleId={params.id}
    />
  );
}
