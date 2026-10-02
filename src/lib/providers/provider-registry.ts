import type { UserRole, RoleScope } from "@/types/enums";
import { RoleScope as _RoleScope } from "@/types/enums";

export type SimProviderId = "simhuis";

export interface SimProviderDefinition {
  readonly providerId: SimProviderId;
  readonly displayNameForAdmins: string;
  readonly displayNameGeneric: string;
  readonly labelNounSingular: string;
  readonly labelNounWithArticle: string;
  readonly statusPrefixNl: string;
}

export const SIM_PROVIDER_REGISTRY: Readonly<Record<SimProviderId, SimProviderDefinition>> = {
  simhuis: {
    providerId: "simhuis",
    displayNameForAdmins: "Simhuis",
    displayNameGeneric: "SIM-provider",
    labelNounSingular: "SIM-provider",
    labelNounWithArticle: "de SIM-provider",
    statusPrefixNl: "SIM-provider",
  },
} as const;

export const DEFAULT_SIM_PROVIDER_ID: SimProviderId = "simhuis";

export const GENERIC_FALLBACK_PROVIDER_LABEL: Readonly<SimProviderDefinition> = {
  providerId: "simhuis",
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
  if (!providerId) return SIM_PROVIDER_REGISTRY[DEFAULT_SIM_PROVIDER_ID];
  const asKnown = providerId as SimProviderId;
  if (Object.prototype.hasOwnProperty.call(SIM_PROVIDER_REGISTRY, asKnown)) {
    return SIM_PROVIDER_REGISTRY[asKnown];
  }
  return GENERIC_FALLBACK_PROVIDER_LABEL;
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
