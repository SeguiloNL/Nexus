"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  saveInserveSettings,
  getInserveSettingsMasked,
} from "@/server/services/app-setting.service";
import { InserveSettingsSchema, type InserveSettingsInput } from "@/server/validators/setting";
import type { InserveSettingsMasked } from "@/server/validators/setting";

export type InserveSettingsActionState = {
  errors?: Partial<Record<keyof InserveSettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

export async function getInserveSettingsAction(): Promise<InserveSettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return null;
  }
  return getInserveSettingsMasked();
}

export async function saveInserveSettingsAction(
  _prev: InserveSettingsActionState,
  formData: FormData
): Promise<InserveSettingsActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "setting");

  const rawSubdomain = formData.get("subdomain");
  const rawApiKey = formData.get("apiKey");

  const data: InserveSettingsInput = {
    subdomain: typeof rawSubdomain === "string" ? rawSubdomain : "",
    apiKey: typeof rawApiKey === "string" ? rawApiKey : "",
  };

  const validated = InserveSettingsSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as InserveSettingsActionState["errors"],
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    const ctx = { userId: user.id, userRole: user.role };
    await saveInserveSettings(validated.data, ctx);
    revalidatePath("/settings");
    return {
      success: true,
      message: "Inserve API-instellingen zijn opgeslagen.",
    };
  } catch (err) {
    console.error("[settings] Failed to save Inserve settings:", err);
    return {
      success: false,
      message: "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}
