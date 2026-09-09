"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
} from "@/server/validators/customer";
import {
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "@/server/services/customer.service";

export type CustomerActionState = {
  errors?: Partial<Record<keyof CreateCustomerInput, string[]>>;
  message?: string | null;
  customerId?: string;
};

export async function createCustomerAction(
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "create", "customer");

  const data = {
    customerNumber: formData.get("customerNumber") || undefined,
    companyName: formData.get("companyName"),
    parentCustomerId: formData.get("parentCustomerId") || null,
    address: formData.get("address") || null,
    postalCode: formData.get("postalCode") || null,
    city: formData.get("city") || null,
    country: formData.get("country") || null,
    contactPerson: formData.get("contactPerson") || null,
    phone: formData.get("phone") || null,
    email: formData.get("email") || null,
    status: (formData.get("status") as CreateCustomerInput["status"]) ??
      undefined,
    notes: formData.get("notes") || null,
  };

  if (data.parentCustomerId === "none" || data.parentCustomerId === "") {
    data.parentCustomerId = null;
  }

  const validated = CreateCustomerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as CustomerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  const customer = await createCustomer(validated.data, ctx);

  revalidatePath("/customers");
  redirect(`/customers/${customer.id}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: CustomerActionState,
  formData: FormData
): Promise<CustomerActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "customer");

  const data: {
    companyName?: string;
    parentCustomerId?: string | null;
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    status?: CreateCustomerInput["status"];
    notes?: string | null;
  } = {
    companyName: (formData.get("companyName") as string) || undefined,
    parentCustomerId: (formData.get("parentCustomerId") as string) ?? null,
    address: (formData.get("address") as string) ?? null,
    postalCode: (formData.get("postalCode") as string) ?? null,
    city: (formData.get("city") as string) ?? null,
    country: (formData.get("country") as string) ?? null,
    contactPerson: (formData.get("contactPerson") as string) ?? null,
    phone: (formData.get("phone") as string) ?? null,
    email: (formData.get("email") as string) ?? null,
    status: (formData.get("status") as CreateCustomerInput["status"]) ??
      undefined,
    notes: (formData.get("notes") as string) ?? null,
  };

  if (data.parentCustomerId === "none" || data.parentCustomerId === "") {
    data.parentCustomerId = null;
  }

  const validated = UpdateCustomerSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten()
        .fieldErrors as CustomerActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = { userId: user.id, userRole: user.role };
  await updateCustomer(customerId, validated.data, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

export async function deleteCustomerAction(customerId: string) {
  const user = await getCurrentUser();
  requirePermission(user.role, "delete", "customer");

  const ctx = { userId: user.id, userRole: user.role };
  await softDeleteCustomer(customerId, ctx);

  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect("/customers");
}
