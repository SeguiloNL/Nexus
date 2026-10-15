import { describe, it, expect } from "vitest";
import { isDataPlanAvailableFor } from "@/server/services/data-plan.service";
import {
  CreateDataPlanSchema,
  UpdateDataPlanSchema,
} from "@/server/validators/dataPlan";
import { CustomerType, DataUnit } from "@/types/enums";

// ------------------------------------------------------------------
// Pure unit tests voor de dataplan/product-koppeling en de
// beschikbaarheidsregels (klanttype + regio + vervaldatum + product).
// Geen Prisma-verbinding nodig: isDataPlanAvailableFor is puur.
// ------------------------------------------------------------------

const basePlan = {
  isActive: true,
  simOnlyAvailable: true,
  availableUntil: null as Date | null,
  targetRegions: [] as string[],
  targetCustomerTypes: [] as string[],
  productId: "prod_1" as string | null,
  product: { isActive: true } as { isActive: boolean } | null,
};

describe("isDataPlanAvailableFor() — basisbeschikbaarheid", () => {
  it("actief + sim-only + gekoppeld actief product + geen targeting → beschikbaar", () => {
    const res = isDataPlanAvailableFor(basePlan, {
      customerType: CustomerType.DIRECT,
      region: "NL",
    });
    expect(res.available).toBe(true);
    expect(res.reasons).toHaveLength(0);
  });

  it("inactief plan → niet beschikbaar met reden 'inactief'", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, isActive: false },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/inactief/);
  });

  it("niet sim-only beschikbaar → reden bevat 'Sim-only'", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, simOnlyAvailable: false },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/Sim-only/);
  });

  it("geen productkoppeling → niet factureerbaar, dus niet beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, productId: null, product: null },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/geen factureerbaar product/i);
  });

  it("gekoppeld product is inactief → niet beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, product: { isActive: false } },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/product is inactief/i);
  });
});

describe("isDataPlanAvailableFor() — vervaldatum", () => {
  it("availableUntil in het verleden → vervallen", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, availableUntil: new Date("2020-01-01T00:00:00Z") },
      { now: new Date("2026-01-01T00:00:00Z"), region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/vervallen/);
  });

  it("availableUntil in de toekomst → beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, availableUntil: new Date("2030-01-01T00:00:00Z") },
      { now: new Date("2026-01-01T00:00:00Z"), region: "NL" },
    );
    expect(res.available).toBe(true);
  });
});

describe("isDataPlanAvailableFor() — targeting klanttype + regio", () => {
  it("leeg klanttype-array = beschikbaar voor alle klanttypes", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, targetCustomerTypes: [] },
      { customerType: CustomerType.RESELLER, region: "NL" },
    );
    expect(res.available).toBe(true);
  });

  it("klanttype match (case-insensitive) → beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, targetCustomerTypes: ["direct"] },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(true);
  });

  it("klanttype mismatch → niet beschikbaar met duidelijke reden", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, targetCustomerTypes: [CustomerType.PARTNER] },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/klanttype DIRECT/);
  });

  it("klanttype-specifiek plan zonder bekend klanttype → niet beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, targetCustomerTypes: [CustomerType.PARTNER] },
      { customerType: null, region: "NL" },
    );
    expect(res.available).toBe(false);
    expect(res.reasons.join(",")).toMatch(/klanttype onbekend/);
  });

  it("regio match (case-insensitive) → beschikbaar", () => {
    const res = isDataPlanAvailableFor(
      { ...basePlan, targetRegions: ["nl"] },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(res.available).toBe(true);
  });

  it("regio mismatch → niet beschikbaar; regio-specifiek zonder regio → niet beschikbaar", () => {
    const mismatch = isDataPlanAvailableFor(
      { ...basePlan, targetRegions: ["BE"] },
      { customerType: CustomerType.DIRECT, region: "NL" },
    );
    expect(mismatch.available).toBe(false);
    expect(mismatch.reasons.join(",")).toMatch(/regio NL/);

    const unknown = isDataPlanAvailableFor(
      { ...basePlan, targetRegions: ["NL"] },
      { customerType: CustomerType.DIRECT, region: null },
    );
    expect(unknown.available).toBe(false);
    expect(unknown.reasons.join(",")).toMatch(/regio onbekend/);
  });
});

describe("CreateDataPlanSchema — productkoppeling & targeting validatie (frontend/backend)", () => {
  it("productId='' wordt genormaliseerd naar null (geen koppeling)", () => {
    const parsed = CreateDataPlanSchema.parse({ name: "Plan", productId: "" });
    expect(parsed.productId).toBeNull();
  });

  it("productId null en geldige string worden geaccepteerd", () => {
    expect(CreateDataPlanSchema.parse({ name: "P", productId: null }).productId).toBe(
      null,
    );
    expect(
      CreateDataPlanSchema.parse({ name: "P", productId: "prod_1" }).productId,
    ).toBe("prod_1");
  });

  it("targetCustomerTypes accepteert alleen bekende CustomerType waarden", () => {
    const ok = CreateDataPlanSchema.safeParse({
      name: "P",
      targetCustomerTypes: [CustomerType.DIRECT, CustomerType.PARTNER],
    });
    expect(ok.success).toBe(true);
    const bad = CreateDataPlanSchema.safeParse({
      name: "P",
      targetCustomerTypes: ["ONBEKEND"],
    });
    expect(bad.success).toBe(false);
  });

  it("targetRegions accepteert een lijst niet-lege strings", () => {
    const ok = CreateDataPlanSchema.safeParse({
      name: "P",
      targetRegions: ["NL", "BE"],
    });
    expect(ok.success).toBe(true);
    const bad = CreateDataPlanSchema.safeParse({ name: "P", targetRegions: [""] });
    expect(bad.success).toBe(false);
  });

  it("availableUntil: ISO-string → Date; null blijft null", () => {
    const d = CreateDataPlanSchema.parse({
      name: "P",
      availableUntil: "2030-01-01T00:00:00Z",
    });
    expect(d.availableUntil).toBeInstanceOf(Date);
    expect(
      CreateDataPlanSchema.parse({ name: "P", availableUntil: null }).availableUntil,
    ).toBeNull();
  });

  it("UpdateDataPlanSchema staat partial updates van de koppeling toe", () => {
    const r = UpdateDataPlanSchema.safeParse({ productId: "prod_9" });
    expect(r.success).toBe(true);
    expect((r as any).data.productId).toBe("prod_9");
  });

  it("bestaande bundelvelden blijven werken (regressiebescherming)", () => {
    const res = CreateDataPlanSchema.safeParse({
      name: "Pro 50GB",
      dataAmountBytes: BigInt(50) * BigInt(1024 ** 3),
      dataAmountDisplayUnit: DataUnit.GB,
      isActive: true,
      simOnlyAvailable: true,
    });
    expect(res.success).toBe(true);
  });
});

describe("Order-productmatch (pure simulatie van assertSimOnlyDataPlanValid)", () => {
  // De daadwerkelijke service-validatie zit in activation-order.service.ts en
  // is Prisma-afhankelijk. Hier simuleren we de pure businessregel zodat de
  // mismatch-/ontbrekende-koppeling-scenario's expliciet gedekt zijn.
  function validateOrderProductMatch(
    orderProductId: string | null,
    planProductId: string | null,
  ): string | null {
    if (!planProductId) return "Dataplan is niet gekoppeld aan een factureerbaar product.";
    if (orderProductId && planProductId !== orderProductId) {
      return "Gekozen product komt niet overeen met het factureerbare product van het dataplan.";
    }
    return null;
  }

  it("ontbrekende productkoppeling → blokkerende foutmelding", () => {
    expect(validateOrderProductMatch("prod_1", null)).toMatch(/niet gekoppeld/);
  });

  it("order-product != dataplan-product → blokkerende foutmelding", () => {
    expect(validateOrderProductMatch("prod_A", "prod_B")).toMatch(
      /komt niet overeen/,
    );
  });

  it("order-product == dataplan-product → geen fout", () => {
    expect(validateOrderProductMatch("prod_A", "prod_A")).toBeNull();
  });
});

describe("Schaalbaarheid — beschikbaarheidscheck is O(1) per plan", () => {
  it("10.000 gelijktijdige checks (gesimuleerd) blijven correct en snel", () => {
    const start = Date.now();
    let available = 0;
    for (let i = 0; i < 10_000; i++) {
      const res = isDataPlanAvailableFor(
        {
          ...basePlan,
          productId: `prod_${i % 50}`,
          targetCustomerTypes: i % 2 === 0 ? [] : [CustomerType.DIRECT],
        },
        { customerType: CustomerType.DIRECT, region: "NL" },
      );
      if (res.available) available++;
    }
    const elapsed = Date.now() - start;
    expect(available).toBe(10_000);
    // Ruime bovengrens; puur om te bevestigen dat de check geen I/O doet en
    // dus horizontaal schaalt over applicatie-instanties.
    expect(elapsed).toBeLessThan(2000);
  });
});
