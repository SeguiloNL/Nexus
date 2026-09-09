import { auth } from "@/auth";
import { findManyActivationOrders } from "@/server/services/activation-order.service";
import { ActivationOrderList } from "./_components/activation-list";
import { canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/rbac";

export default async function ActivationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "activation_order")) {
    throw new PermissionError("Je mag geen activatie orders bekijken.");
  }

  const result = await findManyActivationOrders({
    page: 1,
    perPage: 500,
  });

  return (
    <ActivationOrderList
      orders={result.data as any}
      canCreate={canUserRole(session.user.role, "create", "activation_order")}
      canEdit={canUserRole(session.user.role, "edit", "activation_order")}
      canDelete={canUserRole(session.user.role, "delete", "activation_order")}
    />
  );
}
