"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, requirePermission } from "@/lib/auth/session";
import {
  CreateSubscriptionSchema,
  UpdateSubscriptionSchema,
  UpdateSubscriptionStatusSchema,
  type CreateSubscriptionInput,
} from "@/server/validators/subscription";
import {
  createSubscription,
  updateSubscription,
  suspendSubscription,
  resumeSubscription,
  cancelSubscription,
  terminateSubscription,
} from "@/server/services/subscription.service";

export type SubscriptionActionState = {
  errors?: Partial<Record<keyof CreateSubscriptionInput | "reason", string[]>>;
  message?: string | null;
  subscriptionId?: string;
};

export async function createSubscriptionAction(
  _prev: SubscriptionActionState,
  formData: FormData
): Promise<SubscriptionActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "subscription");

  const data = {
    customerId: formData.get("customerId") || undefined,
    productId: formData.get("productId") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || null,
    monthlyPrice: formData.get("monthlyPrice"),
    billingCycle: formData.get("billingCycle") || undefined,
    notes: formData.get("notes") || null,
    status: formData.get("status") || undefined,
  };

  const validated = CreateSubscriptionSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as SubscriptionActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const sub = await createSubscription(validated.data, ctx);

  revalidatePath("/subscriptions");
  revalidatePath(`/customers/${sub.customerId}`);
  redirect(`/subscriptions/${sub.id}`);
}

export async function updateSubscriptionAction(
  subscriptionId: string,
  _prev: SubscriptionActionState,
  formData: FormData
): Promise<SubscriptionActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data: any = {
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || null,
    monthlyPrice: formData.get("monthlyPrice"),
    billingCycle: formData.get("billingCycle") || undefined,
    notes: formData.get("notes") || null,
    productId: formData.get("productId") || undefined,
  };

  const validated = UpdateSubscriptionSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as SubscriptionActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const sub = await updateSubscription(subscriptionId, validated.data, ctx);

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  revalidatePath(`/customers/${sub.customerId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function updateSubscriptionStatusAction(
  subscriptionId: string,
  _prev: any,
  formData: FormData
) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const validated = UpdateSubscriptionStatusSchema.safeParse({
    status: formData.get("status"),
    reason: formData.get("reason") || null,
  });
  if (!validated.success) {
    return { message: "Ongeldige status." };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const { status, reason } = validated.data;
  const target = String(status);

  let sub;
  switch (target) {
    case "SUSPENDED":
      sub = await suspendSubscription(subscriptionId, ctx, reason);
      break;
    case "ACTIVE":
      sub = await resumeSubscription(subscriptionId, ctx, reason);
      break;
    case "CANCELLED":
      sub = await cancelSubscription(subscriptionId, ctx, reason);
      break;
    case "TERMINATED":
      sub = await terminateSubscription(subscriptionId, ctx, reason);
      break;
    default:
      return { message: `Status ${target} wordt niet ondersteund.` };
  }

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  revalidatePath(`/customers/${sub.customerId}`);
  return { ok: true };
}
