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
  AssignTrackerSchema,
  UnassignTrackerSchema,
  ReplaceTrackerSchema,
  AssignSimSchema,
  UnassignSimSchema,
  ReplaceSimSchema,
} from "@/server/validators/assignment";
import {
  createSubscription,
  updateSubscription,
  suspendSubscription,
  resumeSubscription,
  cancelSubscription,
  terminateSubscription,
} from "@/server/services/subscription.service";
import {
  assignTracker,
  unassignTracker,
  replaceTracker,
  assignSim,
  unassignSim,
  replaceSim,
} from "@/server/services/assignment.service";
import type { AssignTrackerInput } from "@/types/domain";

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

export type AssignmentActionState = {
  errors?: Record<string, string[] | undefined>;
  message?: string | null;
  ok?: boolean;
};

export async function assignTrackerAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    subscriptionId: formData.get("subscriptionId") || undefined,
    trackerId: formData.get("trackerId") || undefined,
    vehicleId: formData.get("vehicleId") || null,
  };

  const validated = AssignTrackerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await assignTracker(validated.data as AssignTrackerInput, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  const sid = validated.data.subscriptionId;
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${sid}`);
  return { ok: true, message: "Tracker toegewezen." };
}

export async function unassignTrackerAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    trackerId: formData.get("trackerId") || undefined,
    newTrackerStatus: formData.get("newTrackerStatus") || undefined,
  };

  const validated = UnassignTrackerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await unassignTracker(validated.data as any, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  revalidatePath("/subscriptions");
  const sid = formData.get("subscriptionId");
  if (sid && typeof sid === "string") {
    revalidatePath(`/subscriptions/${sid}`);
  }
  return { ok: true, message: "Tracker ontkoppeld." };
}

export async function replaceTrackerAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    subscriptionId: formData.get("subscriptionId") || undefined,
    oldTrackerId: formData.get("oldTrackerId") || undefined,
    newTrackerId: formData.get("newTrackerId") || undefined,
    oldTrackerDisposition: formData.get("oldTrackerDisposition") || undefined,
    reason: formData.get("reason") || null,
  };

  const validated = ReplaceTrackerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await replaceTracker(validated.data as any, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  const sid = validated.data.subscriptionId;
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${sid}`);
  return { ok: true, message: "Tracker vervangen." };
}

export async function assignSimAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    subscriptionId: formData.get("subscriptionId") || undefined,
    simId: formData.get("simId") || undefined,
  };

  const validated = AssignSimSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await assignSim(validated.data as any, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  const sid = validated.data.subscriptionId;
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${sid}`);
  return { ok: true, message: "SIM toegewezen." };
}

export async function unassignSimAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    simId: formData.get("simId") || undefined,
    newSimStatus: formData.get("newSimStatus") || undefined,
  };

  const validated = UnassignSimSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await unassignSim(validated.data as any, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  revalidatePath("/subscriptions");
  const sid = formData.get("subscriptionId");
  if (sid && typeof sid === "string") {
    revalidatePath(`/subscriptions/${sid}`);
  }
  return { ok: true, message: "SIM ontkoppeld." };
}

export async function replaceSimAction(
  _prev: AssignmentActionState | undefined,
  formData: FormData
): Promise<AssignmentActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const data = {
    subscriptionId: formData.get("subscriptionId") || undefined,
    oldSimId: formData.get("oldSimId") || undefined,
    newSimId: formData.get("newSimId") || undefined,
    oldSimDisposition: formData.get("oldSimDisposition") || undefined,
    reason: formData.get("reason") || null,
  };

  const validated = ReplaceSimSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors,
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  try {
    await replaceSim(validated.data as any, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Onbekende fout";
    return { message: msg };
  }

  const sid = validated.data.subscriptionId;
  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${sid}`);
  return { ok: true, message: "SIM vervangen." };
}
