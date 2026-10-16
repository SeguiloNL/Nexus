import { describe, it, expect } from "vitest";
import {
  SIM_ONLY_STEPS,
  TRACKER_STEPS,
  stepsForTrack,
  trackFromOrderType,
  trackSwitchPatch,
  validateTrack,
  type WizardFormShape,
} from "@/app/(app)/activations/_components/activation-wizard-tracks";
import { ActivationOrderProductType } from "@/types/enums";

// ------------------------------------------------------------------
// De activatie-wizard splitst zich in twee volledig gescheiden trajecten.
// Deze tests borgen dat er geen gedeelde/verwarrende stappen en geen
// kruisverbanden (tracker-velden in Sim-only of andersom) ontstaan.
// ------------------------------------------------------------------

const BASE_FORM: WizardFormShape = {
  customerId: "cust_1",
  productId: "prod_1",
  dataPlanId: null,
  trackerId: null,
  simId: "sim_1",
  desiredStartDate: "2026-01-01",
};

describe("Trajectdefinities zijn volledig gescheiden", () => {
  it("TRACKER-traject: 6 stappen met tracker + voertuig en zonder dataplan", () => {
    expect(TRACKER_STEPS.map((s) => s.id)).toEqual([
      "klant",
      "product",
      "tracker",
      "sim",
      "voertuig",
      "controle",
    ]);
    expect(TRACKER_STEPS.some((s) => s.id === "dataplan")).toBe(false);
  });

  it("SIM_ONLY-traject: 4 stappen met dataplan en zonder tracker/voertuig/product", () => {
    expect(SIM_ONLY_STEPS.map((s) => s.id)).toEqual([
      "klant",
      "dataplan",
      "sim",
      "controle",
    ]);
    const ids = SIM_ONLY_STEPS.map((s) => s.id);
    expect(ids).not.toContain("tracker");
    expect(ids).not.toContain("voertuig");
    expect(ids).not.toContain("product");
  });

  it("Beide trajecten starten met klant en eindigen met controle", () => {
    for (const steps of [TRACKER_STEPS, SIM_ONLY_STEPS]) {
      expect(steps[0].id).toBe("klant");
      expect(steps[steps.length - 1].id).toBe("controle");
    }
  });

  it("stepsForTrack geeft per traject alleen de eigen stappen", () => {
    expect(stepsForTrack("TRACKER").map((s) => s.id)).toEqual(
      TRACKER_STEPS.map((s) => s.id),
    );
    expect(stepsForTrack("SIM_ONLY").map((s) => s.id)).toEqual(
      SIM_ONLY_STEPS.map((s) => s.id),
    );
    expect(stepsForTrack(null)).toEqual([]);
  });
});

describe("trackFromOrderType — traject wordt bepaald door de order", () => {
  it("SIM_ONLY_DATA → SIM_ONLY traject", () => {
    expect(trackFromOrderType(ActivationOrderProductType.SIM_ONLY_DATA)).toBe(
      "SIM_ONLY",
    );
  });

  it("TRACKER_WITH_SIM → TRACKER traject", () => {
    expect(trackFromOrderType(ActivationOrderProductType.TRACKER_WITH_SIM)).toBe(
      "TRACKER",
    );
  });

  it("Ontbrekend orderType → (nog) geen traject", () => {
    expect(trackFromOrderType(null)).toBeNull();
    expect(trackFromOrderType(undefined)).toBeNull();
  });
});

describe("trackSwitchPatch — geen kruisverbanden bij het kiezen van een traject", () => {
  const dirty = {
    dataPlanId: "dp_1",
    trackerId: "trk_1",
    vehicleId: "veh_1",
  };

  it("Sim-only leegt tracker en voertuig en behoudt het dataplan", () => {
    const patch = trackSwitchPatch("SIM_ONLY", dirty);
    expect(patch.orderType).toBe(ActivationOrderProductType.SIM_ONLY_DATA);
    expect(patch.dataPlanId).toBe("dp_1");
    expect(patch.trackerId).toBeNull();
    expect(patch.vehicleId).toBeNull();
  });

  it("Tracker leegt het dataplan en behoudt tracker en voertuig", () => {
    const patch = trackSwitchPatch("TRACKER", dirty);
    expect(patch.orderType).toBe(ActivationOrderProductType.TRACKER_WITH_SIM);
    expect(patch.dataPlanId).toBeNull();
    expect(patch.trackerId).toBe("trk_1");
    expect(patch.vehicleId).toBe("veh_1");
  });
});

describe("validateTrack — traject-specifieke eisen zonder kruisverbanden", () => {
  it("Sim-only vraagt nooit om een tracker", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, trackerId: null },
      "SIM_ONLY",
    );
    expect(isReadyErrors.join("|")).not.toMatch(/tracker/i);
    expect(Object.values(stepErrors).flat().join("|")).not.toMatch(/tracker/i);
  });

  it("Sim-only: ontbrekend dataplan wordt op stap 2 gemeld", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, dataPlanId: null, productId: "" },
      "SIM_ONLY",
    );
    expect(stepErrors[2]).toBeDefined();
    expect(isReadyErrors).toContain("Dataplan ontbreekt (Sim-only vereist).");
  });

  it("Sim-only: geldige invoer (klant, product, dataplan, sim, datum) is foutloos", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, dataPlanId: "dp_1" },
      "SIM_ONLY",
    );
    expect(isReadyErrors).toEqual([]);
    expect(stepErrors).toEqual({});
  });

  it("Sim-only: SIM is stap 3", () => {
    const { stepErrors } = validateTrack(
      { ...BASE_FORM, dataPlanId: "dp_1", simId: null },
      "SIM_ONLY",
    );
    expect(stepErrors[3]).toBeDefined();
    expect(stepErrors[4]).toBeUndefined();
  });

  it("Tracker vraagt nooit om een dataplan", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, dataPlanId: null },
      "TRACKER",
    );
    expect(isReadyErrors.join("|")).not.toMatch(/dataplan/i);
    expect(Object.values(stepErrors).flat().join("|")).not.toMatch(/dataplan/i);
  });

  it("Tracker: ontbrekende tracker wordt op stap 3 gemeld, SIM op stap 4", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, trackerId: null, simId: null },
      "TRACKER",
    );
    expect(stepErrors[3]).toBeDefined();
    expect(stepErrors[4]).toBeDefined();
    expect(isReadyErrors).toContain("Tracker ontbreekt.");
    expect(isReadyErrors).toContain("SIM ontbreekt.");
  });

  it("Tracker: geldige invoer (klant, product, tracker, sim, datum) is foutloos", () => {
    const { stepErrors, isReadyErrors } = validateTrack(
      { ...BASE_FORM, trackerId: "trk_1" },
      "TRACKER",
    );
    expect(isReadyErrors).toEqual([]);
    expect(stepErrors).toEqual({});
  });

  it("Ontbrekende klant wordt in beide trajecten op stap 1 gemeld", () => {
    for (const track of ["TRACKER", "SIM_ONLY"] as const) {
      const { stepErrors, isReadyErrors } = validateTrack(
        { ...BASE_FORM, customerId: "", trackerId: "trk_1", dataPlanId: "dp_1" },
        track,
      );
      expect(stepErrors[1]).toEqual(["Kies een klant."]);
      expect(isReadyErrors).toContain("Klant ontbreekt.");
    }
  });

  it("Zonder gekozen traject zijn er nog geen eisen", () => {
    const { stepErrors, isReadyErrors } = validateTrack(BASE_FORM, null);
    expect(stepErrors).toEqual({});
    expect(isReadyErrors).toEqual([]);
  });
});
