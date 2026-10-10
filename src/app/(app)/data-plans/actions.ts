"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateDataPlanSchema,
  UpdateDataPlanSchema,
  type CreateDataPlanInput,
} from "@/server/validators/dataPlan";
import {
  createDataPlan,
  updateDataPlan,
  bulkSetActiveDataPlans,
  deleteDataPlan,
  bulkDeleteDataPlans,
  amountUnitToBytes,
} from "@/server/services/data-plan.service";
import { DataUnit } from "@/types/enums";

export type DataPlanActionState = {
  errors?: Partial<Record<keyof CreateDataPlanInput, string[]>>;
  message?: string | null;
  dataPlanId?: string;
};

function coerceDataAmount(formData: FormData): {
  dataAmountBytes: bigint | null | undefined;
  dataAmountDisplayUnit: DataUnit | null | undefined;
} {
  const rawAmount = formData.get("dataAmount") as string | null;
  const rawUnit = formData.get("dataUnit") as string | null;

  if (!rawUnit || rawUnit === "__none__") {
    return { dataAmountBytes: undefined, dataAmountDisplayUnit: undefined };
  }
  if (rawUnit === DataUnit.UNLIMITED) {
    return { dataAmountBytes: null, dataAmountDisplayUnit: DataUnit.UNLIMITED };
  }
  if (!rawAmount) {
    return { dataAmountBytes: null, dataAmountDisplayUnit: rawUnit as DataUnit };
  }
  return {
    dataAmountBytes: amountUnitToBytes(rawAmount, rawUnit),
    dataAmountDisplayUnit: rawUnit as DataUnit,
  };
}

function formDataToCreateDataPlan(formData: FormData): Partial<CreateDataPlanInput> {
  const data: any = {};
  data.name = formData.get("name") || undefined;
  data.description = formData.get("description") || null;

  const { dataAmountBytes, dataAmountDisplayUnit } = coerceDataAmount(formData);
  if (dataAmountDisplayUnit !== undefined) {
    data.dataAmountBytes = dataAmountBytes;
    data.dataAmountDisplayUnit = dataAmountDisplayUnit;
  }

  const validityMode = formData.get("validityMode") as string | null;
  if (validityMode === "days") {
    const rawDays = formData.get("validityDays") as string | null;
    if (rawDays) data.validityDays = Number(rawDays);
    else data.validityDays = null;
  } else if (validityMode === "cycle") {
    data.validityBillingCycle = (formData.get("validityBillingCycle") as string) || null;
  } else if (validityMode === "unlimited") {
    data.validityDays = null;
    data.validityBillingCycle = null;
  }

  const monthlyPriceRaw = formData.get("monthlyPrice") as string | null;
  if (monthlyPriceRaw !== null && monthlyPriceRaw !== "") {
    data.monthlyPrice = Number(monthlyPriceRaw);
  }
  data.currency = (formData.get("currency") as string) || undefined;
  const btwRaw = formData.get("btwPercentage") as string | null;
  if (btwRaw !== null && btwRaw !== "") {
    data.btwPercentage = Number(btwRaw);
  }

  data.provider = formData.get("provider") || null;
  data.providerPlanRef = formData.get("providerPlanRef") || null;
  data.providerOfferRef = formData.get("providerOfferRef") || null;

  const isActive = formData.get("isActive");
  if (isActive !== null) {
    data.isActive = isActive === "on" || isActive === "true";
  }
  const simOnlyAvailable = formData.get("simOnlyAvailable");
  if (simOnlyAvailable !== null) {
    data.simOnlyAvailable = simOnlyAvailable === "on" || simOnlyAvailable === "true";
  }
  return data;
}

export async function createDataPlanAction(
  _prev: DataPlanActionState,
  formData: FormData
): Promise<DataPlanActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "create", "data_plan");

  const data = formDataToCreateDataPlan(formData);
  const validated = CreateDataPlanSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as DataPlanActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const created = await createDataPlan(validated.data, ctx);

  revalidatePath("/data-plans");
  redirect(`/data-plans/${created.id}`);
}

export async function updateDataPlanAction(
  dataPlanId: string,
  _prev: DataPlanActionState,
  formData: FormData
): Promise<DataPlanActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "data_plan");

  const data = formDataToCreateDataPlan(formData);
  const validated = UpdateDataPlanSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as DataPlanActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  await updateDataPlan(dataPlanId, validated.data, ctx);

  revalidatePath("/data-plans");
  revalidatePath(`/data-plans/${dataPlanId}`);
  redirect(`/data-plans/${dataPlanId}`);
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

export async function bulkActivateDataPlansAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "data_plan");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen dataplannen geselecteerd." };
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await bulkSetActiveDataPlans(ids, true, ctx);
    revalidatePath("/data-plans");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} dataplan(nen) geactiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function bulkDeactivateDataPlansAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "data_plan");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen dataplannen geselecteerd." };
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await bulkSetActiveDataPlans(ids, false, ctx);
    revalidatePath("/data-plans");
    return {
      ok: true,
      count: result.count,
      message: `${result.count} dataplan(nen) gedeactiveerd.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function deleteDataPlanAction(dataPlanId: string): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "data_plan");
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await deleteDataPlan(dataPlanId, ctx);
    revalidatePath("/data-plans");
    return { ok: true, count: 1, message: "Dataplan is verwijderd." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function bulkDeleteDataPlansAction(
  _prev: BulkActionState,
  formData: FormData
): Promise<BulkActionState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "data_plan");
  const ids = parseIdsFormData(formData);
  if (!ids.length) return { ok: false, error: "Geen dataplannen geselecteerd." };
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    const result = await bulkDeleteDataPlans(ids, ctx);
    revalidatePath("/data-plans");
    if (result.count === 0 && result.skipped.length > 0) {
      return {
        ok: false,
        error: `Geen dataplannen verwijderd. ${result.skipped[0].reason}`,
      };
    }
    const base = `${result.count} dataplan(nen) verwijderd.`;
    const extra = result.skipped.length
      ? ` ${result.skipped.length} overgeslagen: ${result.skipped.map((s) => s.reason).join(" | ")}`
      : "";
    return { ok: true, count: result.count, message: base + extra };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
