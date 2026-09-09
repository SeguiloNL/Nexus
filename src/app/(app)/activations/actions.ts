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
  requirePermission(user.role, "create", "activationOrder");

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
  requirePermission(user.role, "edit", "activationOrder");

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
  requirePermission(user.role, "edit", "activationOrder");
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

export async function cancelOrderAction(orderId: string, _prev: any, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "activationOrder");
  const reason = (formData.get("reason") as string) || undefined;
  const ctx = { userId: user.id, userRole: user.role };
  await cancelOrder(orderId, ctx, reason);
  revalidatePath(`/activations/${orderId}`);
  revalidatePath("/activations");
  redirect(`/activations/${orderId}`);
}

export async function retryFailedAction(orderId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "activationOrder");
  const ctx = { userId: user.id, userRole: user.role };
  await retryFailed(orderId, ctx);
  revalidatePath(`/activations/${orderId}`);
  redirect(`/activations/${orderId}`);
}

export async function completeActivationAction(orderId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "activationOrder");
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
