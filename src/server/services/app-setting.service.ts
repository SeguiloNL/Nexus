import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import type {
  InserveSettings,
  InserveSettingsInput,
  InserveSettingsMasked,
  SimhuisSettings,
  SimhuisSettingsInput,
  SimhuisSettingsMasked,
  NavixySettings,
  NavixySettingsInput,
  NavixySettingsMasked,
} from "@/server/validators/setting";
import {
  InserveSettingsSchema,
  SimhuisSettingsSchema,
  NavixySettingsSchema,
} from "@/server/validators/setting";
import type { UserRole } from "@/types/enums";

type Ctx = { userId: string; userRole: UserRole };

const INSERVE_SUBDOMAIN_KEY = "inserve.subdomain";
const INSERVE_API_KEY_KEY = "inserve.apiKey";

const SIMHUIS_KEYS = {
  baseUrl: "simhuis.baseUrl",
  authMode: "simhuis.authMode",
  username: "simhuis.username",
  password: "simhuis.password",
  resellerId: "simhuis.resellerId",
  defaultOfferId: "simhuis.defaultOfferId",
  defaultPlanId: "simhuis.defaultPlanId",
  defaultProductName: "simhuis.defaultProductName",
  endpointLogin: "simhuis.endpoint.login",
  endpointSims: "simhuis.endpoint.sims",
  endpointSimActivate: "simhuis.endpoint.simActivate",
  endpointSimDeactivate: "simhuis.endpoint.simDeactivate",
} as const;

const NAVIXY_KEYS = {
  baseUrl: "navixy.baseUrl",
  authMode: "navixy.authMode",
  panelLogin: "navixy.panel.login",
  panelPassword: "navixy.panel.password",
  userLogin: "navixy.user.login",
  userPassword: "navixy.user.password",
  directHash: "navixy.directHash",
  createMethod: "navixy.createMethod",
  defaultUserId: "navixy.defaultUserId",
  defaultTariffId: "navixy.defaultTariffId",
  defaultCloneSourceTrackerId: "navixy.defaultCloneSourceTrackerId",
  endpointPanelAuth: "navixy.endpoint.panelAuth",
  endpointUserAuth: "navixy.endpoint.userAuth",
  endpointPanelTracker: "navixy.endpoint.panelTracker",
  endpointUserTracker: "navixy.endpoint.userTracker",
} as const;

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

/* ========================= Simhuis ========================= */

function getEnvSimhuisSettings(): SimhuisSettings | null {
  const envStr = (name: string) => process.env[name]?.trim() ?? "";
  const baseUrl = envStr("SIMHUIS_BASE_URL") || "https://apicontrolcenter.com/v3";
  const authMode: "basic" | "bearer" =
    (envStr("SIMHUIS_AUTH_MODE").toLowerCase() || "basic") === "bearer" ? "bearer" : "basic";
  const username = envStr("SIMHUIS_USERNAME");
  const password = envStr("SIMHUIS_PASSWORD");
  if (!username || !password) return null;
  const resellerId = envStr("SIMHUIS_RESELLER_ID") || null;
  const defaultOfferId = envStr("SIMHUIS_DEFAULT_OFFER_ID") || null;
  const defaultPlanId = envStr("SIMHUIS_DEFAULT_PLAN_ID") || null;
  const defaultProductName = envStr("SIMHUIS_DEFAULT_PRODUCT_NAME") || null;
  return {
    baseUrl,
    authMode,
    username,
    password,
    resellerId: resellerId || undefined,
    defaultOfferId: defaultOfferId || undefined,
    defaultPlanId: defaultPlanId || undefined,
    defaultProductName: defaultProductName || undefined,
    endpoints: {
      login: envStr("SIMHUIS_ENDPOINT_LOGIN") || "/auth/login",
      sims: envStr("SIMHUIS_ENDPOINT_SIMS") || "/sims",
      simActivate: envStr("SIMHUIS_ENDPOINT_SIM_ACTIVATE") || "/activate",
      simDeactivate: envStr("SIMHUIS_ENDPOINT_SIM_DEACTIVATE") || "/deactivate",
    },
  };
}

export async function getSimhuisSettings(): Promise<SimhuisSettings | null> {
  const keys = Object.values(SIMHUIS_KEYS);
  const rows = await Promise.all(
    keys.map((k) => prisma.appSetting.findUnique({ where: { key: k } }))
  );
  const map: Record<string, string | undefined> = {};
  keys.forEach((k, i) => {
    map[k] = rows[i]?.value?.trim();
  });

  const baseUrl = map[SIMHUIS_KEYS.baseUrl];
  const username = map[SIMHUIS_KEYS.username];
  const password = map[SIMHUIS_KEYS.password];
  if (baseUrl && username && password) {
    return {
      baseUrl,
      authMode: (map[SIMHUIS_KEYS.authMode]?.toLowerCase() === "bearer" ? "bearer" : "basic") as
        | "basic"
        | "bearer",
      username,
      password,
      resellerId: map[SIMHUIS_KEYS.resellerId] || undefined,
      defaultOfferId: map[SIMHUIS_KEYS.defaultOfferId] || undefined,
      defaultPlanId: map[SIMHUIS_KEYS.defaultPlanId] || undefined,
      defaultProductName: map[SIMHUIS_KEYS.defaultProductName] || undefined,
      endpoints: {
        login: map[SIMHUIS_KEYS.endpointLogin] || "/auth/login",
        sims: map[SIMHUIS_KEYS.endpointSims] || "/sims",
        simActivate: map[SIMHUIS_KEYS.endpointSimActivate] || "/activate",
        simDeactivate: map[SIMHUIS_KEYS.endpointSimDeactivate] || "/deactivate",
      },
    };
  }
  return getEnvSimhuisSettings();
}

export async function getSimhuisSettingsMasked(): Promise<SimhuisSettingsMasked> {
  const keys = Object.values(SIMHUIS_KEYS);
  const rows = await Promise.all(
    keys.map((k) => prisma.appSetting.findUnique({ where: { key: k } }))
  );
  const map: Record<string, string | undefined> = {};
  keys.forEach((k, i) => {
    map[k] = rows[i]?.value?.trim();
  });

  const dbBaseUrl = map[SIMHUIS_KEYS.baseUrl];
  const dbUsername = map[SIMHUIS_KEYS.username];
  const dbPassword = map[SIMHUIS_KEYS.password];
  const hasDbPassword = !!dbPassword;

  if (dbBaseUrl && dbUsername && hasDbPassword) {
    return {
      baseUrl: dbBaseUrl,
      authMode: (map[SIMHUIS_KEYS.authMode]?.toLowerCase() === "bearer" ? "bearer" : "basic") as
        | "basic"
        | "bearer",
      username: dbUsername,
      passwordMasked: maskApiKey(dbPassword!),
      hasPassword: true,
      resellerId: map[SIMHUIS_KEYS.resellerId] || undefined,
      defaultOfferId: map[SIMHUIS_KEYS.defaultOfferId] || undefined,
      defaultPlanId: map[SIMHUIS_KEYS.defaultPlanId] || undefined,
      defaultProductName: map[SIMHUIS_KEYS.defaultProductName] || undefined,
      endpoints: {
        login: map[SIMHUIS_KEYS.endpointLogin] || "/auth/login",
        sims: map[SIMHUIS_KEYS.endpointSims] || "/sims",
        simActivate: map[SIMHUIS_KEYS.endpointSimActivate] || "/activate",
        simDeactivate: map[SIMHUIS_KEYS.endpointSimDeactivate] || "/deactivate",
      },
      source: "db",
    };
  }

  const env = getEnvSimhuisSettings();
  if (env) {
    return {
      baseUrl: env.baseUrl,
      authMode: env.authMode,
      username: env.username,
      passwordMasked: maskApiKey(env.password),
      hasPassword: true,
      resellerId: env.resellerId,
      defaultOfferId: env.defaultOfferId,
      defaultPlanId: env.defaultPlanId,
      defaultProductName: env.defaultProductName,
      endpoints: env.endpoints,
      source: "env",
    };
  }

  return {
    baseUrl: dbBaseUrl ?? "",
    authMode: (map[SIMHUIS_KEYS.authMode]?.toLowerCase() === "bearer" ? "bearer" : "basic") as
      | "basic"
      | "bearer",
    username: dbUsername ?? "",
    passwordMasked: "",
    hasPassword: false,
    resellerId: map[SIMHUIS_KEYS.resellerId] ?? undefined,
    defaultOfferId: map[SIMHUIS_KEYS.defaultOfferId] ?? undefined,
    defaultPlanId: map[SIMHUIS_KEYS.defaultPlanId] ?? undefined,
    defaultProductName: map[SIMHUIS_KEYS.defaultProductName] ?? undefined,
    endpoints: {
      login: map[SIMHUIS_KEYS.endpointLogin] || "/auth/login",
      sims: map[SIMHUIS_KEYS.endpointSims] || "/sims",
      simActivate: map[SIMHUIS_KEYS.endpointSimActivate] || "/activate",
      simDeactivate: map[SIMHUIS_KEYS.endpointSimDeactivate] || "/deactivate",
    },
    source: "none",
  };
}

export async function saveSimhuisSettings(
  input: SimhuisSettingsInput,
  ctx: Ctx
): Promise<SimhuisSettings> {
  const validated = SimhuisSettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const keys = Object.values(SIMHUIS_KEYS);
    const prevRows = await Promise.all(
      keys.map((k) => tx.appSetting.findUnique({ where: { key: k } }))
    );
    const prev: Record<string, string | undefined> = {};
    keys.forEach((k, i) => {
      prev[k] = prevRows[i]?.value?.trim();
    });

    const currentSettings = await (async (): Promise<SimhuisSettings | null> => {
      const base = prev[SIMHUIS_KEYS.baseUrl];
      const uname = prev[SIMHUIS_KEYS.username];
      const pw = prev[SIMHUIS_KEYS.password];
      if (base && uname && pw) {
        return {
          baseUrl: base,
          authMode: (prev[SIMHUIS_KEYS.authMode]?.toLowerCase() === "bearer"
            ? "bearer"
            : "basic") as "basic" | "bearer",
          username: uname,
          password: pw,
          resellerId: prev[SIMHUIS_KEYS.resellerId] || undefined,
          defaultOfferId: prev[SIMHUIS_KEYS.defaultOfferId] || undefined,
          defaultPlanId: prev[SIMHUIS_KEYS.defaultPlanId] || undefined,
          defaultProductName: prev[SIMHUIS_KEYS.defaultProductName] || undefined,
          endpoints: {
            login: prev[SIMHUIS_KEYS.endpointLogin] || "/auth/login",
            sims: prev[SIMHUIS_KEYS.endpointSims] || "/sims",
            simActivate: prev[SIMHUIS_KEYS.endpointSimActivate] || "/activate",
            simDeactivate: prev[SIMHUIS_KEYS.endpointSimDeactivate] || "/deactivate",
          },
        };
      }
      return getEnvSimhuisSettings();
    })();

    let finalPassword: string;
    if (validated.password) {
      finalPassword = validated.password;
    } else if (currentSettings) {
      finalPassword = currentSettings.password;
    } else {
      throw new Error("Wachtwoord is verplicht bij de eerste configuratie van Simhuis.");
    }

    const finalSettings: SimhuisSettings = {
      baseUrl: validated.baseUrl,
      authMode: validated.authMode,
      username: validated.username,
      password: finalPassword,
      resellerId: validated.resellerId,
      defaultOfferId: validated.defaultOfferId,
      defaultPlanId: validated.defaultPlanId,
      defaultProductName: validated.defaultProductName,
      endpoints: {
        login: validated.endpointLogin,
        sims: validated.endpointSims,
        simActivate: validated.endpointSimActivate,
        simDeactivate: validated.endpointSimDeactivate,
      },
    };

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    oldValues.source = prev[SIMHUIS_KEYS.baseUrl] || prev[SIMHUIS_KEYS.username] ? "db" : "env/none";
    oldValues.baseUrl = prev[SIMHUIS_KEYS.baseUrl] ?? null;
    oldValues.authMode = prev[SIMHUIS_KEYS.authMode] ?? null;
    oldValues.username = prev[SIMHUIS_KEYS.username] ?? null;
    oldValues.hasPassword = !!prev[SIMHUIS_KEYS.password];
    oldValues.defaultOfferId = prev[SIMHUIS_KEYS.defaultOfferId] ?? null;
    oldValues.defaultPlanId = prev[SIMHUIS_KEYS.defaultPlanId] ?? null;
    oldValues.defaultProductName = prev[SIMHUIS_KEYS.defaultProductName] ?? null;

    newValues.source = "db";
    newValues.baseUrl = finalSettings.baseUrl;
    newValues.authMode = finalSettings.authMode;
    newValues.username = finalSettings.username;
    newValues.hasPassword = true;
    newValues.passwordChanged = !!validated.password || !prev[SIMHUIS_KEYS.password];
    newValues.defaultOfferId = finalSettings.defaultOfferId ?? null;
    newValues.defaultPlanId = finalSettings.defaultPlanId ?? null;
    newValues.defaultProductName = finalSettings.defaultProductName ?? null;

    const upsertPair = (
      key: string,
      value: string | null | undefined,
      isSecret: boolean
    ) => {
      const v = value === null || value === undefined ? "" : value;
      return tx.appSetting.upsert({
        where: { key },
        create: { key, value: v, isSecret },
        update: { value: v },
      });
    };

    const upserts: Promise<unknown>[] = [
      upsertPair(SIMHUIS_KEYS.baseUrl, finalSettings.baseUrl, false),
      upsertPair(SIMHUIS_KEYS.authMode, finalSettings.authMode, false),
      upsertPair(SIMHUIS_KEYS.username, finalSettings.username, false),
      upsertPair(SIMHUIS_KEYS.password, finalSettings.password, true),
      upsertPair(SIMHUIS_KEYS.resellerId, finalSettings.resellerId, false),
      upsertPair(SIMHUIS_KEYS.defaultOfferId, finalSettings.defaultOfferId, false),
      upsertPair(SIMHUIS_KEYS.defaultPlanId, finalSettings.defaultPlanId, false),
      upsertPair(SIMHUIS_KEYS.defaultProductName, finalSettings.defaultProductName, false),
      upsertPair(SIMHUIS_KEYS.endpointLogin, finalSettings.endpoints.login, false),
      upsertPair(SIMHUIS_KEYS.endpointSims, finalSettings.endpoints.sims, false),
      upsertPair(SIMHUIS_KEYS.endpointSimActivate, finalSettings.endpoints.simActivate, false),
      upsertPair(SIMHUIS_KEYS.endpointSimDeactivate, finalSettings.endpoints.simDeactivate, false),
    ];

    await Promise.all(upserts);

    await logAudit(tx, {
      entityType: "AppSetting",
      entityId: SIMHUIS_KEYS.baseUrl,
      action: "UPDATE_SETTINGS",
      userId: ctx.userId,
      oldValues,
      newValues,
      metadata: { scope: "simhuis_api" },
    });

    return finalSettings;
  });
}

/* ========================= Navixy ========================= */

function strToNullableNumber(s: string | undefined | null): number | null | undefined {
  if (s === undefined || s === null) return undefined;
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return isFinite(n) ? n : undefined;
}

function getEnvNavixySettings(): NavixySettings | null {
  const envStr = (name: string) => process.env[name]?.trim() ?? "";
  const envNum = (name: string) => {
    const s = envStr(name);
    if (!s) return undefined;
    const n = Number(s);
    return isFinite(n) ? n : undefined;
  };

  const baseUrl = envStr("NAVIXY_BASE_URL") || "https://api.eu.navixy.com/v2";
  const modeRaw = envStr("NAVIXY_AUTH_MODE").toLowerCase() || "panel";
  let authMode: "panel" | "user" | "direct" = "panel";
  if (modeRaw === "user") authMode = "user";
  else if (modeRaw === "direct") authMode = "direct";

  const panelLogin = envStr("NAVIXY_PANEL_LOGIN") || undefined;
  const panelPassword = envStr("NAVIXY_PANEL_PASSWORD") || undefined;
  const userLogin = envStr("NAVIXY_USER_LOGIN") || undefined;
  const userPassword = envStr("NAVIXY_USER_PASSWORD") || undefined;
  const directHash = envStr("NAVIXY_SESSION_HASH") || undefined;

  const configuredDirect = authMode === "direct" && !!directHash;
  const configuredPanel = authMode === "panel" && !!panelLogin && !!panelPassword;
  const configuredUser = authMode === "user" && !!userLogin && !!userPassword;
  if (!configuredDirect && !configuredPanel && !configuredUser) return null;

  const methodRaw = envStr("NAVIXY_CREATE_METHOD").toLowerCase() || "create";
  let createMethod: "create" | "clone" | "register" = "create";
  if (methodRaw === "clone") createMethod = "clone";
  else if (methodRaw === "register") createMethod = "register";

  return {
    baseUrl,
    authMode,
    panelLogin,
    panelPassword,
    userLogin,
    userPassword,
    directHash,
    createMethod,
    defaultUserId: envNum("NAVIXY_DEFAULT_USER_ID"),
    defaultTariffId: envNum("NAVIXY_DEFAULT_TARIFF_ID"),
    defaultCloneSourceTrackerId: envNum("NAVIXY_DEFAULT_CLONE_SOURCE_TRACKER_ID"),
    endpoints: {
      panelAuth: envStr("NAVIXY_ENDPOINT_PANEL_AUTH") || "/panel/account/auth",
      userAuth: envStr("NAVIXY_ENDPOINT_USER_AUTH") || "/user/session/auth",
      panelTracker: envStr("NAVIXY_ENDPOINT_PANEL_TRACKER") || "/panel/tracker",
      userTracker: envStr("NAVIXY_ENDPOINT_USER_TRACKER") || "/user/tracker",
    },
  };
}

function buildNavixyFromMap(
  map: Record<string, string | undefined>
): NavixySettings | null {
  const baseUrl = map[NAVIXY_KEYS.baseUrl];
  if (!baseUrl) return null;
  const authMode: "panel" | "user" | "direct" =
    map[NAVIXY_KEYS.authMode] === "user"
      ? "user"
      : map[NAVIXY_KEYS.authMode] === "direct"
        ? "direct"
        : "panel";
  const panelLogin = map[NAVIXY_KEYS.panelLogin];
  const panelPassword = map[NAVIXY_KEYS.panelPassword];
  const userLogin = map[NAVIXY_KEYS.userLogin];
  const userPassword = map[NAVIXY_KEYS.userPassword];
  const directHash = map[NAVIXY_KEYS.directHash];
  const configuredDirect = authMode === "direct" && !!directHash;
  const configuredPanel = authMode === "panel" && !!panelLogin && !!panelPassword;
  const configuredUser = authMode === "user" && !!userLogin && !!userPassword;
  if (!configuredDirect && !configuredPanel && !configuredUser) return null;

  let createMethod: "create" | "clone" | "register" = "create";
  if (map[NAVIXY_KEYS.createMethod] === "clone") createMethod = "clone";
  else if (map[NAVIXY_KEYS.createMethod] === "register") createMethod = "register";

  return {
    baseUrl,
    authMode,
    panelLogin,
    panelPassword,
    userLogin,
    userPassword,
    directHash,
    createMethod,
    defaultUserId: strToNullableNumber(map[NAVIXY_KEYS.defaultUserId]),
    defaultTariffId: strToNullableNumber(map[NAVIXY_KEYS.defaultTariffId]),
    defaultCloneSourceTrackerId: strToNullableNumber(
      map[NAVIXY_KEYS.defaultCloneSourceTrackerId]
    ),
    endpoints: {
      panelAuth: map[NAVIXY_KEYS.endpointPanelAuth] || "/panel/account/auth",
      userAuth: map[NAVIXY_KEYS.endpointUserAuth] || "/user/session/auth",
      panelTracker: map[NAVIXY_KEYS.endpointPanelTracker] || "/panel/tracker",
      userTracker: map[NAVIXY_KEYS.endpointUserTracker] || "/user/tracker",
    },
  };
}

export async function getNavixySettings(): Promise<NavixySettings | null> {
  const keys = Object.values(NAVIXY_KEYS);
  const rows = await Promise.all(
    keys.map((k) => prisma.appSetting.findUnique({ where: { key: k } }))
  );
  const map: Record<string, string | undefined> = {};
  keys.forEach((k, i) => {
    map[k] = rows[i]?.value?.trim();
  });
  const db = buildNavixyFromMap(map);
  if (db) return db;
  return getEnvNavixySettings();
}

export async function getNavixySettingsMasked(): Promise<NavixySettingsMasked> {
  const keys = Object.values(NAVIXY_KEYS);
  const rows = await Promise.all(
    keys.map((k) => prisma.appSetting.findUnique({ where: { key: k } }))
  );
  const map: Record<string, string | undefined> = {};
  keys.forEach((k, i) => {
    map[k] = rows[i]?.value?.trim();
  });

  const db = buildNavixyFromMap(map);
  if (db) {
    return {
      baseUrl: db.baseUrl,
      authMode: db.authMode,
      panelLogin: db.panelLogin,
      panelPasswordMasked: db.panelPassword ? maskApiKey(db.panelPassword) : null,
      hasPanelPassword: !!db.panelPassword,
      userLogin: db.userLogin,
      userPasswordMasked: db.userPassword ? maskApiKey(db.userPassword) : null,
      hasUserPassword: !!db.userPassword,
      directHashMasked: db.directHash ? maskApiKey(db.directHash) : null,
      hasDirectHash: !!db.directHash,
      createMethod: db.createMethod,
      defaultUserId: db.defaultUserId,
      defaultTariffId: db.defaultTariffId,
      defaultCloneSourceTrackerId: db.defaultCloneSourceTrackerId,
      endpoints: db.endpoints,
      source: "db",
    };
  }

  const env = getEnvNavixySettings();
  if (env) {
    return {
      baseUrl: env.baseUrl,
      authMode: env.authMode,
      panelLogin: env.panelLogin,
      panelPasswordMasked: env.panelPassword ? maskApiKey(env.panelPassword) : null,
      hasPanelPassword: !!env.panelPassword,
      userLogin: env.userLogin,
      userPasswordMasked: env.userPassword ? maskApiKey(env.userPassword) : null,
      hasUserPassword: !!env.userPassword,
      directHashMasked: env.directHash ? maskApiKey(env.directHash) : null,
      hasDirectHash: !!env.directHash,
      createMethod: env.createMethod,
      defaultUserId: env.defaultUserId,
      defaultTariffId: env.defaultTariffId,
      defaultCloneSourceTrackerId: env.defaultCloneSourceTrackerId,
      endpoints: env.endpoints,
      source: "env",
    };
  }

  return {
    baseUrl: map[NAVIXY_KEYS.baseUrl] ?? "",
    authMode:
      (map[NAVIXY_KEYS.authMode] as "panel" | "user" | "direct" | undefined) ?? "panel",
    panelLogin: map[NAVIXY_KEYS.panelLogin],
    panelPasswordMasked: null,
    hasPanelPassword: false,
    userLogin: map[NAVIXY_KEYS.userLogin],
    userPasswordMasked: null,
    hasUserPassword: false,
    directHashMasked: null,
    hasDirectHash: false,
    createMethod:
      (map[NAVIXY_KEYS.createMethod] as "create" | "clone" | "register" | undefined) ??
      "create",
    defaultUserId: strToNullableNumber(map[NAVIXY_KEYS.defaultUserId]),
    defaultTariffId: strToNullableNumber(map[NAVIXY_KEYS.defaultTariffId]),
    defaultCloneSourceTrackerId: strToNullableNumber(
      map[NAVIXY_KEYS.defaultCloneSourceTrackerId]
    ),
    endpoints: {
      panelAuth: map[NAVIXY_KEYS.endpointPanelAuth] || "/panel/account/auth",
      userAuth: map[NAVIXY_KEYS.endpointUserAuth] || "/user/session/auth",
      panelTracker: map[NAVIXY_KEYS.endpointPanelTracker] || "/panel/tracker",
      userTracker: map[NAVIXY_KEYS.endpointUserTracker] || "/user/tracker",
    },
    source: "none",
  };
}

export async function saveNavixySettings(
  input: NavixySettingsInput,
  ctx: Ctx
): Promise<NavixySettings> {
  const validated = NavixySettingsSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const keys = Object.values(NAVIXY_KEYS);
    const prevRows = await Promise.all(
      keys.map((k) => tx.appSetting.findUnique({ where: { key: k } }))
    );
    const prev: Record<string, string | undefined> = {};
    keys.forEach((k, i) => {
      prev[k] = prevRows[i]?.value?.trim();
    });

    const currentSettings = buildNavixyFromMap(prev) ?? getEnvNavixySettings();

    const finalPanelPassword =
      validated.panelPassword ?? currentSettings?.panelPassword;
    const finalUserPassword =
      validated.userPassword ?? currentSettings?.userPassword;
    const finalDirectHash = validated.directHash ?? currentSettings?.directHash;

    const configuredDirect =
      validated.authMode === "direct" && !!finalDirectHash;
    const configuredPanel =
      validated.authMode === "panel" &&
      !!validated.panelLogin &&
      !!finalPanelPassword;
    const configuredUser =
      validated.authMode === "user" &&
      !!validated.userLogin &&
      !!finalUserPassword;
    if (!configuredDirect && !configuredPanel && !configuredUser) {
      throw new Error(
        "Onvoldoende credentials om Navixy te configureren voor de gekozen auth mode."
      );
    }

    const finalSettings: NavixySettings = {
      baseUrl: validated.baseUrl,
      authMode: validated.authMode,
      panelLogin: validated.panelLogin,
      panelPassword: finalPanelPassword,
      userLogin: validated.userLogin,
      userPassword: finalUserPassword,
      directHash: finalDirectHash,
      createMethod: validated.createMethod,
      defaultUserId: strToNullableNumber(validated.defaultUserId as unknown as string),
      defaultTariffId: strToNullableNumber(validated.defaultTariffId as unknown as string),
      defaultCloneSourceTrackerId: strToNullableNumber(
        validated.defaultCloneSourceTrackerId as unknown as string
      ),
      endpoints: {
        panelAuth: validated.endpointPanelAuth,
        userAuth: validated.endpointUserAuth,
        panelTracker: validated.endpointPanelTracker,
        userTracker: validated.endpointUserTracker,
      },
    };

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    oldValues.source = prev[NAVIXY_KEYS.baseUrl] ? "db" : "env/none";
    oldValues.baseUrl = prev[NAVIXY_KEYS.baseUrl] ?? null;
    oldValues.authMode = prev[NAVIXY_KEYS.authMode] ?? null;
    oldValues.hasPanelPassword = !!prev[NAVIXY_KEYS.panelPassword];
    oldValues.hasUserPassword = !!prev[NAVIXY_KEYS.userPassword];
    oldValues.hasDirectHash = !!prev[NAVIXY_KEYS.directHash];

    newValues.source = "db";
    newValues.baseUrl = finalSettings.baseUrl;
    newValues.authMode = finalSettings.authMode;
    newValues.hasPanelPassword = !!finalSettings.panelPassword;
    newValues.hasUserPassword = !!finalSettings.userPassword;
    newValues.hasDirectHash = !!finalSettings.directHash;
    newValues.panelPasswordChanged =
      !!validated.panelPassword || !prev[NAVIXY_KEYS.panelPassword];
    newValues.userPasswordChanged =
      !!validated.userPassword || !prev[NAVIXY_KEYS.userPassword];
    newValues.directHashChanged = !!validated.directHash || !prev[NAVIXY_KEYS.directHash];

    const upsertPair = (
      key: string,
      value: string | number | null | undefined,
      isSecret: boolean
    ) => {
      const v =
        value === null || value === undefined
          ? ""
          : typeof value === "number"
            ? String(value)
            : value;
      return tx.appSetting.upsert({
        where: { key },
        create: { key, value: v, isSecret },
        update: { value: v },
      });
    };

    await Promise.all([
      upsertPair(NAVIXY_KEYS.baseUrl, finalSettings.baseUrl, false),
      upsertPair(NAVIXY_KEYS.authMode, finalSettings.authMode, false),
      upsertPair(NAVIXY_KEYS.panelLogin, finalSettings.panelLogin, false),
      upsertPair(NAVIXY_KEYS.panelPassword, finalSettings.panelPassword, true),
      upsertPair(NAVIXY_KEYS.userLogin, finalSettings.userLogin, false),
      upsertPair(NAVIXY_KEYS.userPassword, finalSettings.userPassword, true),
      upsertPair(NAVIXY_KEYS.directHash, finalSettings.directHash, true),
      upsertPair(NAVIXY_KEYS.createMethod, finalSettings.createMethod, false),
      upsertPair(NAVIXY_KEYS.defaultUserId, finalSettings.defaultUserId, false),
      upsertPair(NAVIXY_KEYS.defaultTariffId, finalSettings.defaultTariffId, false),
      upsertPair(
        NAVIXY_KEYS.defaultCloneSourceTrackerId,
        finalSettings.defaultCloneSourceTrackerId,
        false
      ),
      upsertPair(NAVIXY_KEYS.endpointPanelAuth, finalSettings.endpoints.panelAuth, false),
      upsertPair(NAVIXY_KEYS.endpointUserAuth, finalSettings.endpoints.userAuth, false),
      upsertPair(
        NAVIXY_KEYS.endpointPanelTracker,
        finalSettings.endpoints.panelTracker,
        false
      ),
      upsertPair(
        NAVIXY_KEYS.endpointUserTracker,
        finalSettings.endpoints.userTracker,
        false
      ),
    ]);

    await logAudit(tx, {
      entityType: "AppSetting",
      entityId: NAVIXY_KEYS.baseUrl,
      action: "UPDATE_SETTINGS",
      userId: ctx.userId,
      oldValues,
      newValues,
      metadata: { scope: "navixy_api" },
    });

    return finalSettings;
  });
}
