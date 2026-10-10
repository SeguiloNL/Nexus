"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import { logAudit } from "@/server/services/audit.service";
import {
  buildProviderSettingsSchema,
  flattenProviderSettings,
} from "@/server/validators/provider-setting";
import {
  getProviderSettingsMasked,
  saveProviderSettings,
} from "@/server/services/app-setting.service";
import {
  initializeProviderRegistry,
  providerRegistry,
} from "@/server/providers/registry";
import type { SimProviderCapability } from "@/server/providers/capabilities";
import type { RoleScope } from "@/types/enums";

// --- Permissie guards (consistent met /settings/actions.ts) ----------------

async function assertSettingsView() {
  const user = await requireUser();
  try {
    await requirePermission(user.role, "view", "setting");
  } catch {
    await requirePermission(user.role, "edit", "setting");
  }
  return user;
}

async function assertSettingsEdit() {
  const user = await requireUser();
  await requirePermission(user.role, "edit", "setting");
  // Alleen INTERNAL scope mutatie toestaan (gelijk aan settings page).
  if ((user.roleScope as RoleScope) !== "INTERNAL") {
    return { userId: user.id, internal: false as const };
  }
  return { userId: user.id, internal: true as const };
}

// --- Publieke server actions --------------------------------------------------

export type ProviderListItem = {
  providerKey: string;
  displayName: string;
  moduleAvailable: boolean;
  isConfigured: boolean;
  isActivated: boolean;
  isConnected: boolean;
  lastConnectionCheckedAt: Date | null;
  lastConnectionLatencyMs: number | null;
  lastConnectionErrorSafe: string | null;
  capabilities: SimProviderCapability[];
  settings: Record<string, { value?: string; masked?: string; isSecret: boolean }>;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export async function listProvidersAction(): Promise<{
  ok: true;
  items: ProviderListItem[];
}> {
  await assertSettingsView();
  await initializeProviderRegistry();
  const all = await providerRegistry.listAll();
  // Fetch masked settings voor iedere provider (apart, want listAll geeft geen settings)
  const items: ProviderListItem[] = [];
  for (const p of all) {
    let settings: ProviderListItem["settings"] = {};
    try {
      settings = await getProviderSettingsMasked(p.providerKey);
    } catch {
      settings = {};
    }
    items.push({
      providerKey: p.providerKey,
      displayName: p.displayName,
      moduleAvailable: p.registered,
      isConfigured: p.configured,
      isActivated: p.activated,
      isConnected: p.connected === true,
      lastConnectionCheckedAt: p.lastConnectionCheckedAt ?? null,
      lastConnectionLatencyMs: p.lastConnectionLatencyMs ?? null,
      lastConnectionErrorSafe: p.lastConnectionErrorSafe ?? null,
      capabilities: Object.entries(p.capabilities)
        .filter(([, v]) => v === true)
        .map(([k]) => k as SimProviderCapability),
      settings,
      createdAt: null,
      updatedAt: null,
    });
  }
  return {
    ok: true,
    items,
  };
}

export async function testConnectionAction(
  providerKey: string
): Promise<{ ok: boolean; message: string }> {
  const ctx = await assertSettingsEdit();
  if (!ctx.internal) {
    return {
      ok: false,
      message: "Verbinding testen is alleen toegestaan voor interne beheerders.",
    };
  }
  await initializeProviderRegistry();
  const adapter = await providerRegistry.require(providerKey);

  if (!adapter.capabilities.testConnection) {
    return {
      ok: false,
      message:
        "Deze leverancier biedt geen veilige verbindingstest zonder mutaties aan.",
    };
  }

  const start = performance.now();
  let errorSafe: string | undefined;
  let okFlag = false;
  try {
    if (typeof adapter.testConnection !== "function") {
      throw new Error("testConnection niet geimplementeerd");
    }
    const res = await adapter.testConnection();
    okFlag = !!res?.ok;
    errorSafe = res?.ok
      ? undefined
      : res?.safeError || "Verbinding mislukt (geen details).";
  } catch (e: any) {
    okFlag = false;
    errorSafe =
      e?.safeError && typeof e.safeError === "string"
        ? e.safeError
        : "Verbinding mislukt (geen details).";
  } finally {
    const latency = Math.round(performance.now() - start);
    await providerRegistry.updateConnectionStatus(providerKey, {
      ok: okFlag,
      checkedAt: new Date(),
      latencyMs: latency,
      safeError: errorSafe,
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await logAudit(tx as any, {
        entityType: "SimProvider",
        entityId: providerKey,
        action: "PROVIDER_CONNECTION_TESTED",
        userId: ctx.userId,
        oldValues: { testedAt: null },
        newValues: { testedAt: new Date().toISOString(), ok: okFlag },
        metadata: { scope: "provider_connection_test" },
      });
    });
  } catch {
    /* audit action mogelijk onbekend in oudere DB; negeren */
  }

  return {
    ok: okFlag,
    message: okFlag
      ? "Verbinding met de leverancier werkt."
      : errorSafe ?? "Verbinding mislukt (geen details).",
  };
}

export async function activateProviderAction(providerKey: string) {
  const ctx = await assertSettingsEdit();
  if (!ctx.internal) {
    return {
      ok: false as const,
      message: "Activeren is alleen toegestaan voor interne beheerders.",
    };
  }
  await initializeProviderRegistry();
  if (!(await providerRegistry.isConfigured(providerKey))) {
    return {
      ok: false as const,
      message:
        "Kan niet activeren: de vereiste configuratie (API-inloggegevens) ontbreekt of is ongeldig. Vul eerst alle verplichte velden in.",
    };
  }
  const adapter = await providerRegistry.require(providerKey);
  await prisma.simProvider.upsert({
    where: { providerKey },
    create: {
      providerKey,
      displayName: adapter.displayName || providerKey,
      active: true,
    },
    update: { active: true, displayName: adapter.displayName || undefined },
  });
  try {
    await prisma.$transaction(async (tx) => {
      await logAudit(tx as any, {
        entityType: "SimProvider",
        entityId: providerKey,
        action: "PROVIDER_ACTIVATED",
        userId: ctx.userId,
        oldValues: { active: false },
        newValues: { active: true },
      });
    });
  } catch {
    /* negeren */
  }
  return {
    ok: true as const,
    message: `Leverancier “${adapter.displayName || providerKey}” is geactiveerd. Nieuwe en bestaande SIM-kaarten worden naar deze leverancier gerouteerd als hun providerKey hierop wijst.`,
  };
}

export async function deactivateProviderAction(providerKey: string) {
  const ctx = await assertSettingsEdit();
  if (!ctx.internal) {
    return {
      ok: false as const,
      message: "Deactiveren is alleen toegestaan voor interne beheerders.",
    };
  }
  await initializeProviderRegistry();
  if (providerKey === "simhuis") {
    return {
      ok: false as const,
      message:
        "Simhuis kan niet worden gedeactiveerd via dit scherm (backward-compatibiliteit). Verwijder indien nodig de API-inloggegevens in Instellingen.",
    };
  }
  await prisma.simProvider.updateMany({
    where: { providerKey },
    data: { active: false },
  });
  try {
    await prisma.$transaction(async (tx) => {
      await logAudit(tx as any, {
        entityType: "SimProvider",
        entityId: providerKey,
        action: "PROVIDER_DEACTIVATED",
        userId: ctx.userId,
        oldValues: { active: true },
        newValues: { active: false },
      });
    });
  } catch {
    /* negeren */
  }
  return {
    ok: true as const,
    message:
      "Leverancier is gedeactiveerd. Bestaande SIM-kaarten en gegevens zijn NIET verwijderd en blijven zichtbaar. Nieuwe mutaties via deze leverancier worden geblokkeerd totdat de module opnieuw wordt geactiveerd.",
  };
}

export async function saveProviderSettingsAction(
  providerKey: string,
  rawValues: Record<string, unknown>
) {
  const ctx = await assertSettingsEdit();
  if (!ctx.internal) {
    return {
      ok: false as const,
      message: "Wijzigen van instellingen is alleen toegestaan voor interne beheerders.",
    };
  }
  await initializeProviderRegistry();
  const schema = buildProviderSettingsSchema(providerKey);
  const parsed = schema.safeParse(rawValues);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const fieldErrors = flat.fieldErrors as Record<string, string[] | undefined>;
    const firstKey = Object.keys(fieldErrors)[0];
    const first =
      firstKey
        ? `${firstKey}: ${fieldErrors[firstKey]?.[0] ?? ""}`
        : parsed.error.issues[0]?.message ?? "Validatiefout in instellingen.";
    return { ok: false as const, message: first };
  }

  const flat = flattenProviderSettings(parsed.data as any);
  // Behoud bestaande wachtwoorden als gebruiker ze niet expliciet invult.
  const preserve = rawValues.__preservePassword === true;
  if (preserve) {
    for (const key of Object.keys(flat)) {
      if (
        (key === "password" ||
          key === "clientSecret" ||
          key === "apiToken" ||
          key === "webhookSecret") &&
        (flat[key] === "" || flat[key] === undefined)
      ) {
        delete flat[key];
      }
    }
  }

  await saveProviderSettings(providerKey, flat, ctx);
  const masked = await getProviderSettingsMasked(providerKey);
  return {
    ok: true as const,
    message: "Instellingen zijn opgeslagen.",
    settings: masked,
  };
}
