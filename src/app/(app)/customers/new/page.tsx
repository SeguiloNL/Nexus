import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listParentCustomers } from "@/server/services/customer.service";
import { CustomerForm } from "../_components/customer-form";
import { createCustomerAction } from "../actions";
import { PermissionError } from "@/lib/rbac";
import { canUserRole } from "@/lib/auth/session";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "create", "customer")) {
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
