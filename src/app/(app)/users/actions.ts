"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateUserSchema,
  UpdateUserSchema,
  UpdateUserCustomersSchema,
  ToggleUserActiveSchema,
  BulkUpdateRoleSchema,
} from "@/server/validators/user";
import {
  createUser,
  updateUser,
  deleteUser,
  updateUserCustomerLinks,
  toggleUserActive,
  bulkUpdateUserRole,
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

export async function updateUserCustomersAction(
  userId: string,
  customerIds: string[]
): Promise<{ ok: boolean; message?: string; linked?: string[]; unlinked?: string[] }> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "edit",
    "user"
  );

  const validated = UpdateUserCustomersSchema.safeParse({ customerIds });
  if (!validated.success) {
    return { ok: false, message: "Ongeldige klantselectie." };
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
    const result = await updateUserCustomerLinks(userId, validated.data.customerIds, ctx);
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true, ...result };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Kon klantkoppelingen niet bijwerken." };
  }
}

export async function toggleUserActiveAction(
  userId: string,
  isActive: boolean
): Promise<{ ok: boolean; message?: string }> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "edit",
    "user"
  );

  const validated = ToggleUserActiveSchema.safeParse({ isActive });
  if (!validated.success) {
    return { ok: false, message: "Ongeldige status." };
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
    await toggleUserActive(userId, validated.data.isActive, ctx);
    revalidatePath(`/users/${userId}`);
    revalidatePath("/users");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Kon gebruikerstatus niet bijwerken." };
  }
}

export async function bulkUpdateRoleAction(
  userIds: string[],
  roleId: string
): Promise<{ ok: boolean; message?: string; updated?: number }> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "edit",
    "user"
  );

  const validated = BulkUpdateRoleSchema.safeParse({ userIds, roleId });
  if (!validated.success) {
    return { ok: false, message: "Ongeldige invoer voor bulk-wijziging." };
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
    const { updated } = await bulkUpdateUserRole(
      validated.data.userIds,
      validated.data.roleId,
      ctx
    );
    revalidatePath("/users");
    return { ok: true, updated };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Kon rollen niet bulk-wijzigen." };
  }
}
