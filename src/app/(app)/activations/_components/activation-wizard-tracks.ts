import { ActivationOrderProductType } from "@/types/enums";

/**
 * Pure configuratie en logica voor de twee volledig gescheiden trajecten van de
 * activatie-wizard. Bewust vrij van React, zodat de trajecten los getest kunnen
 * worden en er geen kruisverbanden tussen de trajecten kunnen ontstaan.
 */

export type WizardTrack = "TRACKER" | "SIM_ONLY";

export type StepId =
  | "klant"
  | "product"
  | "dataplan"
  | "tracker"
  | "sim"
  | "voertuig"
  | "controle";

export type WizardStep = {
  id: StepId;
  label: string;
  description: string;
};

export const TRACKER_STEPS: WizardStep[] = [
  {
    id: "klant",
    label: "Klant",
    description: "Kies de hoofdklant en, indien van toepassing, de subklant.",
  },
  {
    id: "product",
    label: "Product en facturatie",
    description:
      "Kies het factureerbare product voor de tracker en stel de startdatum en prijs in.",
  },
  {
    id: "tracker",
    label: "Tracker",
    description: "Kies een fysieke tracker uit de voorraad die geactiveerd wordt.",
  },
  {
    id: "sim",
    label: "SIM-kaart",
    description: "Kies de SIM-kaart die met de tracker wordt geactiveerd.",
  },
  {
    id: "voertuig",
    label: "Voertuig",
    description: "Koppel optioneel een voertuig van de gekozen klant.",
  },
  {
    id: "controle",
    label: "Controle",
    description: "Controleer alle gegevens en bevestig de activatie.",
  },
];

export const SIM_ONLY_STEPS: WizardStep[] = [
  {
    id: "klant",
    label: "Klant",
    description: "Kies de hoofdklant en, indien van toepassing, de subklant.",
  },
  {
    id: "dataplan",
    label: "Dataplan en facturatie",
    description:
      "Kies een actief Sim-only dataplan. Het factureerbare product en de prijs worden hiervan afgeleid.",
  },
  {
    id: "sim",
    label: "SIM-kaart",
    description: "Kies de losse datasimkaart die geactiveerd wordt.",
  },
  {
    id: "controle",
    label: "Controle",
    description: "Controleer alle gegevens en bevestig de activatie.",
  },
];

export function stepsForTrack(track: WizardTrack | null): WizardStep[] {
  if (track === "SIM_ONLY") return SIM_ONLY_STEPS;
  if (track === "TRACKER") return TRACKER_STEPS;
  return [];
}

export function trackFromOrderType(
  orderType: ActivationOrderProductType | string | null | undefined,
): WizardTrack | null {
  if (!orderType) return null;
  return orderType === ActivationOrderProductType.SIM_ONLY_DATA
    ? "SIM_ONLY"
    : "TRACKER";
}

export type WizardFormShape = {
  customerId: string;
  productId: string;
  dataPlanId: string | null;
  trackerId: string | null;
  simId: string | null;
  desiredStartDate: string;
};

export type TrackFormPatch = {
  orderType: ActivationOrderProductType;
  dataPlanId: string | null;
  trackerId: string | null;
  vehicleId: string | null;
};

/**
 * Patch die wordt toegepast bij het (onomkeerbaar) kiezen van een traject.
 * Velden die niet bij het gekozen traject horen worden expliciet geleegd, zodat
 * er geen kruisverbanden tussen de trajecten ontstaan.
 */
export function trackSwitchPatch(
  track: WizardTrack,
  current: Pick<WizardFormShape, "dataPlanId" | "trackerId"> & {
    vehicleId: string | null;
  },
): TrackFormPatch {
  return {
    orderType:
      track === "SIM_ONLY"
        ? ActivationOrderProductType.SIM_ONLY_DATA
        : ActivationOrderProductType.TRACKER_WITH_SIM,
    dataPlanId: track === "SIM_ONLY" ? current.dataPlanId : null,
    trackerId: track === "SIM_ONLY" ? null : current.trackerId,
    vehicleId: track === "SIM_ONLY" ? null : current.vehicleId,
  };
}

export type TrackValidation = {
  stepErrors: Record<number, string[]>;
  isReadyErrors: string[];
};

/**
 * Traject-specifieke validatie. Er worden uitsluitend eisen gesteld aan velden
 * die bij het gekozen traject horen: een tracker-traject vraagt nooit om een
 * dataplan en een Sim-only traject vraagt nooit om een tracker of voertuig.
 */
export function validateTrack(
  form: WizardFormShape,
  track: WizardTrack | null,
): TrackValidation {
  const stepErrors: Record<number, string[]> = {};
  const isReadyErrors: string[] = [];
  if (track === null) return { stepErrors, isReadyErrors };

  const steps = stepsForTrack(track);
  const stepNumber = (id: StepId) =>
    steps.findIndex((s) => s.id === id) + 1;

  if (!form.customerId) {
    stepErrors[stepNumber("klant")] = ["Kies een klant."];
    isReadyErrors.push("Klant ontbreekt.");
  }

  if (track === "SIM_ONLY") {
    const billingErrors: string[] = [];
    if (!form.dataPlanId) billingErrors.push("Kies een actief dataplan voor Sim-only.");
    if (!form.productId)
      billingErrors.push(
        "Het gekozen dataplan is niet aan een factureerbaar product gekoppeld.",
      );
    if (!form.desiredStartDate) billingErrors.push("Gewenste startdatum ontbreekt.");
    if (billingErrors.length) stepErrors[stepNumber("dataplan")] = billingErrors;

    if (!form.dataPlanId) isReadyErrors.push("Dataplan ontbreekt (Sim-only vereist).");
    if (!form.productId) isReadyErrors.push("Factureerbaar product ontbreekt.");
    if (!form.desiredStartDate) isReadyErrors.push("Gewenste startdatum ontbreekt.");
    if (!form.simId) {
      stepErrors[stepNumber("sim")] = ["Kies SIM (IN_STOCK/RESERVED)."];
      isReadyErrors.push("SIM ontbreekt.");
    }
    return { stepErrors, isReadyErrors };
  }

  const billingErrors: string[] = [];
  if (!form.productId) billingErrors.push("Kies product.");
  if (!form.desiredStartDate) billingErrors.push("Gewenste startdatum ontbreekt.");
  if (billingErrors.length) stepErrors[stepNumber("product")] = billingErrors;

  if (!form.productId) isReadyErrors.push("Product ontbreekt.");
  if (!form.desiredStartDate) isReadyErrors.push("Gewenste startdatum ontbreekt.");
  if (!form.trackerId) {
    stepErrors[stepNumber("tracker")] = ["Kies tracker (IN_STOCK/RESERVED)."];
    isReadyErrors.push("Tracker ontbreekt.");
  }
  if (!form.simId) {
    stepErrors[stepNumber("sim")] = ["Kies SIM (IN_STOCK/RESERVED)."];
    isReadyErrors.push("SIM ontbreekt.");
  }
  return { stepErrors, isReadyErrors };
}
