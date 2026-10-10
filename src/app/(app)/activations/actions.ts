"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission, hasMinRole } from "@/lib/rbac";
import { RoleScope } from "@/types/enums";
import {
  CreateActivationOrderSchema,
  UpdateActivationOrderSchema,
} from "@/server/validators/activationOrder";
import {
  completeActivation,
  createDraftOrder,
  updateOrder,
  markReady,
  cancelOrder,
  retryFailed,
  deleteOrder,
} from "@/server/services/activation-order.service";
import {
  precheckProductById,
  precheckProductAvailability,
} from "@/server/integrations/simhuis/service";
import {
  subscribeSimById,
  type SimSubscribeResult,
} from "@/server/services/simhuis-asset.service";
import { UserRole, ActivationOrderProductType } from "@/types/enums";

const TARGET_PRODUCT_ID = "662a3e2f4e2af7a852384696";
const TARGET_PRODUCT_NAME = "Seguilo B.V. ROPD LR 0.40 OU per MB 0.0029 EUR SMS";
const KNOWN_ACCOUNT_CONTEXT = "6ffd71bb-c164-525f-ac89-64d086177d52";

export type OrderActionState = {
  errors?: Record<string, string[] | undefined>;
  message?: string | null;
  orderId?: string;
};

export async function createOrderAction(_prev: OrderActionState, formData: FormData) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "create", "activation_order");

  const raw: any = {
    customerId: formData.get("customerId") || undefined,
    subCustomerId: formData.get("subCustomerId") || null,
    productId: formData.get("productId") || undefined,
    dataPlanId: formData.get("dataPlanId") || null,
    orderType: (formData.get("orderType") as string) || undefined,
    desiredStartDate: formData.get("desiredStartDate"),
    monthlyPrice: formData.get("monthlyPrice") || 0,
    billingCycle: formData.get("billingCycle") || undefined,
    trackerId: formData.get("trackerId") || null,
    simId: formData.get("simId") || null,
    vehicleId: formData.get("vehicleId") || null,
    internalNotes: formData.get("internalNotes") || null,
  };

  if (raw.orderType && raw.orderType === ActivationOrderProductType.SIM_ONLY_DATA) {
    // Dubbele UI-guard: ook hier expliciet het sim_only_order recht controleren,
    // zodat ook directe API-aanroepen worden geblokkeerd.
    await requirePermission(user.permissions ?? user.role, "sim_only_order", "activation_order");
  }

  const validated = CreateActivationOrderSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
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
  const order = await createDraftOrder(validated.data, ctx);
  revalidatePath("/activations");
  redirect(`/activations/${order.id}`);
}

export async function updateOrderAction(orderId: string, _prev: OrderActionState, formData: FormData) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "activation_order");

  const raw: any = {};
  for (const [k, v] of Array.from(formData.entries())) {
    raw[k] = v ?? undefined;
  }
  if (!raw.trackerId) raw.trackerId = null;
  if (!raw.simId) raw.simId = null;
  if (!raw.vehicleId) raw.vehicleId = null;
  if (!raw.subCustomerId) raw.subCustomerId = null;
  if (!raw.dataPlanId) raw.dataPlanId = null;

  // Sim-only guard (indien orderType expliciet meegegeven)
  if (raw.orderType && raw.orderType === ActivationOrderProductType.SIM_ONLY_DATA) {
    await requirePermission(user.permissions ?? user.role, "sim_only_order", "activation_order");
  }

  const validated = UpdateActivationOrderSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
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
  await updateOrder(orderId, validated.data, ctx);
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export async function markReadyAction(orderId: string) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "activation_order");
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await markReady(orderId, ctx);
  } catch (e: any) {
    revalidatePath(`/activations/${orderId}`);
    return { message: e.message };
  }
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export type CancelOrderState = {
  message?: string | null;
};

function resolveCancelArgs(...args: any[]) {
  if (args.length >= 3) {
    return {
      orderId: args[0] as string,
      formData: args[2] as FormData,
    };
  }
  if (args.length === 2) {
    const [a, b] = args;
    if (typeof a === "string" && b instanceof FormData) {
      return { orderId: a, formData: b };
    }
    if (a && a instanceof FormData) {
      return {
        orderId: (a.get("id") as string) ?? "",
        formData: a,
      };
    }
  }
  if (args.length === 1) {
    const a = args[0];
    if (typeof a === "string") {
      return { orderId: a, formData: new FormData() };
    }
    if (a instanceof FormData) {
      return {
        orderId: (a.get("id") as string) ?? "",
        formData: a,
      };
    }
  }
  return { orderId: "", formData: new FormData() };
}

export async function cancelOrderAction(
  ...args: any[]
): Promise<CancelOrderState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "activation_order");

  const { orderId, formData } = resolveCancelArgs(...args);
  const reason = (formData.get("reason") as string) || undefined;

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await cancelOrder(orderId, ctx, reason);
  } catch (e: any) {
    return { message: e?.message ?? "Annuleren mislukt." };
  }
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

function resolveRetryArgs(...args: any[]): string {
  if (typeof args[0] === "string") return args[0];
  if (args[0] instanceof FormData) return (args[0].get("id") as string) ?? "";
  if (args[1] instanceof FormData) return (args[1].get("id") as string) ?? "";
  return "";
}

export type RetryOrderState = {
  message?: string | null;
};

export async function retryFailedAction(
  ...args: any[]
): Promise<RetryOrderState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "activation_order");
  const orderId = resolveRetryArgs(...args);
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await retryFailed(orderId, ctx);
  } catch (e: any) {
    return { message: e?.message ?? "Opnieuw proberen mislukt." };
  }
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export type DeleteOrderState = {
  message?: string | null;
};

function resolveDeleteArgs(...args: any[]): string {
  if (typeof args[0] === "string") return args[0];
  if (args[0] instanceof FormData) return (args[0].get("id") as string) ?? "";
  if (args[1] instanceof FormData) return (args[1].get("id") as string) ?? "";
  return "";
}

export async function deleteOrderAction(
  ...args: any[]
): Promise<DeleteOrderState> {
  const user = await getCurrentUser();
  await requirePermission(user.role, "delete", "activation_order");
  const orderId = resolveDeleteArgs(...args);
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  try {
    await deleteOrder(orderId, ctx);
  } catch (e: any) {
    return { message: e?.message ?? "Verwijderen mislukt." };
  }
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect("/activations");
}

export type SimPrecheckResult = {
  ok: boolean;
  message: string;
  productNameMatch?: boolean;
  productAvailableForIccid?: boolean;
  productNameFromApi?: string | null;
  matchCount?: number;
};

export async function precheckSimProductAction(
  iccid: string
): Promise<SimPrecheckResult> {
  const user = await getCurrentUser();
  if (user.roleScope !== ("INTERNAL" as unknown as typeof user.roleScope) || !hasMinRole(user.role, UserRole.ADMIN)) {
    return {
      ok: false,
      message: "Deze actie is alleen beschikbaar voor interne beheerders (ADMIN).",
    };
  }
  if (!iccid || typeof iccid !== "string" || iccid.trim().length < 10) {
    return {
      ok: false,
      message: "Ongeldige ICCID opgegeven.",
    };
  }
  const iccidClean = iccid.trim();

  try {
    const pre1 = await precheckProductById(TARGET_PRODUCT_ID, TARGET_PRODUCT_NAME);
    const pre2 = await precheckProductAvailability(iccidClean, TARGET_PRODUCT_ID);
    return {
      ok: pre1.ok && pre2.ok,
      message: pre1.ok
        ? pre2.ok
          ? "Product is geldig en beschikbaar voor deze SIM."
          : pre2.detail ?? "Product is niet beschikbaar voor deze SIM."
        : pre1.detail ?? "Productcontrole mislukte.",
      productNameMatch: pre1.ok,
      productAvailableForIccid: pre2.ok,
      productNameFromApi: pre1.productName ?? null,
      matchCount: pre2.matchCount ?? 0,
    };
  } catch (e: any) {
    return {
      ok: false,
      message: String(e?.message ?? e ?? "Onverwachte fout tijdens productcontroles."),
    };
  }
}

export async function validateAndSubscribeSimAction(
  simId: string,
  orderId?: string
): Promise<SimSubscribeResult> {
  const user = await getCurrentUser();
  if (user.roleScope !== ("INTERNAL" as unknown as typeof user.roleScope) || !hasMinRole(user.role, UserRole.ADMIN)) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Deze actie is alleen beschikbaar voor interne beheerders (ADMIN).",
      error: {
        kind: "PERMISSION",
        detail: "Onvoldoende rechten: INTERNAL scope + ADMIN rol vereist.",
      },
    };
  }
  if (!simId || typeof simId !== "string" || simId.trim().length === 0) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Ongeldige SIM-ID opgegeven.",
      error: {
        kind: "NOT_FOUND",
        detail: "simId ontbreekt.",
      },
    };
  }
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerId: (user as any).customerId ?? (user.customerIds?.[0] ?? null),
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const result = await subscribeSimById(simId.trim(), ctx, {
    orderId: orderId ? orderId.trim() : undefined,
    targetProductId: TARGET_PRODUCT_ID,
    targetProductName: TARGET_PRODUCT_NAME,
  });
  revalidatePath("/sims");
  revalidatePath("/trackers");
  revalidatePath("/activations");
  if (orderId) {
    revalidatePath(`/activations/${orderId.trim()}`);
  }
  return result;
}

export async function completeActivationAction(orderId: string) {
  const user = await getCurrentUser();
  await requirePermission(user.role, "edit", "activation_order");
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    customerScope: user.customerIds,
    permissions: user.permissions,
  };
  const result = await completeActivation(orderId, ctx);
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  revalidatePath("/subscriptions");
  revalidatePath("/trackers");
  revalidatePath("/sims");
  redirect(result?.subscription
    ? `/subscriptions/${result.subscription.id}`
    : `/activations/${orderId}`);
}
