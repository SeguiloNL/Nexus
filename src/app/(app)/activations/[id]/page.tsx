import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { findActivationOrderById } from "@/server/services/activation-order.service";
import { ActivationOrderDetail } from "../_components/activation-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import {
  markReadyAction,
  cancelOrderAction,
  retryFailedAction,
  completeActivationAction,
} from "../actions";

export default async function ActivationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { action?: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "activation_order")) {
    throw new PermissionError("Je mag geen activatie orders bekijken.");
  }

  const raw = await findActivationOrderById(params.id);
  if (!raw) notFound();

  const order: any = {
    ...raw,
    monthlyPrice: Number(raw.monthlyPrice),
    subscription: raw.subscription
      ? { ...raw.subscription, monthlyPrice: Number(raw.subscription.monthlyPrice) }
      : null,
  };

  let actionError: string | null = null;
  if (searchParams?.action === "cancel") {
    actionError = null;
  }

  return (
    <ActivationOrderDetail
      order={order}
      role={session.user.role}
      markReadyAction={markReadyAction as any}
      cancelAction={cancelOrderAction as any}
      retryAction={retryFailedAction as any}
      completeAction={completeActivationAction as any}
      actionError={actionError}
    />
  );
}
