"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateUserSchema,
  UpdateUserSchema,
} from "@/server/validators/user";
import {
  createUser,
  updateUser,
  deleteUser,
} from "@/server/services/user.service";

export type UserActionState = {
  errors?: Partial<Record<string, string[] | undefined>> & {
    generic?: string[];
  };
  message?: string | null;
  userId?: string;
};

export async function createUserAction(
  _prev: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "create",
    "user"
  );

  const raw: any = {
    email: formData.get("email") || undefined,
    name: formData.get("name") || undefined,
    password: formData.get("password") || undefined,
    roleId: formData.get("roleId") || undefined,
    role: formData.get("role") || undefined,
    customerId: formData.get("customerId") || null,
  };

  const validated = CreateUserSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as UserActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    permissions: user.permissions,
    customerScope: user.customerIds,
  };
  try {
    const created = await createUser(validated.data, ctx);
    revalidatePath("/users");
    return { userId: created.id, message: null };
  } catch (e: any) {
    return { message: e?.message ?? "Kon gebruiker niet aanmaken." };
  }
}

export async function updateUserAction(
  userId: string,
  _prev: UserActionState,
  formData: FormData
): Promise<UserActionState> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "edit",
    "user"
  );

  const raw: any = {
    email: formData.get("email") || undefined,
    name: formData.get("name") || undefined,
    password: formData.get("password") || "",
    roleId: formData.get("roleId") || undefined,
    role: formData.get("role") || undefined,
    customerId: formData.get("customerId") ?? undefined,
  };

  const validated = UpdateUserSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as UserActionState["errors"],
      message: "Controleer de invoer.",
    };
  }

  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    permissions: user.permissions,
    customerScope: user.customerIds,
  };
  try {
    await updateUser(userId, validated.data, ctx);
    revalidatePath("/users");
    return { message: null };
  } catch (e: any) {
    return { message: e?.message ?? "Kon gebruiker niet bijwerken." };
  }
}

export async function deleteUserAction(userId: string) {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "delete",
    "user"
  );
  const ctx = {
    userId: user.id,
    userRole: user.role,
    roleId: user.roleId,
    roleScope: user.roleScope,
    permissions: user.permissions,
    customerScope: user.customerIds,
  };
  try {
    await deleteUser(userId, ctx);
  } catch (e: any) {
    const msg = encodeURIComponent(e?.message ?? "Onbekende fout.");
    redirect(`/users?error=${msg}`);
  }
  revalidatePath("/users");
  redirect("/users");
}
