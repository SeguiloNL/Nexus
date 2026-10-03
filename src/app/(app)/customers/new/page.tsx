import { requireUser, canUserRole, redirectForbidden } from "@/lib/auth/session";
import { listParentCustomers } from "@/server/services/customer.service";
import { CustomerForm } from "../_components/customer-form";
import { createCustomerAction } from "../actions";

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "customer")) {
    redirectForbidden();
  }

  const parentOptions = await listParentCustomers();

  return (
    <CustomerForm
      mode="create"
      parentOptions={parentOptions}
      action={createCustomerAction as any}
    />
  );
}
