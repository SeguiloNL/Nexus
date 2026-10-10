/**
 * Modulair Leverancierssysteem — Capabilities
 * ----------------------------------------------
 * Iedere SimProviderAdapter declareert een `capabilities` record.
 * De centrale applicatie controleert deze vóór het aanroepen van acties
 * en gooit een ProviderCapabilityNotSupportedError wanneer deze ontbreekt.
 *
 * Dit is een expliciete "opt-in per functionaliteit". Voeg nieuwe capability
 * alleen toe als het ook daadwerkelijk in de centrale logica wordt gecheckt.
 */

export type SimProviderCapability =
  | 'listSims'
  | 'getSimStatus'
  | 'getSimStatusFast'
  | 'activateSim'
  | 'deactivateSim'
  | 'suspendSim'
  | 'unsuspendSim'
  | 'subscribeToProduct'
  | 'precheckProductAvailability'
  | 'getAssetByIccid'
  | 'purgeAsset'
  | 'syncUsage'
  | 'testConnection'
  | 'supportsIdempotency'
  | 'supportsWebhooks'
  | 'supportsDefaultProducts';

export type SimProviderCapabilities = Record<SimProviderCapability, boolean>;

/**
 * Convenience-helpers. Nieuwe adapters beginnen idealiter met een
 * NONE record en vullen per capability true in wanneer geïmplementeerd.
 */
export const PROVIDER_CAPABILITIES_NONE: SimProviderCapabilities = {
  listSims: false,
  getSimStatus: false,
  getSimStatusFast: false,
  activateSim: false,
  deactivateSim: false,
  suspendSim: false,
  unsuspendSim: false,
  subscribeToProduct: false,
  precheckProductAvailability: false,
  getAssetByIccid: false,
  purgeAsset: false,
  syncUsage: false,
  testConnection: false,
  supportsIdempotency: false,
  supportsWebhooks: false,
  supportsDefaultProducts: false,
};
