import { requireUser, canUserRole } from "@/lib/auth/session";
import { findManyVehicles } from "@/server/services/vehicle.service";
import { VehicleList } from "./_components/vehicle-list";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function VehiclesPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen bekijken.");
  }

  const result = await findManyVehicles({
    page: 1,
    perPage: 500,
    viewerRole: user.role as any,
    customerScope: user.customerIds,
  });

  const canCreate = canUserRole(user.permissions, "create", "vehicle");
  const canEdit = canUserRole(user.permissions, "edit", "vehicle");
  const canDelete = canUserRole(user.permissions, "delete", "vehicle");

  return (
    <VehicleList
      vehicles={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
