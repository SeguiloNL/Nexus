import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import type {
  InserveSettings,
  InserveSettingsInput,
  InserveSettingsMasked,
} from "@/server/validators/setting";
import { InserveSettingsSchema } from "@/server/validators/setting";
import type { UserRole } from "@/types/enums";

type Ctx = { userId: string; userRole: UserRole };

const INSERVE_SUBDOMAIN_KEY = "inserve.subdomain";
const INSERVE_API_KEY_KEY = "inserve.apiKey";

const API_KEY_MASK_REVEAL = 4;

function maskApiKey(key: string): string {
  if (!key) return "••••••••";
  const clean = key.trim();
  if (clean.length <= API_KEY_MASK_REVEAL) return "•".repeat(clean.length);
  const suffix = clean.slice(-API_KEY_MASK_REVEAL);
  const prefixLength = Math.max(clean.length - API_KEY_MASK_REVEAL, 4);
  return "•".repeat(prefixLength) + suffix;
}

function getEnvInserveSettings(): InserveSettings | null {
  const subdomain = process.env.INSERVE_SUBDOMAIN?.trim();
  const apiKey = process.env.INSERVE_API_KEY?.trim();
  if (subdomain && apiKey) {
    return { subdomain, apiKey };
  }
  return null;
}

export async function getInserveSettings(): Promise<InserveSettings | null> {
  const [subdomainRow, apiKeyRow] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: INSERVE_SUBDOMAIN_KEY } }),
    prisma.appSetting.findUnique({ where: { key: INSERVE_API_KEY_KEY } }),
  ]);

  const subdomain = subdomainRow?.value?.trim();
  const apiKey = apiKeyRow?.value?.trim();

  if (subdomain && apiKey) {
    return { subdomain, apiKey };
  }

  return getEnvInserveSettings();
}

export async function getInserveSettingsMasked(): Promise<InserveSettingsMasked> {
  const [subdomainRow, apiKeyRow] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: INSERVE_SUBDOMAIN_KEY } }),
    prisma.appSetting.findUnique({ where: { key: INSERVE_API_KEY_KEY } }),
  ]);

  const dbSubdomain = subdomainRow?.value?.trim();
  const dbApiKey = apiKeyRow?.value?.trim();

  if (dbSubdomain && dbApiKey) {
    return {
      subdomain: dbSubdomain,
      apiKeyMasked: maskApiKey(dbApiKey),
      hasApiKey: true,
      source: "db",
    };
  }

  const env = getEnvInserveSettings();
  if (env) {
    return {
      subdomain: env.subdomain,
      apiKeyMasked: maskApiKey(env.apiKey),
      hasApiKey: true,
      source: "env",
    };
  }

  return {
    subdomain: dbSubdomain ?? "",
    apiKeyMasked: "",
    hasApiKey: false,
    source: "none",
  };
}

export async function saveInserveSettings(
  input: InserveSettingsInput,
  ctx: Ctx
): Promise<InserveSettings> {
  const validated = InserveSettingsSchema.parse(input);

  const existing = await prisma.$transaction(async (tx) => {
    const [prevSubdomainRow, prevApiKeyRow] = await Promise.all([
      tx.appSetting.findUnique({ where: { key: INSERVE_SUBDOMAIN_KEY } }),
      tx.appSetting.findUnique({ where: { key: INSERVE_API_KEY_KEY } }),
    ]);

    const currentSettings = await (async (): Promise<InserveSettings | null> => {
      const dbSub = prevSubdomainRow?.value?.trim();
      const dbKey = prevApiKeyRow?.value?.trim();
      if (dbSub && dbKey) return { subdomain: dbSub, apiKey: dbKey };
      return getEnvInserveSettings();
    })();

    let finalApiKey: string;
    if (validated.apiKey) {
      finalApiKey = validated.apiKey;
    } else if (currentSettings) {
      finalApiKey = currentSettings.apiKey;
    } else {
      throw new Error("API-key is verplicht bij de eerste configuratie van Inserve.");
    }

    const finalSettings: InserveSettings = {
      subdomain: validated.subdomain,
      apiKey: finalApiKey,
    };

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    oldValues.subdomain = prevSubdomainRow?.value ?? null;
    oldValues.hasApiKey = !!prevApiKeyRow?.value;
    oldValues.source = prevSubdomainRow || prevApiKeyRow ? "db" : "env/none";

    newValues.subdomain = finalSettings.subdomain;
    newValues.hasApiKey = true;
    newValues.apiKeyChanged = !!validated.apiKey || !prevApiKeyRow?.value;

    await Promise.all([
      tx.appSetting.upsert({
        where: { key: INSERVE_SUBDOMAIN_KEY },
        create: {
          key: INSERVE_SUBDOMAIN_KEY,
          value: finalSettings.subdomain,
          isSecret: false,
        },
        update: { value: finalSettings.subdomain },
      }),
      tx.appSetting.upsert({
        where: { key: INSERVE_API_KEY_KEY },
        create: {
          key: INSERVE_API_KEY_KEY,
          value: finalSettings.apiKey,
          isSecret: true,
        },
        update: { value: finalSettings.apiKey },
      }),
    ]);

    await logAudit(tx, {
      entityType: "AppSetting",
      entityId: INSERVE_SUBDOMAIN_KEY,
      action: "UPDATE_SETTINGS",
      userId: ctx.userId,
      oldValues,
      newValues,
      metadata: { scope: "inserve_api" },
    });

    return finalSettings;
  });

  return existing;
}
