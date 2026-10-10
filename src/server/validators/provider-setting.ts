import { z } from "zod";

/**
 * Generieke validatorschema's voor provider-settings.
 * Nieuwe leveranciers gebruiken plat {subkey: value}.
 * Bestaande Simhuis-schema blijft apart bestaan (setting.ts) i.v.m. backward
 * compatibiliteit en custom enum waardes.
 *
 * De optionele `providerKey`-parameter wordt hier niet gevalideerd aan de hand
 * van de adapter; deze functie bouwt enkel een generiek schema dat de basis
 * AppSetting-keys valideert (URL-formaat, minimale lengte wachtwoord, enz.).
 */

const endpointRegex = /^\/[A-Za-z0-9_/-]*$/;
const endpointMsg =
  "Endpoint moet beginnen met / en mag alleen letters, cijfers, _, - en / bevatten";

const endpointShape = z.object({
  login: z
    .string()
    .trim()
    .optional()
    .default("/auth/login")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  sims: z
    .string()
    .trim()
    .optional()
    .default("/sims")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  simActivate: z
    .string()
    .trim()
    .optional()
    .default("/sims/activate")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  simDeactivate: z
    .string()
    .trim()
    .optional()
    .default("/sims/deactivate")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  simSuspend: z
    .string()
    .trim()
    .optional()
    .default("/sims/suspend")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  simUnsuspend: z
    .string()
    .trim()
    .optional()
    .default("/sims/unsuspend")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  subscribe: z
    .string()
    .trim()
    .optional()
    .default("/sims/subscribe")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  usage: z
    .string()
    .trim()
    .optional()
    .default("/sims/usage")
    .refine((v) => endpointRegex.test(v), endpointMsg),
  asset: z
    .string()
    .trim()
    .optional()
    .default("/sims/asset")
    .refine((v) => endpointRegex.test(v), endpointMsg),
});

/**
 * Generiek provider-settings schema.
 * Gebruikt:
 *  - In het beheerscherm /admin/providers bij het opslaan van settings.
 *  - In unittests (provider-setting.test.ts) voor validatie van edge cases.
 *
 * Velden worden plat opgeslagen als `{providerKey}.{subkey}` in AppSetting.
 * Het `password`-veld is optioneel (omdat bij "alleen username aanpassen"
 * wachtwoord gemaskeerd terugkomt). De eis "wachtwoord aanwezig" wordt
 * gecontroleerd op niveau van `isConfigured()` in de adapter, niet in Zod.
 */
export function buildProviderSettingsSchema(_providerKey: string) {
  return z.object({
    baseUrl: z
      .string()
      .trim()
      .min(1, "Basis URL is verplicht")
      .url("Ongeldige URL (inclusief https:// of http://)"),
    authMode: z.enum(["basic", "bearer", "apikey", "none"]).default("basic"),
    username: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .refine(
        (v) => v === null || v === undefined || v.length >= 2,
        "Gebruikersnaam is te kort (minimaal 2 tekens)"
      ),
    password: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .refine(
        (v) => v === null || v === undefined || v.length >= 4,
        "Wachtwoord is te kort (minimaal 4 tekens)"
      ),
    apiToken: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .refine(
        (v) => v === null || v === undefined || v.length >= 4,
        "API-token is te kort (minimaal 4 tekens)"
      ),
    clientId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    clientSecret: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .refine(
        (v) => v === null || v === undefined || v.length >= 4,
        "Client secret is te kort (minimaal 4 tekens)"
      ),
    webhookSecret: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    resellerId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    defaultOfferId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    defaultPlanId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    defaultProductName: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v === "" ? null : v)),
    endpoints: endpointShape.partial().optional(),
  });
}

export type GenericProviderSettingsInput = z.infer<
  ReturnType<typeof buildProviderSettingsSchema>
>;

/**
 * Converteer het output-object van buildProviderSettingsSchema() naar een
 * plat ProviderSettingsMap (subkey → value), geschikt om door te geven aan
 * saveProviderSettings().
 *
 * Nested `endpoints` wordt platgeslagen naar "endpoint.login", enz.
 */
export function flattenProviderSettings(
  input: GenericProviderSettingsInput
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(input)) {
    if (key === "endpoints") continue;
    if (val === null || val === undefined) {
      (out as any)[key] = undefined;
    } else {
      (out as any)[key] = String(val);
    }
  }
  const endpoints = (input as any).endpoints as Record<string, string> | undefined;
  if (endpoints) {
    for (const [epKey, epVal] of Object.entries(endpoints)) {
      out[`endpoint.${epKey}`] = epVal ? String(epVal) : undefined;
    }
  }
  return out;
}
