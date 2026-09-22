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
  syncAvailableSimsFromSimhuis,
  type SimhuisSyncResult,
} from "@/server/services/simhuis-sim-sync.service";

async function getSimhuisCredentialsForWafDebug() {
  try {
    const anyClient = await simhuisClient.getClient();
    if (!anyClient) return null;
    return (anyClient as unknown as {
      creds: {
        baseUrl: string;
        username: string;
        password: string;
        resellerId?: string | null;
      };
    }).creds;
  } catch {
    return null;
  }
}
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
    defaultOfferId: formStr(formData.get("defaultOfferId")),
    defaultPlanId: formStr(formData.get("defaultPlanId")),
    defaultProductName: formStr(formData.get("defaultProductName")),
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

/* ========================= Simhuis SIM-voorraad sync ========================= */

export interface SimSyncActionResult {
  ok: boolean;
  message: string;
  totalInSimhuis?: number;
  eligibleInSimhuis?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  errorMessages?: string[];
  durationMs?: number;
  debugContext?: {
    wafBlocked: boolean;
    wafSteps: string[];
    wafCurlTest?: string;
    wafCurlOnNexusServer?: string;
    wafEmailTemplate?: string;
  };
}

export async function syncSimhuisSimsAction(): Promise<SimSyncActionResult> {
  try {
    const user = await getCurrentUser();
    requirePermission(user.role, "edit", "sim");
    const r = await syncAvailableSimsFromSimhuis({ userId: user.id, userRole: user.role });
    const ok = r.totalInSimhuis === 0
      ? false
      : (r.errors < r.eligibleInSimhuis || r.created > 0 || r.updated > 0);
    const summary =
      r.totalInSimhuis === 0
        ? `Geen SIMs gevonden in Simhuis (list endpoint vond geen records). Controleer of jouw account SIM-inventaris heeft, of lees de foutmelding in de server logs. Totaal: ${r.totalInSimhuis}, Gekwalificeerd: ${r.eligibleInSimhuis}. Duur: ${r.durationMs}ms.`
        : `SIM-voorraad bijgewerkt. Aangemaakt: ${r.created}, bijgewerkt: ${r.updated}, overgeslagen: ${r.skipped}. ` +
          `Totaal in Simhuis: ${r.totalInSimhuis}, in aanmerking genomen: ${r.eligibleInSimhuis}. ` +
          `Fouten: ${r.errors}. Duur: ${r.durationMs}ms.`;
    revalidatePath("/sims");
    revalidatePath("/settings");
    return {
      ok,
      message: summary,
      ...r,
    };
  } catch (err) {
    console.error("[settings] Failed to sync Simhuis SIMs:", err);
    const rawMsg = err instanceof Error ? err.message : String(err ?? "Onbekende fout");
    const wafBlocked = /Allow\s*:\s*OPTIONS/.test(rawMsg) || /WAF|Web Application Firewall|IP.?whitelist|whitelisting/.test(rawMsg);
    let debugContext: SimSyncActionResult["debugContext"] | undefined;
    if (wafBlocked) {
      try {
        const cfg = await getSimhuisCredentialsForWafDebug();
        const username = cfg?.username || process.env.SIMHUIS_USERNAME || "<JOUW_SIMHUIS_USERNAME>";
        const password = cfg?.password || process.env.SIMHUIS_PASSWORD || "<JOUW_SIMHUIS_PASSWORD>";
        const base = (cfg?.baseUrl || process.env.SIMHUIS_BASE_URL || "https://apicontrolcenter.com/v3").replace(/\/+$/, "");
        const basicB64 = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
        const publicIpCmd = "# Bepaal jouw Nexus server PUBLIC IP (geef dit IP op aan Simhuis Support):\ncurl -sS ifconfig.me";
        const curlCmd =
          `# STAP 1 (JOUW computer / Postman): draai dit commando in jouw lokale terminal (post je uitkomst hier als het werkt)\n` +
          `curl -sS -X POST '${base}/sims' \\\n` +
          `  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' \\\n` +
          `  -H 'Accept: application/json' \\\n` +
          `  -H 'Origin: ${base.replace(/\/[^/]*$/, "")}' \\\n` +
          `  -H 'Referer: ${base.replace(/\/[^/]*$/, "")}/' \\\n` +
          `  -H 'Authorization: Basic ${basicB64}' \\\n` +
          `  -H 'Content-Type: application/json' \\\n` +
          `  --data-raw '{"page":1,"limit":100}'`;
        const serverCurl =
          `# STAP 2 (NEXUS SERVER): log IN op de server waar Nexus draait, en voer daar HETZELFDE commando uit:\n` +
          `# (Als dit "405 MethodNotAllowed" geeft, en STAP 1 gaf WEL 200/401/400 → IP WHITELISTING = de oorzaak)\n\n` +
          publicIpCmd + "\n\n" + curlCmd;
        const emailTmpl =
          `Onderwerp: Whitelist verzoek API SIM-voorraad sync - [JOUW BEDRIJF]\n` +
          `\nGeachte heer/mevrouw Simhuis Support,\n\n` +
          `Wij gebruiken jullie Control Center API (endpoint ${base}) voor het automatisch synchroniseren van onze SIM-voorraad vanuit ons Nexus-platform.\n\n` +
          `Probleem: API calls vanaf onze Nexus-server krijgen consequent "HTTP 405 Allow: OPTIONS" (method not allowed) op alle endpoints. Dezelfde calls VANAF ONZE WERKPLEK (met Postman / curl naar hetzelfde endpoint, met dezelfde credentials) werken WEL en geven een app-level response (bv. 401 InvalidCredentials of 200 met data).\n\n` +
          `Dit wijst erop dat jullie WAF / firewall ons SERVER-IP blokkeert.\n\n` +
          `Verzoek: Whitelist het volgende PUBLIC IP-adres van onze Nexus-server (zowel inbound als outbound, poorten 80/443):\n` +
          `  [Plak hier de uitvoer van: curl -sS ifconfig.me  - uitgevoerd OP DE NEXUS SERVER]\n\n` +
          `Onze credentials / account naam: ${username}\n` +
          `Base URL: ${base}\n\n` +
          `Alvast bedankt!\n\n` +
          `Met vriendelijke groet,\n` +
          `[JOUW NAAM] • [JOUW FUNCTIE] • [JOUW BEDRIJF]`;
        debugContext = {
          wafBlocked: true,
          wafSteps: [
            "STAP 1: Kopieer het curl-commando (STAP 1) en voer het UIT OP JE EIGEN COMPUTER (lokaal). Noteer of je een 200/401/400-body terugkrijgt.",
            "STAP 2: Log IN op de server waar Nexus draait, en voer HETZELFDE curl-commando DAAR UIT. Je PUBLIC IP van die server staat ook in STAP 2.",
            "STAP 3: Als STAP 1 WEL werkt en STAP 2 geeft 405 Allow: OPTIONS → e-mail Simhuis Support met de template om dit IP te whitelisten.",
          ],
          wafCurlTest: curlCmd,
          wafCurlOnNexusServer: serverCurl,
          wafEmailTemplate: emailTmpl,
        };
      } catch (_e) {
        // ignore
      }
    }
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Er is een fout opgetreden tijdens het synchroniseren van de Simhuis SIM-voorraad.",
      debugContext,
    };
  }
}
