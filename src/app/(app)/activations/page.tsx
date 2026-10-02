import { requireUser, canUserRole } from "@/lib/auth/session";
import { findManyActivationOrders } from "@/server/services/activation-order.service";
import { ActivationOrderList } from "./_components/activation-list";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function ActivationsPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "view", "activation_order")) {
    throw new PermissionError("Je mag geen activatie orders bekijken.");
  }

  const result = await findManyActivationOrders({
    page: 1,
    perPage: 500,
    customerScope: user.customerIds,
  });

  return (
    <ActivationOrderList
      orders={result.data as any}
      canCreate={canUserRole(user.permissions, "create", "activation_order")}
      canEdit={canUserRole(user.permissions, "edit", "activation_order")}
      canDelete={canUserRole(user.permissions, "delete", "activation_order")}
    />
  );
}
