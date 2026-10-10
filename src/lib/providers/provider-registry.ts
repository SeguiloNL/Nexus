import type { UserRole, RoleScope } from "@/types/enums";
import { RoleScope as _RoleScope } from "@/types/enums";

/**
 * ACHTERWAARTS COMPATIBELE wrapper (Fase 3e).
 *
 * Oorspronkelijk was dit de ENIGE provider-registry. Sinds de introductie
 * van het modulaire leverancierssysteem (Fase 2) is de echte bron van
 * waarheid `@/server/providers/registry.ts` (SimProviderRegistry).
 *
 * Dit bestand blijft bestaan voor bestaande callers in de UI die alleen
 * tekstuele labels nodig hebben. Nieuwe code moet — waar mogelijk — de
 * server-gebaseerde registry gebruiken (via initializeProviderRegistry +
 * providerRegistry.listAll() / resolveForSim()).
 *
 * `SimProviderId` is verbreden van de literal `"simhuis"` naar een
 * generic string-brand, zodat bestaande callers met "simhuis" nog steeds
 * compileren EN nieuwe providerKeys ook werken.
 */
export type SimProviderId = string & { readonly __brand?: "providerKey" };

export interface SimProviderDefinition {
  readonly providerId: SimProviderId;
  readonly displayNameForAdmins: string;
  readonly displayNameGeneric: string;
  readonly labelNounSingular: string;
  readonly labelNounWithArticle: string;
  readonly statusPrefixNl: string;
}

/**
 * Fallback-definitie voor een onbekende provider. Toont generieke
 * "SIM-provider"-tekst zonder de echte leveranciersnaam prijs te geven.
 */
function buildGenericDefinition(providerId: string): SimProviderDefinition {
  const cap =
    providerId.length === 0
      ? "SIM-provider"
      : providerId.charAt(0).toUpperCase() + providerId.slice(1);
  return {
    providerId: providerId as SimProviderId,
    displayNameForAdmins: cap,
    displayNameGeneric: "SIM-provider",
    labelNounSingular: "SIM-provider",
    labelNounWithArticle: "de SIM-provider",
    statusPrefixNl: "SIM-provider",
  };
}

export const SIM_PROVIDER_REGISTRY: Readonly<Record<string, SimProviderDefinition>> = {
  simhuis: {
    providerId: "simhuis" as SimProviderId,
    displayNameForAdmins: "Simhuis",
    displayNameGeneric: "SIM-provider",
    labelNounSingular: "SIM-provider",
    labelNounWithArticle: "de SIM-provider",
    statusPrefixNl: "SIM-provider",
  },
} as const;

export const DEFAULT_SIM_PROVIDER_ID: SimProviderId = "simhuis" as SimProviderId;

export const GENERIC_FALLBACK_PROVIDER_LABEL: Readonly<SimProviderDefinition> = {
  providerId: "simhuis" as SimProviderId,
  displayNameForAdmins: "SIM-provider",
  displayNameGeneric: "SIM-provider",
  labelNounSingular: "SIM-provider",
  labelNounWithArticle: "de SIM-provider",
  statusPrefixNl: "SIM-provider",
} as const;

interface GetSimProviderLabelOpts {
  readonly providerId?: string | null;
  readonly forRole?: UserRole | null;
  readonly scope?: RoleScope | null;
  readonly includeVendorIfAdmin?: boolean;
  readonly withArticle?: boolean;
}

export function resolveSimProviderDefinition(
  providerId?: string | null
): SimProviderDefinition {
  if (!providerId) return SIM_PROVIDER_REGISTRY[DEFAULT_SIM_PROVIDER_ID as string];
  const known = (SIM_PROVIDER_REGISTRY as Record<string, SimProviderDefinition>)[providerId];
  if (known) return known;
  return buildGenericDefinition(providerId);
}

function isInternalAdminScope(scope?: RoleScope | null): boolean {
  return scope === _RoleScope.INTERNAL;
}

export function getSimProviderLabel(
  opts: GetSimProviderLabelOpts = {}
): string {
  const def = resolveSimProviderDefinition(opts.providerId);
  const wantVendor =
    opts.includeVendorIfAdmin === true && isInternalAdminScope(opts.scope);
  if (wantVendor) {
    return opts.withArticle === false
      ? `${def.labelNounSingular} (${def.displayNameForAdmins})`
      : `${def.labelNounWithArticle} (${def.displayNameForAdmins})`;
  }
  return opts.withArticle === false ? def.labelNounSingular : def.labelNounWithArticle;
}

export function getSimProviderStatusVerb(
  opts: GetSimProviderLabelOpts = {}
): string {
  const def = resolveSimProviderDefinition(opts.providerId);
  return def.statusPrefixNl;
}

export function getSimProviderDisplayText(
  providerIdFromSim?: string | null,
  opts: { readonly asAdmin?: boolean } = {}
): string {
  const def = resolveSimProviderDefinition(providerIdFromSim);
  if (opts.asAdmin) return def.displayNameForAdmins;
  return def.labelNounSingular;
}

export const SIM_PROVIDER_UI_LABELS = {
  usageSyncProgress: (opts?: GetSimProviderLabelOpts) =>
    `De meest recente verbruiksgegevens worden voor alle actieve SIM-kaarten opgehaald bij ${getSimProviderLabel(opts)}. Dit kan enkele seconden tot een minuut duren, afhankelijk van het aantal SIMs.`,
  statusUpdatedFromProvider: (opts?: GetSimProviderLabelOpts) =>
    `Status bijgewerkt vanuit ${getSimProviderLabel(opts)}`,
  providerConnectionError: (opts?: GetSimProviderLabelOpts) =>
    `Verbindingsprobleem met ${getSimProviderLabel(opts)}`,
  providerStatusLoading: (opts?: GetSimProviderLabelOpts) =>
    `${getSimProviderStatusVerb(opts)}-status wordt opgehaald…`,
  providerStatusRefreshButtonAria: (opts?: GetSimProviderLabelOpts) =>
    `${getSimProviderStatusVerb(opts)} status verversen`,
} as const;

/**
 * Voeg dynamisch een provider-label toe (voor test/ontwikkelomgevingen).
 * Dit is voornamelijk bedoeld om de UI zonder server-oproep labels te
 * kunnen tonen voor mock/prove providers. Overschrijft nooit Simhuis.
 */
export function registerProviderLabel(def: SimProviderDefinition): void {
  if (def.providerId === "simhuis") return;
  (SIM_PROVIDER_REGISTRY as Record<string, SimProviderDefinition>)[def.providerId as string] =
    def;
}
