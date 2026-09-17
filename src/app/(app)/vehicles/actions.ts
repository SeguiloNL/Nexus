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
  bulkSoftDeleteVehicles,
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

export type BulkActionState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  count?: number;
};

function parseIdsFormData(formData: FormData): string[] {
  const raw = formData.get("ids");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
  } catch {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function bulkSoftDeleteVehiclesAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "vehicle");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen voertuigen geselecteerd." };
  const ctx = { userId: user.id, userRole: user.role };
  try {
    const result = await bulkSoftDeleteVehicles(ids, ctx);
    revalidatePath("/vehicles");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} voertuig(en) gearchiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
