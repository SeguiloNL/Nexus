import { ProductTrack } from "@/types/enums";

/**
 * Trajecten van de activatie-wizard waarin een product gekozen kan worden.
 * Bewust gelijk aan de waarden van `WizardTrack` (activation-wizard-tracks.ts),
 * maar hier zonder afhankelijkheid van React.
 */
export type ProductTrackTarget = "TRACKER" | "SIM_ONLY";

/** Keuzelijst voor het beheerpaneel: waarde + Nederlandse weergavenaam. */
export const PRODUCT_TRACK_OPTIONS: { value: ProductTrack; label: string }[] = [
  { value: ProductTrack.BOTH, label: "Beide trajecten" },
  { value: ProductTrack.SIM_ONLY, label: "Alleen Sim-only datasimkaart" },
  { value: ProductTrack.TRACKER, label: "Alleen Nieuwe tracker met simkaart" },
];

/** Nederlandse weergavenaam van een trajectinstelling. */
export function productTrackLabel(
  track: ProductTrack | string | null | undefined,
): string {
  switch (track) {
    case ProductTrack.SIM_ONLY:
      return "Alleen Sim-only datasimkaart";
    case ProductTrack.TRACKER:
      return "Alleen Nieuwe tracker met simkaart";
    case ProductTrack.BOTH:
    default:
      return "Beide trajecten";
  }
}

/**
 * Bepaalt of een product in het opgegeven traject gekozen mag worden.
 * Een ontbrekende instelling (legacy/undefined) wordt als "BOTH" behandeld,
 * zodat bestaande producten niet onbedoeld verdwijnen.
 */
export function isProductAvailableForTrack(
  track: ProductTrack | string | null | undefined,
  target: ProductTrackTarget,
): boolean {
  if (track == null || track === ProductTrack.BOTH) return true;
  return track === target;
}

/** Foutmelding wanneer een product niet geschikt is voor het gekozen traject. */
export function productTrackMismatchMessage(target: ProductTrackTarget): string {
  return target === "SIM_ONLY"
    ? "Dit product is niet beschikbaar voor het Sim-only datasimkaart-traject."
    : "Dit product is niet beschikbaar voor het Nieuwe tracker met simkaart-traject.";
}
