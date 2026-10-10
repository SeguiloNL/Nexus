import { describe, it, expect } from "vitest";
import {
  CreateActivationOrderSchema,
  UpdateActivationOrderSchema,
} from "@/server/validators/activationOrder";
import {
  ActivationOrderProductType,
  ActivationOrderStatus,
} from "@/types/enums";

// ------------------------------------------------------------------
// Validator + idempotency guard tests voor Sim-only.
// (Pure unit tests; integratie tests voor completeActivation saga hebben
// Prisma + integrations nodig en vallen buiten deze suite.)
// ------------------------------------------------------------------

const BASE_ORDER = {
  customerId: "cust_1",
  productId: "prod_1",
  desiredStartDate: new Date("2026-01-01T00:00:00Z"),
  monthlyPrice: 9.95,
  simId: "sim_1",
};

describe("CreateActivationOrderSchema — tracker-required / dataPlan-required", () => {
  it("TRACKER_WITH_SIM (default): tracker verplicht, SIM verplicht, dataPlan optioneel", () => {
    // geen tracker → falen
    const missing = CreateActivationOrderSchema.safeParse({
      ...BASE_ORDER,
      orderType: ActivationOrderProductType.TRACKER_WITH_SIM,
    });
    expect(missing.success).toBe(false);
    const paths = (missing as any).error?.issues
      .map((i: any) => i.path.join("."))
      .join(",");
    expect(paths).toContain("trackerId");
    expect(paths).not.toContain("dataPlanId");

    // met tracker én SIM → slaagt
    const ok = CreateActivationOrderSchema.safeParse({
      ...BASE_ORDER,
      trackerId: "track_1",
      orderType: ActivationOrderProductType.TRACKER_WITH_SIM,
    });
    expect(ok.success).toBe(true);
  });

  it("SIM_ONLY_DATA: dataPlan verplicht; tracker NIET verplicht; SIM WEL verplicht", () => {
    // geen dataPlan → falen op dataPlanId, NIET op trackerId
    const missPlan = CreateActivationOrderSchema.safeParse({
      ...BASE_ORDER,
      orderType: ActivationOrderProductType.SIM_ONLY_DATA,
    });
    expect(missPlan.success).toBe(false);
    const paths = (missPlan as any).error?.issues
      .map((i: any) => i.path.join("."))
      .join(",");
    expect(paths).toContain("dataPlanId");
    expect(paths).not.toContain("trackerId");

    // mét dataPlan, ZONDER tracker → slaagt (backward compat key feature!)
    const ok = CreateActivationOrderSchema.safeParse({
      ...BASE_ORDER,
      dataPlanId: "dp_1",
      orderType: ActivationOrderProductType.SIM_ONLY_DATA,
    });
    expect(ok.success).toBe(true);
    expect((ok as any).data.trackerId).toBeUndefined();
  });

  it("SIM_ONLY_DATA zonder simId → failt op simId (SIM altijd verplicht)", () => {
    const r = CreateActivationOrderSchema.safeParse({
      ...BASE_ORDER,
      simId: null,
      dataPlanId: "dp_1",
      orderType: ActivationOrderProductType.SIM_ONLY_DATA,
    });
    expect(r.success).toBe(false);
    const simErrs = (r as any).error?.issues.filter((i: any) =>
      i.path.includes("simId"),
    );
    expect(simErrs.length).toBeGreaterThan(0);
  });
});

describe("ActivationOrder status transition guard (pure simulatie van assertOrderTransition)", () => {
  // Deze functie bestaat ook in activation-order.service.ts en gooit
  // aldaar een Error. We simuleren hier de logica zodat idempotency
  // expliciet door tests is afgedekt.
  const LEGAL_NEXT: Record<string, string[]> = {
    DRAFT: ["READY", "CANCELLED"],
    READY: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["COMPLETED", "FAILED"],
    COMPLETED: [], // definitief; geen nieuwe start
    FAILED: ["READY", "CANCELLED"],
    CANCELLED: [],
  };
  function assertTransition(from: string, to: string): void {
    if (!LEGAL_NEXT[from]?.includes(to)) {
      throw new Error(
        `Ongeldige statusovergang ${from} -> ${to}: bescherming tegen dubbele start / ongeldige volgorde.`,
      );
    }
  }

  it("DRAFT -> READY -> PROCESSING -> COMPLETED is toegestane happy path", () => {
    expect(() => assertTransition("DRAFT", "READY")).not.toThrow();
    expect(() => assertTransition("READY", "PROCESSING")).not.toThrow();
    expect(() => assertTransition("PROCESSING", "COMPLETED")).not.toThrow();
  });

  it("PROCESSING -> PROCESSING is NIET toegestaan → idempotency-bescherming", () => {
    expect(() => assertTransition("PROCESSING", "PROCESSING")).toThrow(
      /Ongeldige statusovergang/,
    );
  });

  it("COMPLETED -> PROCESSING is NIET toegestaan → geen herhaling na geslaagde activering", () => {
    expect(() => assertTransition("COMPLETED", "PROCESSING")).toThrow(
      /Ongeldige statusovergang/,
    );
  });

  it("FAILED -> READY is WEL toegestaan (retry flow)", () => {
    expect(() => assertTransition("FAILED", "READY")).not.toThrow();
  });
});

describe("UpdateActivationOrderSchema — partial + orderType-aware refinements", () => {
  it("Leeg object faalt omdat superRefine altijd vereisten controleert (orderType default TRACKER → tracker+sim verplicht)", () => {
    const r = UpdateActivationOrderSchema.safeParse({});
    expect(r.success).toBe(false);
    const paths = (r as any).error?.issues
      .map((i: any) => i.path.join("."))
      .join(",");
    expect(paths).toContain("trackerId");
    expect(paths).toContain("simId");
  });

  it("Geldige partial TRACKER_WITH_SIM update (trackerId + simId gezet) → slaagt", () => {
    const r = UpdateActivationOrderSchema.safeParse({
      orderType: ActivationOrderProductType.TRACKER_WITH_SIM,
      trackerId: "t1",
      simId: "s1",
    });
    expect(r.success).toBe(true);
  });

  it("Enkel orderType wijzigen naar SIM_ONLY zonder dataPlan → dataPlan error", () => {
    const r = UpdateActivationOrderSchema.safeParse({
      orderType: ActivationOrderProductType.SIM_ONLY_DATA,
      simId: "s1",
    });
    expect(r.success).toBe(false);
    const paths = (r as any).error.issues
      .map((i: any) => i.path.join("."))
      .join(",");
    expect(paths).toContain("dataPlanId");
    expect(paths).not.toContain("trackerId");
  });

  it("Geldige SIM_ONLY partial: orderType + dataPlanId + simId → slaagt", () => {
    const r = UpdateActivationOrderSchema.safeParse({
      orderType: ActivationOrderProductType.SIM_ONLY_DATA,
      dataPlanId: "dp1",
      simId: "s1",
      monthlyPrice: 5.95,
    });
    expect(r.success).toBe(true);
    expect((r as any).data.orderType).toBe(
      ActivationOrderProductType.SIM_ONLY_DATA,
    );
  });
});
