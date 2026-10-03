import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { findActivationOrderById } from "@/server/services/activation-order.service";
import { ActivationOrderDetail } from "../_components/activation-detail";
import {
  markReadyAction,
  cancelOrderAction,
  retryFailedAction,
  completeActivationAction,
  deleteOrderAction,
} from "../actions";

export default async function ActivationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { action?: string };
}) {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "activation_order")) {
    redirectForbidden();
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
      role={user.role}
      markReadyAction={markReadyAction as any}
      cancelAction={cancelOrderAction as any}
      retryAction={retryFailedAction as any}
      completeAction={completeActivationAction as any}
      deleteAction={deleteOrderAction as any}
      actionError={actionError}
    />
  );
}
