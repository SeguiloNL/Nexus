import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findVehicleById } from "@/server/services/vehicle.service";
import { VehicleDetail } from "../_components/vehicle-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import { updateVehicleAction, deleteVehicleAction } from "../actions";
import { prisma } from "@/lib/prisma";

export default async function VehicleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen bekijken.");
  }

  const vehicle = await findVehicleById(params.id);
  if (!vehicle) notFound();

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, companyName: true, customerNumber: true },
    orderBy: { companyName: "asc" },
  });

  const updateAction: any = async (
    _: any,
    prev: any,
    formData: FormData
  ) => updateVehicleAction(params.id, prev, formData);

  return (
    <VehicleDetail
      vehicle={vehicle as any}
      role={session.user.role}
      customerOptions={customers.map((c) => ({
        id: c.id,
        label: `${c.companyName} (${c.customerNumber})`,
      }))}
      updateAction={updateAction}
      deleteAction={deleteVehicleAction as any}
      vehicleId={params.id}
    />
  );
}
