"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  saveInserveSettings,
  getInserveSettingsMasked,
  saveSimhuisSettings,
  getSimhuisSettingsMasked,
  saveNavixySettings,
  getNavixySettingsMasked,
} from "@/server/services/app-setting.service";
import { inserveClient } from "@/server/integrations/inserve/client";
import { simhuisClient } from "@/server/integrations/simhuis/client";
import { navixyClient } from "@/server/integrations/navixy/client";
import {
  InserveSettingsSchema,
  type InserveSettingsInput,
  SimhuisSettingsSchema,
  type SimhuisSettingsInput,
  NavixySettingsSchema,
  type NavixySettingsInput,
} from "@/server/validators/setting";
import type {
  InserveSettingsMasked,
  SimhuisSettingsMasked,
  NavixySettingsMasked,
} from "@/server/validators/setting";

export type InserveSettingsActionState = {
  errors?: Partial<Record<keyof InserveSettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

export type SimhuisSettingsActionState = {
  errors?: Partial<Record<keyof SimhuisSettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

export type NavixySettingsActionState = {
  errors?: Partial<Record<keyof NavixySettingsInput, string[]>>;
  message?: string | null;
  success?: boolean;
};

const formStr = (v: FormDataEntryValue | null): string =>
  typeof v === "string" ? v : "";

/* ========================= Inserve ========================= */

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
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}

/* ========================= Simhuis ========================= */

export async function getSimhuisSettingsAction(): Promise<SimhuisSettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) return null;
  return getSimhuisSettingsMasked();
}

export async function saveSimhuisSettingsAction(
  _prev: SimhuisSettingsActionState,
  formData: FormData
): Promise<SimhuisSettingsActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "setting");

  const data: SimhuisSettingsInput = {
    baseUrl: formStr(formData.get("baseUrl")),
    authMode: (formStr(formData.get("authMode")) as "basic" | "bearer") || "basic",
    username: formStr(formData.get("username")),
    password: formStr(formData.get("password")),
    resellerId: formStr(formData.get("resellerId")),
    endpointLogin: formStr(formData.get("endpointLogin")) || "/auth/login",
    endpointSims: formStr(formData.get("endpointSims")) || "/sims",
    endpointSimActivate: formStr(formData.get("endpointSimActivate")) || "/activate",
    endpointSimDeactivate: formStr(formData.get("endpointSimDeactivate")) || "/deactivate",
  };

  const validated = SimhuisSettingsSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as SimhuisSettingsActionState["errors"],
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    const ctx = { userId: user.id, userRole: user.role };
    await saveSimhuisSettings(validated.data, ctx);
    revalidatePath("/settings");
    return {
      success: true,
      message: "Simhuis API-instellingen zijn opgeslagen.",
    };
  } catch (err) {
    console.error("[settings] Failed to save Simhuis settings:", err);
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}

/* ========================= Navixy ========================= */

export async function getNavixySettingsAction(): Promise<NavixySettingsMasked | null> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) return null;
  return getNavixySettingsMasked();
}

export async function saveNavixySettingsAction(
  _prev: NavixySettingsActionState,
  formData: FormData
): Promise<NavixySettingsActionState> {
  const user = await getCurrentUser();
  requirePermission(user.role, "edit", "setting");

  const data: NavixySettingsInput = {
    baseUrl: formStr(formData.get("baseUrl")),
    authMode:
      (formStr(formData.get("authMode")) as "panel" | "user" | "direct") || "panel",
    panelLogin: formStr(formData.get("panelLogin")),
    panelPassword: formStr(formData.get("panelPassword")),
    userLogin: formStr(formData.get("userLogin")),
    userPassword: formStr(formData.get("userPassword")),
    directHash: formStr(formData.get("directHash")),
    createMethod:
      (formStr(formData.get("createMethod")) as "create" | "clone" | "register") ||
      "create",
    defaultUserId: formStr(formData.get("defaultUserId")),
    defaultTariffId: formStr(formData.get("defaultTariffId")),
    defaultCloneSourceTrackerId: formStr(formData.get("defaultCloneSourceTrackerId")),
    endpointPanelAuth:
      formStr(formData.get("endpointPanelAuth")) || "/panel/account/auth",
    endpointUserAuth:
      formStr(formData.get("endpointUserAuth")) || "/user/session/auth",
    endpointPanelTracker:
      formStr(formData.get("endpointPanelTracker")) || "/panel/tracker",
    endpointUserTracker:
      formStr(formData.get("endpointUserTracker")) || "/user/tracker",
  };

  const validated = NavixySettingsSchema.safeParse(data);
  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as NavixySettingsActionState["errors"],
      message: "Controleer de invoer.",
      success: false,
    };
  }

  try {
    const ctx = { userId: user.id, userRole: user.role };
    await saveNavixySettings(validated.data, ctx);
    revalidatePath("/settings");
    return {
      success: true,
      message: "Navixy API-instellingen zijn opgeslagen.",
    };
  } catch (err) {
    console.error("[settings] Failed to save Navixy settings:", err);
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden bij het opslaan van de instellingen.",
    };
  }
}

/* ========================= Smoke tests (connectivity) ========================= */

export interface ConnectionTestResult {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  endpoint?: string;
  message?: string;
}

export async function testInserveConnectionAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return { ok: false, error: "Onvoldoende rechten." };
  }
  const res = await inserveClient.testConnection();
  return {
    ...res,
    message: res.ok
      ? `Verbinding Inserve succesvol (${res.latencyMs}ms)`
      : res.error ?? "Verbinding Inserve mislukt.",
  };
}

export async function testSimhuisConnectionAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return { ok: false, error: "Onvoldoende rechten." };
  }
  const res = await simhuisClient.testConnection();
  return {
    ...res,
    message: res.ok
      ? `Verbinding Simhuis succesvol (${res.latencyMs}ms)`
      : res.error ?? "Verbinding Simhuis mislukt.",
  };
}

export async function testNavixyConnectionAction(): Promise<ConnectionTestResult> {
  const user = await getCurrentUser();
  if (!canUserRole(user.role, "view", "setting")) {
    return { ok: false, error: "Onvoldoende rechten." };
  }
  const res = await navixyClient.testConnection();
  return {
    ...res,
    message: res.ok
      ? `Verbinding Navixy succesvol (${res.latencyMs}ms)`
      : res.error ?? "Verbinding Navixy mislukt.",
  };
}
