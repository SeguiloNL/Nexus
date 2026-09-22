import { z } from "zod";

/* ========================= Inserve ========================= */

export const InserveSettingsSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .min(1, "Inserve subdomein is verplicht")
    .regex(
      /^[a-z0-9-]+$/i,
      "Subdomein mag alleen letters, cijfers en streepjes bevatten"
    ),
  apiKey: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (val) => !val || val.length >= 8,
      "API-key lijkt te kort (minimaal 8 tekens)"
    )
    .transform((val) => (val === null || val === "" ? undefined : val)),
});

export type InserveSettingsInput = z.infer<typeof InserveSettingsSchema>;

export interface InserveSettings {
  subdomain: string;
  apiKey: string;
}

export interface InserveSettingsMasked {
  subdomain: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  source: "env" | "db" | "none";
}

/* ========================= Simhuis ========================= */

const simhuisEndpointRegex = /^\/[A-Za-z0-9_/-]*$/;
const simhuisEndpointMsg = "Endpoint moet beginnen met / en mag alleen letters, cijfers, _, - en / bevatten";

export const SimhuisSettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, "Basis URL is verplicht")
    .url("Ongeldige URL"),
  authMode: z.enum(["basic", "bearer"]).default("basic"),
  username: z
    .string()
    .trim()
    .min(1, "Gebruikersnaam is verplicht"),
  password: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (val) => !val || val.length >= 4,
      "Wachtwoord lijkt te kort (minimaal 4 tekens)"
    )
    .transform((val) => (val === null || val === "" ? undefined : val)),
  resellerId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  defaultOfferId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  defaultPlanId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  defaultProductName: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val === null || val === "" ? undefined : val)),
  endpointLogin: z
    .string()
    .trim()
    .default("/auth/login")
    .refine((v) => simhuisEndpointRegex.test(v), simhuisEndpointMsg),
  endpointSims: z
    .string()
    .trim()
    .default("/sims")
    .refine((v) => simhuisEndpointRegex.test(v), simhuisEndpointMsg),
  endpointSimActivate: z
    .string()
    .trim()
    .default("/activate")
    .refine((v) => simhuisEndpointRegex.test(v), simhuisEndpointMsg),
  endpointSimDeactivate: z
    .string()
    .trim()
    .default("/deactivate")
    .refine((v) => simhuisEndpointRegex.test(v), simhuisEndpointMsg),
});

export type SimhuisSettingsInput = z.infer<typeof SimhuisSettingsSchema>;

export interface SimhuisSettings {
  baseUrl: string;
  authMode: "basic" | "bearer";
  username: string;
  password: string;
  resellerId?: string | null;
  defaultOfferId?: string | null;
  defaultPlanId?: string | null;
  defaultProductName?: string | null;
  endpoints: {
    login: string;
    sims: string;
    simActivate: string;
    simDeactivate: string;
  };
}

export interface SimhuisSettingsMasked {
  baseUrl: string;
  authMode: "basic" | "bearer";
  username: string;
  passwordMasked: string;
  hasPassword: boolean;
  resellerId?: string | null;
  defaultOfferId?: string | null;
  defaultPlanId?: string | null;
  defaultProductName?: string | null;
  endpoints: {
    login: string;
    sims: string;
    simActivate: string;
    simDeactivate: string;
  };
  source: "env" | "db" | "none";
}

/* ========================= Navixy ========================= */

const navixyAuthMode = z.enum(["panel", "user", "direct"]).default("panel");
const navixyEndpointRegex = /^\/[A-Za-z0-9_/-]*$/;
const navixyEndpointMsg = "Endpoint moet beginnen met / en mag alleen letters, cijfers, _, - en / bevatten";

export const NavixySettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, "Basis URL is verplicht")
    .url("Ongeldige URL"),
  authMode: navixyAuthMode,
  panelLogin: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null || v === "" ? undefined : v)),
  panelPassword: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.length >= 4,
      "Panel wachtwoord lijkt te kort (minimaal 4 tekens)"
    )
    .transform((v) => (v === null || v === "" ? undefined : v)),
  userLogin: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v === null || v === "" ? undefined : v)),
  userPassword: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.length >= 4,
      "User wachtwoord lijkt te kort (minimaal 4 tekens)"
    )
    .transform((v) => (v === null || v === "" ? undefined : v)),
  directHash: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine(
      (v) => !v || v.length >= 16,
      "Sessie-hash lijkt te kort (minimaal 16 tekens)"
    )
    .transform((v) => (v === null || v === "" ? undefined : v)),
  createMethod: z.enum(["create", "clone", "register"]).default("create"),
  defaultUserId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return isFinite(n) ? String(n) : undefined;
    }),
  defaultTariffId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return isFinite(n) ? String(n) : undefined;
    }),
  defaultCloneSourceTrackerId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return isFinite(n) ? String(n) : undefined;
    }),
  endpointPanelAuth: z
    .string()
    .trim()
    .default("/panel/account/auth")
    .refine((v) => navixyEndpointRegex.test(v), navixyEndpointMsg),
  endpointUserAuth: z
    .string()
    .trim()
    .default("/user/session/auth")
    .refine((v) => navixyEndpointRegex.test(v), navixyEndpointMsg),
  endpointPanelTracker: z
    .string()
    .trim()
    .default("/panel/tracker")
    .refine((v) => navixyEndpointRegex.test(v), navixyEndpointMsg),
  endpointUserTracker: z
    .string()
    .trim()
    .default("/user/tracker")
    .refine((v) => navixyEndpointRegex.test(v), navixyEndpointMsg),
}).superRefine((v, ctx) => {
  const issueAt = (path: (string | number)[], msg: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg, path });
  if (v.authMode === "panel") {
    if (!v.panelLogin) issueAt(["panelLogin"], "Panel login is verplicht bij auth mode 'panel'");
  } else if (v.authMode === "user") {
    if (!v.userLogin) issueAt(["userLogin"], "User login is verplicht bij auth mode 'user'");
  } else if (v.authMode === "direct") {
    if (!v.directHash) issueAt(["directHash"], "Sessie-hash is verplicht bij auth mode 'direct'");
  }
});

export type NavixySettingsInput = z.infer<typeof NavixySettingsSchema>;

export interface NavixySettings {
  baseUrl: string;
  authMode: "panel" | "user" | "direct";
  panelLogin?: string | null;
  panelPassword?: string | null;
  userLogin?: string | null;
  userPassword?: string | null;
  directHash?: string | null;
  createMethod: "create" | "clone" | "register";
  defaultUserId?: number | null;
  defaultTariffId?: number | null;
  defaultCloneSourceTrackerId?: number | null;
  endpoints: {
    panelAuth: string;
    userAuth: string;
    panelTracker: string;
    userTracker: string;
  };
}

export interface NavixySettingsMasked {
  baseUrl: string;
  authMode: "panel" | "user" | "direct";
  panelLogin?: string | null;
  panelPasswordMasked?: string | null;
  hasPanelPassword: boolean;
  userLogin?: string | null;
  userPasswordMasked?: string | null;
  hasUserPassword: boolean;
  directHashMasked?: string | null;
  hasDirectHash: boolean;
  createMethod: "create" | "clone" | "register";
  defaultUserId?: number | null;
  defaultTariffId?: number | null;
  defaultCloneSourceTrackerId?: number | null;
  endpoints: {
    panelAuth: string;
    userAuth: string;
    panelTracker: string;
    userTracker: string;
  };
  source: "env" | "db" | "none";
}

