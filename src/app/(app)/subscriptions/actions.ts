"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateSubscriptionSchema,
  UpdateSubscriptionStatusSchema,
  type CreateSubscriptionInput,
} from "@/server/validators/subscription";
import {
  createSubscription,
  updateSubscriptionStatus,
  softDeleteSubscription,
  suspendSubscription,
  resumeSubscription,
  cancelSubscription,
  terminateSubscription,
} from "@/server/services/subscription.service";
import type { SubscriptionStatus } from "@/types/enums";
import { replaceSim, replaceTracker, unassignSim, unassignTracker } from "@/server/services/assignments.service";
import type { SimStatus, TrackerStatus } from "@prisma/client";

export type SubActionState = {
  errors?: Partial<Record<keyof CreateSubscriptionInput, string[]>>;
  message?: string | null;
  subscriptionId?: string;
};

export async function createSubscriptionAction(
  _prev: SubActionState,
  formData: FormData
): Promise<SubActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "subscription");

  const raw: any = {
    customerId: formData.get("customerId") || undefined,
    productId: formData.get("productId") || undefined,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || null,
    monthlyPrice: formData.get("monthlyPrice") || 0,
    billingCycle: formData.get("billingCycle") || undefined,
    notes: formData.get("notes") || null,
  };

  const validated = CreateSubscriptionSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as SubActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const sub = await createSubscription(validated.data, ctx);

  revalidatePath("/subscriptions");
  redirect(`/subscriptions/${sub.id}`);
}

export async function updateSubscriptionStatusAction(
  subscriptionId: string,
  _prev: any,
  formData: FormData
) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const raw = {
    status: formData.get("status") as SubscriptionStatus,
    reason: formData.get("reason") || undefined,
  };

  const validated = UpdateSubscriptionStatusSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  await updateSubscriptionStatus(subscriptionId, validated.data, ctx);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  revalidatePath("/subscriptions");
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function suspendSubscriptionAction(subscriptionId: string, _prev: any, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const reason = (formData.get("reason") as string) || undefined;
  const ctx = { userId: user.id, userRole: user.role };
  await suspendSubscription(subscriptionId, ctx, reason);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function resumeSubscriptionAction(subscriptionId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const ctx = { userId: user.id, userRole: user.role };
  await resumeSubscription(subscriptionId, ctx);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function cancelSubscriptionAction(subscriptionId: string, _prev: any, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "subscription");
  const reason = (formData.get("reason") as string) || undefined;
  const ctx = { userId: user.id, userRole: user.role };
  await cancelSubscription(subscriptionId, ctx, reason);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function terminateSubscriptionAction(subscriptionId: string, _prev: any, formData: FormData) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "subscription");
  const reason = (formData.get("reason") as string) || undefined;
  const ctx = { userId: user.id, userRole: user.role };
  await terminateSubscription(subscriptionId, ctx, reason);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function deleteSubscriptionAction(subscriptionId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "subscription");
  const ctx = { userId: user.id, userRole: user.role };
  await softDeleteSubscription(subscriptionId, ctx);
  revalidatePath("/subscriptions");
  redirect("/subscriptions");
}

export async function unassignTrackerAction(subscriptionId: string, trackerId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const ctx = { userId: user.id, userRole: user.role };
  await unassignTracker(trackerId, ctx);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function unassignSimAction(subscriptionId: string, simId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const ctx = { userId: user.id, userRole: user.role };
  await unassignSim(simId, ctx);
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function replaceTrackerAction(
  subscriptionId: string,
  _prev: any,
  formData: FormData
) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const oldTrackerId = formData.get("oldTrackerId") as string;
  const newTrackerId = formData.get("newTrackerId") as string;
  const oldDisposition = (formData.get("oldTrackerStatus") as TrackerStatus) || "IN_STOCK" as const;
  const reason = (formData.get("reason") as any) || "REPLACEMENT";
  const ctx = { userId: user.id, userRole: user.role };
  await replaceTracker(
    subscriptionId,
    oldTrackerId,
    newTrackerId,
    oldDisposition,
    ctx,
    reason
  );
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}

export async function replaceSimAction(
  subscriptionId: string,
  _prev: any,
  formData: FormData
) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");
  const oldSimId = formData.get("oldSimId") as string;
  const newSimId = formData.get("newSimId") as string;
  const oldDisposition = (formData.get("oldSimStatus") as SimStatus) || "IN_STOCK" as const;
  const reason = (formData.get("reason") as any) || "REPLACEMENT";
  const ctx = { userId: user.id, userRole: user.role };
  await replaceSim(
    subscriptionId,
    oldSimId,
    newSimId,
    oldDisposition,
    ctx,
    reason
  );
  revalidatePath(`/subscriptions/${subscriptionId}`);
  redirect(`/subscriptions/${subscriptionId}`);
}
