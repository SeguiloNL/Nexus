import { auth } from "@/auth";
import { findManyVehicles } from "@/server/services/vehicle.service";
import { VehicleList } from "./_components/vehicle-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function VehiclesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "vehicle")) {
    throw new PermissionError("Je mag geen voertuigen bekijken.");
  }

  const result = await findManyVehicles({
    page: 1,
    perPage: 500,
    viewerRole: session.user.role as any,
  });

  const canCreate = canUserRole(session.user.role, "create", "vehicle");
  const canEdit = canUserRole(session.user.role, "edit", "vehicle");
  const canDelete = canUserRole(session.user.role, "delete", "vehicle");

  return (
    <VehicleList
      vehicles={result.data as any}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
