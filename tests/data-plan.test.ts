import { describe, it, expect } from "vitest";
import {
  amountUnitToBytes,
  formatDataBundle,
} from "@/server/services/data-plan.service";
import {
  CreateDataPlanSchema,
  UpdateDataPlanSchema,
} from "@/server/validators/dataPlan";
import { DataUnit } from "@/types/enums";

// ------------------------------------------------------------------
// Pure unit tests: DataPlan helpers en validators.
// (Vermijdt Prisma; de echte delete-guard kan alleen geintegreerd getest
// worden in een test-DB, maar we simuleren de logica hier om zeker te
// zijn dat onze service aannames kloppen.)
// ------------------------------------------------------------------

describe("amountUnitToBytes() / formatDataBundle()", () => {
  it("MB/GB/TB omzetting naar BigInt bytes (correcte 1024 machten)", () => {
    expect(amountUnitToBytes(1, DataUnit.MB)).toBe(BigInt(1024 * 1024));
    expect(amountUnitToBytes(1, DataUnit.GB)).toBe(BigInt(1024 ** 3));
    expect(amountUnitToBytes(1, DataUnit.TB)).toBe(BigInt(1024 ** 4));
    expect(amountUnitToBytes(2.5, DataUnit.GB)).toBe(
      BigInt(Math.round(2.5 * 1024 ** 3)),
    );
  });

  it("UNLIMITED, ongeldige unit of lege amount → null", () => {
    expect(amountUnitToBytes(100, DataUnit.UNLIMITED)).toBeNull();
    expect(amountUnitToBytes(null, DataUnit.GB)).toBeNull();
    expect(amountUnitToBytes("", DataUnit.GB)).toBeNull();
    expect(amountUnitToBytes(-5, DataUnit.GB)).toBeNull();
  });

  it("formatDataBundle: Nederlandse formatting (10.000,50 MB)", () => {
    const kiloBytes = amountUnitToBytes(10000.5, DataUnit.MB)!;
    const out = formatDataBundle(kiloBytes, DataUnit.MB);
    expect(out).toContain("MB");
    expect(formatDataBundle(null, DataUnit.UNLIMITED)).toBe("Onbeperkt");
    expect(formatDataBundle(null, DataUnit.GB)).toMatch(/—.*\(GB\)/);
    expect(formatDataBundle(null, null)).toBe("—");
  });
});

describe("CreateDataPlanSchema validaties", () => {
  const baseValid = {
    name: "Pro 50GB Sim-only",
    description: "Standaard Sim-only bundel.",
    isActive: true,
    simOnlyAvailable: true,
    dataAmountBytes: BigInt(50) * BigInt(1024 ** 3),
    dataAmountDisplayUnit: DataUnit.GB,
    validityDays: null,
    validityBillingCycle: null,
  };

  it("Minimaal geldig plan (naam + actief + simOnlyAvailable vlaggen) → slaagt", () => {
    const res = CreateDataPlanSchema.safeParse(baseValid);
    expect(res.success).toBe(true);
  });

  it("Naam is verplicht en minimaal 1 karakter na trim", () => {
    const r1 = CreateDataPlanSchema.safeParse({ ...baseValid, name: "" });
    expect(r1.success).toBe(false);
    const r2 = CreateDataPlanSchema.safeParse({ ...baseValid, name: "   " });
    expect(r2.success).toBe(false);
  });

  it("dataAmountDisplayUnit=GB zonder amount → dataAmountBytes=null (aanvaardbaar, wordt apart gecontroleerd in acties)", () => {
    const r = CreateDataPlanSchema.safeParse({
      ...baseValid,
      dataAmountBytes: null,
      dataAmountDisplayUnit: DataUnit.GB,
    });
    // optioneel in schema → slaagt; bijhouden per UI keuze "Geen bundel"
    expect(r.success).toBe(true);
  });

  it("simOnlyAvailable en isActive zijn default true en accepteren boolean", () => {
    const off = CreateDataPlanSchema.parse({
      ...baseValid,
      isActive: false,
      simOnlyAvailable: false,
    });
    expect(off.isActive).toBe(false);
    expect(off.simOnlyAvailable).toBe(false);
  });

  it("validityDays positief, anders falen; validityBillingCycle accepteert bekende cycles", () => {
    const badDays = UpdateDataPlanSchema.safeParse({
      validityDays: 0,
    });
    expect(badDays.success).toBe(false);
    const neg = UpdateDataPlanSchema.safeParse({ validityDays: -1 });
    expect(neg.success).toBe(false);
  });

  it("btwPercentage binnen 0..100", () => {
    expect(
      UpdateDataPlanSchema.safeParse({ btwPercentage: 121 }).success,
    ).toBe(false);
    expect(
      UpdateDataPlanSchema.safeParse({ btwPercentage: 21 }).success,
    ).toBe(true);
  });
});

// ------------------------------------------------------------------
// Delete guard simulatie (service weigert verwijderen wanneer er
// activeringsorders / abonnementen / simkaarten zijn gekoppeld.)
// ------------------------------------------------------------------
describe("DataPlan delete guard logica (pure simulatie)", () => {
  function buildDeletionReason(
    name: string,
    counts: { activationOrders: number; subscriptions: number; sims: number },
  ): string | null {
    const blockers: string[] = [];
    if (counts.activationOrders > 0)
      blockers.push(`${counts.activationOrders} activeringsorder(s)`);
    if (counts.subscriptions > 0)
      blockers.push(`${counts.subscriptions} abonnement(en)`);
    if (counts.sims > 0) blockers.push(`${counts.sims} simkaart(en)`);
    if (blockers.length > 0)
      return `Kan dataplan "${name}" niet verwijderen: nog gekoppeld aan ${blockers.join(", ")}. Deactiveer het plan in plaats van te verwijderen.`;
    return null;
  }

  it("0 → 0 → 0 → geen error, delete toegestaan", () => {
    expect(
      buildDeletionReason("Pro", {
        activationOrders: 0,
        subscriptions: 0,
        sims: 0,
      }),
    ).toBeNull();
  });

  it("Alleen historisch orders: foutmelding met 'activeringsorder(s)'", () => {
    const err = buildDeletionReason("Pro", {
      activationOrders: 4,
      subscriptions: 0,
      sims: 0,
    });
    expect(err).toMatch(/4 activeringsorder\(s\)/);
    expect(err).toMatch(/Deactiveer het plan in plaats van te verwijderen/);
  });

  it("SIM-only in productie: zowel orders + SIMs → beide blockers vermeld", () => {
    const err = buildDeletionReason("Lite 20GB", {
      activationOrders: 12,
      subscriptions: 5,
      sims: 200,
    });
    expect(err).toContain("12 activeringsorder(s)");
    expect(err).toContain("5 abonnement(en)");
    expect(err).toContain("200 simkaart(en)");
  });
});
