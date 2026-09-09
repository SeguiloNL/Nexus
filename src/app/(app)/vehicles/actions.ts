"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateVehicleSchema,
  UpdateVehicleSchema,
  type CreateVehicleInput,
} from "@/server/validators/vehicle";
import {
  createVehicle,
  softDeleteVehicle,
  updateVehicle,
} from "@/server/services/vehicle.service";

export type VehicleActionState = {
  errors?: Partial<Record<keyof CreateVehicleInput, string[]>>;
  message?: string | null;
  vehicleId?: string;
};

export async function createVehicleAction(
  _prev: VehicleActionState,
  formData: FormData
): Promise<VehicleActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "vehicle");

  const data = {
    customerId: formData.get("customerId") || undefined,
    licensePlate: formData.get("licensePlate") || null,
    vin: formData.get("vin") || null,
    brand: formData.get("brand") || null,
    model: formData.get("model") || null,
    description: formData.get("description") || null,
    notes: formData.get("notes") || null,
  };

  const validated = CreateVehicleSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as VehicleActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const vehicle = await createVehicle(validated.data, ctx);

  revalidatePath("/vehicles");
  revalidatePath(`/customers/${vehicle.customerId}`);
  redirect(`/vehicles/${vehicle.id}`);
}

export async function updateVehicleAction(
  vehicleId: string,
  _prev: VehicleActionState,
  formData: FormData
): Promise<VehicleActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "vehicle");

  const data: any = {
    licensePlate: formData.get("licensePlate") || null,
    vin: formData.get("vin") || null,
    brand: formData.get("brand") || null,
    model: formData.get("model") || null,
    description: formData.get("description") || null,
    notes: formData.get("notes") || null,
  };

  const validated = UpdateVehicleSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as VehicleActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const vehicle = await updateVehicle(vehicleId, validated.data, ctx);

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/customers/${vehicle.customerId}`);
  redirect(`/vehicles/${vehicleId}`);
}

export async function deleteVehicleAction(vehicleId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "vehicle");

  const ctx = { userId: user.id, userRole: user.role };
  const vehicle = await softDeleteVehicle(vehicleId, ctx);

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath(`/customers/${vehicle.customerId}`);
  redirect("/vehicles");
}
