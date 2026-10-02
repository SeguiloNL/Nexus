"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  CreateRoleSchema,
  UpdateRoleSchema,
  CloneRoleSchema,
} from "@/server/validators/role";
import {
  createRoleWithPermissions as createRole,
  updateRoleWithPermissions as updateRole,
  deleteRoleIfNotSystem as deleteRole,
  cloneRole,
} from "@/server/services/role.service";
import { RoleScope } from "@/types/enums";

export type RoleActionState = {
  errors?: Partial<Record<string, string[] | undefined>> & {
    generic?: string[];
  };
  message?: string | null;
  roleId?: string;
};

export async function createRoleAction(
  _prev: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "create",
    "role"
  );

  const permissions: Record<string, "NONE" | "READ" | "WRITE"> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("perm_")) {
      const resource = key.slice(5);
      const level = value as "NONE" | "READ" | "WRITE";
      if (["NONE", "READ", "WRITE"].includes(level)) {
        permissions[resource] = level;
      }
    }
  }

  const raw: any = {
    name: formData.get("name") || undefined,
    scope: (formData.get("scope") as any) || undefined,
    description: formData.get("description") || null,
    permissions,
  };

  const validated = CreateRoleSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as RoleActionState["errors"],
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
    const created = await createRole(validated.data as any, ctx);
    revalidatePath("/roles");
    return { roleId: created.id, message: null };
  } catch (e: any) {
    return { message: e?.message ?? "Kon rol niet aanmaken." };
  }
}

export async function updateRoleAction(
  roleId: string,
  _prev: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "edit",
    "role"
  );

  const permissions: Record<string, "NONE" | "READ" | "WRITE"> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("perm_")) {
      const resource = key.slice(5);
      const level = value as "NONE" | "READ" | "WRITE";
      if (["NONE", "READ", "WRITE"].includes(level)) {
        permissions[resource] = level;
      }
    }
  }

  const raw: any = {
    name: formData.get("name") || undefined,
    description: formData.get("description") ?? undefined,
    permissions: Object.keys(permissions).length > 0 ? permissions : undefined,
  };

  const validated = UpdateRoleSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as RoleActionState["errors"],
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
    await updateRole(roleId, validated.data as any, ctx);
    revalidatePath("/roles");
    return { roleId, message: null };
  } catch (e: any) {
    return { message: e?.message ?? "Kon rol niet bijwerken." };
  }
}

export async function deleteRoleAction(roleId: string) {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "delete",
    "role"
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
    await deleteRole(roleId, ctx);
  } catch (e: any) {
    const msg = encodeURIComponent(e?.message ?? "Onbekende fout.");
    redirect(`/roles?error=${msg}`);
  }
  revalidatePath("/roles");
  redirect("/roles");
}

export async function cloneRoleAction(
  sourceRoleId: string,
  _prev: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  const user = await getCurrentUser();
  await requirePermission(
    user.permissions ?? user.roleId ?? user.role,
    "create",
    "role"
  );

  const raw: any = {
    sourceRoleId,
    name: formData.get("name") || undefined,
    scope: (formData.get("scope") as any) || undefined,
    description: formData.get("description") ?? null,
  };

  const validated = CloneRoleSchema.safeParse(raw);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as RoleActionState["errors"],
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
    const created = await cloneRole(sourceRoleId, validated.data as any, ctx);
    revalidatePath("/roles");
    revalidatePath(`/roles/${created.id}`);
    return { roleId: created.id, message: null };
  } catch (e: any) {
    return { message: e?.message ?? "Kon rol niet klonen." };
  }
}
