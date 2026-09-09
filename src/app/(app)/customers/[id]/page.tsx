import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import {
  findCustomerById,
  listParentCustomers,
} from "@/server/services/customer.service";
import { CustomerDetail } from "../_components/customer-detail";
import { canUserRole } from "@/lib/auth/session";
import { PermissionError } from "@/lib/rbac";
import {
  deleteCustomerAction,
  updateCustomerAction,
} from "../actions";

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUserRole(session.user.role, "view", "customer")) {
    throw new PermissionError("Je mag geen klanten bekijken.");
  }

  const [customer, parentOptions] = await Promise.all([
    findCustomerById(params.id),
    listParentCustomers(),
  ]);

  if (!customer) notFound();

  const deleteAction: any = deleteCustomerAction.bind(null, params.id);
  const updateAction: any = async (
    prev: any,
    formData: FormData
  ) => updateCustomerAction(params.id, prev, formData);

  return (
    <CustomerDetail
      customer={customer as any}
      parentOptions={parentOptions}
      role={session.user.role}
      updateAction={updateAction}
      deleteAction={deleteAction}
      customerId={params.id}
    />
  );
}
