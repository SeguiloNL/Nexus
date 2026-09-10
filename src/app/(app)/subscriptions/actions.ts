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
import {
  generateMonthly,
  markInvoicePaid,
  updateInvoiceStatus,
  softDeleteInvoice,
} from "@/server/services/invoice.service";
import type { InvoiceStatus, SubscriptionStatus } from "@/types/enums";
import { replaceSim, replaceTracker, unassignSim, unassignTracker } from "@/server/services/assignments.service";
import { syncSubscriptionToInserve } from "@/server/services/inserve-sync.service";
import type { SimStatus, TrackerStatus } from "@prisma/client";

export type InserveSyncState = {
  ok: boolean;
  message?: string | null;
  error?: string | null;
  status?: string | null;
};

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
  const statusInput = {
    status: validated.data.status,
    ...(validated.data.reason != null ? { reason: validated.data.reason } : {}),
  };
  await updateSubscriptionStatus(subscriptionId, statusInput as any, ctx);
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

export async function syncSubscriptionToInserveAction(
  subscriptionId: string
): Promise<InserveSyncState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "subscription");

  const ctx = { userId: user.id, userRole: user.role };
  const result = await syncSubscriptionToInserve(subscriptionId, ctx);

  revalidatePath(`/subscriptions/${subscriptionId}`);
  revalidatePath("/subscriptions");

  if (result.status === "SYNCED") {
    return {
      ok: true,
      status: "SYNCED",
      message:
        result.details ??
        "Abonnement succesvol gesynchroniseerd met Inserve.",
    };
  }
  if (result.status === "SKIPPED") {
    return {
      ok: true,
      status: "SKIPPED",
      message: result.details ?? "Sync overgeslagen (geen actie nodig).",
    };
  }
  return {
    ok: false,
    status: "FAILED",
    error: result.error ?? "Onbekende fout bij synchronisatie met Inserve.",
  };
}

export type GenerateInvoicesState = {
  ok?: boolean;
  message?: string | null;
  error?: string | null;
  periodStart?: string;
  periodEnd?: string;
  created?: number;
  skipped?: number;
  failed?: number;
  errors?: Array<{ subscriptionId: string; subscriptionNumber?: string; error: string }>;
};

export async function generateMonthlyInvoicesAction(
  _prev: GenerateInvoicesState,
  formData: FormData
): Promise<GenerateInvoicesState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "invoice");

  const yearRaw = formData.get("year");
  const monthRaw = formData.get("month");
  const year = yearRaw ? parseInt(String(yearRaw), 10) : new Date().getFullYear();
  const month = monthRaw ? parseInt(String(monthRaw), 10) : new Date().getMonth() + 1;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, error: `Ongeldig jaar: ${year}` };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: `Ongeldige maand: ${month}` };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const result = await generateMonthly(year, month, ctx);

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions`, "layout");

  if (result.failed > 0) {
    return {
      ok: false,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
      error: `${result.failed} factuur(ren) konden niet gegenereerd worden.`,
      message: `Facturatie ${result.periodStart} → ${result.periodEnd}: ${result.created} aangemaakt, ${result.skipped} overgeslagen, ${result.failed} gefaald.`,
    };
  }

  return {
    ok: true,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    message: `Facturatie ${result.periodStart} → ${result.periodEnd} succesvol: ${result.created} aangemaakt, ${result.skipped} overgeslagen.`,
  };
}

export async function markInvoicePaidAction(invoiceId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "invoice");
  const ctx = { userId: user.id, userRole: user.role };
  const inv = await markInvoicePaid(invoiceId, ctx);
  revalidatePath(`/subscriptions/${inv.subscriptionId}`);
  revalidatePath("/subscriptions");
}

export async function updateInvoiceStatusAction(
  invoiceId: string,
  _prev: any,
  formData: FormData
) {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "invoice");
  const status = formData.get("status") as InvoiceStatus;
  const note = (formData.get("note") as string) || undefined;
  const ctx = { userId: user.id, userRole: user.role };
  const inv = await updateInvoiceStatus(invoiceId, status, ctx, note);
  revalidatePath(`/subscriptions/${inv.subscriptionId}`);
  revalidatePath("/subscriptions");
  redirect(`/subscriptions/${inv.subscriptionId}`);
}

export async function deleteInvoiceAction(invoiceId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "invoice");
  const ctx = { userId: user.id, userRole: user.role };
  const inv = await softDeleteInvoice(invoiceId, ctx);
  revalidatePath(`/subscriptions/${inv.subscriptionId}`);
  revalidatePath("/subscriptions");
  redirect(`/subscriptions/${inv.subscriptionId}`);
}
