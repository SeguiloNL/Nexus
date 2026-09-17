"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
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
} from "@/server/services/activation-order.service";

export type OrderActionState = {
  errors?: Record<string, string[] | undefined>;
  message?: string | null;
  orderId?: string;
};

export async function createOrderAction(_prev: OrderActionState, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "activation_order");

  const raw: any = {
    customerId: formData.get("customerId") || undefined,
    subCustomerId: formData.get("subCustomerId") || null,
    productId: formData.get("productId") || undefined,
    desiredStartDate: formData.get("desiredStartDate"),
    monthlyPrice: formData.get("monthlyPrice") || 0,
    billingCycle: formData.get("billingCycle") || undefined,
    trackerId: formData.get("trackerId") || null,
    simId: formData.get("simId") || null,
    vehicleId: formData.get("vehicleId") || null,
    internalNotes: formData.get("internalNotes") || null,
  };

  const validated = CreateActivationOrderSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const order = await createDraftOrder(validated.data, ctx);
  revalidatePath("/activations");
  redirect(`/activations/${order.id}`);
}

export async function updateOrderAction(orderId: string, _prev: OrderActionState, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "activation_order");

  const raw: any = {};
  for (const [k, v] of Array.from(formData.entries())) {
    raw[k] = v ?? undefined;
  }
  if (!raw.trackerId) raw.trackerId = null;
  if (!raw.simId) raw.simId = null;
  if (!raw.vehicleId) raw.vehicleId = null;
  if (!raw.subCustomerId) raw.subCustomerId = null;

  const validated = UpdateActivationOrderSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  await updateOrder(orderId, validated.data, ctx);
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export async function markReadyAction(orderId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "activation_order");
  const ctx = { userId: user.id, userRole: user.role };
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
  requirePermission(user.role, "delete", "activation_order");

  const { orderId, formData } = resolveCancelArgs(...args);
  const reason = (formData.get("reason") as string) || undefined;

  const ctx = { userId: user.id, userRole: user.role };
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
  requirePermission(user.role, "edit", "activation_order");
  const orderId = resolveRetryArgs(...args);
  const ctx = { userId: user.id, userRole: user.role };
  try {
    await retryFailed(orderId, ctx);
  } catch (e: any) {
    return { message: e?.message ?? "Opnieuw proberen mislukt." };
  }
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export async function completeActivationAction(orderId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "activation_order");
  const ctx = { userId: user.id, userRole: user.role };
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
