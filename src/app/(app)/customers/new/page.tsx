import { requireUser, canUserRole } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { listParentCustomers } from "@/server/services/customer.service";
import { CustomerForm } from "../_components/customer-form";
import { createCustomerAction } from "../actions";
import { PermissionError } from "@/lib/rbac";

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (!canUserRole(user.permissions, "create", "customer")) {
    throw new PermissionError("Je mag geen klanten aanmaken.");
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
