import { describe, it, expect } from "vitest";
import {
  isPeriodBoundUsageSource,
  formatMonthKey,
  deriveMonthKey,
  buildMonthWindow,
  monthLabelFromKey,
  mergeMonotonicUsage,
  type UsageTotals,
} from "@/server/services/sim-usage-history.service";

// ------------------------------------------------------------------
// Pure unit tests voor de maandhistorie-helpers.
// (Vermijdt Prisma-calls; de DB-afhankelijke capturing/aggregatie wordt
// apart via integratie geverifieerd.)
// ------------------------------------------------------------------

const totals = (
  dataUsedBytes: bigint | null,
  dataLimitBytes: bigint | null = null,
  smsUsedCount: number | null = null
): UsageTotals => ({ dataUsedBytes, dataLimitBytes, smsUsedCount });

describe("isPeriodBoundUsageSource()", () => {
  it("alleen BUNDLE_COUNTER en CDR_STATS zijn periodegebonden", () => {
    expect(isPeriodBoundUsageSource("BUNDLE_COUNTER")).toBe(true);
    expect(isPeriodBoundUsageSource("CDR_STATS")).toBe(true);
    expect(isPeriodBoundUsageSource("NONE")).toBe(false);
    expect(isPeriodBoundUsageSource("UNKNOWN")).toBe(false);
    expect(isPeriodBoundUsageSource(null)).toBe(false);
    expect(isPeriodBoundUsageSource(undefined)).toBe(false);
  });
});

describe("formatMonthKey()", () => {
  it("maakt 'YYYY-MM' met zero-padding van de maand", () => {
    expect(formatMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(formatMonthKey(new Date(2026, 9, 1))).toBe("2026-10");
    expect(formatMonthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });
});

describe("deriveMonthKey() — bucketing-regel", () => {
  it("gebruikt de kalendermaand van periodStart wanneer aanwezig", () => {
    expect(
      deriveMonthKey(new Date(2026, 4, 10), new Date(2026, 5, 9), "BUNDLE_COUNTER")
    ).toBe("2026-05");
  });

  it("valt terug op periodEnd wanneer periodStart ontbreekt", () => {
    expect(
      deriveMonthKey(null, new Date(2026, 5, 9), "CDR_STATS")
    ).toBe("2026-06");
  });

  it("valt terug op refDate wanneer beide periodegrenzen ontbreken", () => {
    expect(
      deriveMonthKey(null, null, "BUNDLE_COUNTER", new Date(2026, 6, 3))
    ).toBe("2026-07");
  });

  it("geeft null voor niet-periodegebonden bronnen", () => {
    expect(
      deriveMonthKey(new Date(2026, 4, 10), new Date(2026, 5, 9), "NONE")
    ).toBeNull();
    expect(deriveMonthKey(new Date(), new Date(), null)).toBeNull();
  });

  it("geeft null bij een ongeldige/anomalie-datum zonder geldige fallback", () => {
    expect(
      deriveMonthKey(new Date("invalid"), new Date("invalid"), "BUNDLE_COUNTER", new Date("invalid"))
    ).toBeNull();
  });
});

describe("buildMonthWindow() — rolling venster", () => {
  it("geeft het venster oudste-eerst, inclusief de refDate-maand", () => {
    expect(buildMonthWindow(3, new Date(2026, 0, 15))).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });

  it("loopt correct over een jaargrens heen", () => {
    expect(buildMonthWindow(12, new Date(2026, 0, 1))[0]).toBe("2025-02");
    expect(buildMonthWindow(12, new Date(2026, 0, 1))[11]).toBe("2026-01");
  });
});

describe("monthLabelFromKey()", () => {
  it("formatteert naar Nederlandse maandnaam + jaar", () => {
    expect(monthLabelFromKey("2026-10")).toBe("oktober 2026");
    expect(monthLabelFromKey("2026-01")).toBe("januari 2026");
  });

  it("geeft de ruwe sleutel terug bij een onparseerbare waarde", () => {
    expect(monthLabelFromKey("onzin")).toBe("onzin");
  });
});

describe("mergeMonotonicUsage() — monotone max-guard", () => {
  it("verhoogt dataUsedBytes naar de hoogste waarneming", () => {
    const merged = mergeMonotonicUsage(
      totals(100n),
      totals(250n)
    );
    expect(merged.dataUsedBytes).toBe(250n);
  });

  it("laat dataUsedBytes nooit dalen wanneer de bron terugloopt", () => {
    const merged = mergeMonotonicUsage(
      totals(250n),
      totals(100n)
    );
    expect(merged.dataUsedBytes).toBe(250n);
  });

  it("neemt een nieuwe waarneming over wanneer de bestaande null is", () => {
    expect(mergeMonotonicUsage(totals(null), totals(50n)).dataUsedBytes).toBe(50n);
  });

  it("behoudt de bestaande waarde wanneer de nieuwe waarneming null is", () => {
    expect(mergeMonotonicUsage(totals(50n), totals(null)).dataUsedBytes).toBe(50n);
  });

  it("dataLimitBytes neemt de nieuwste niet-null waarde", () => {
    expect(
      mergeMonotonicUsage(totals(1n, 1000n), totals(2n, null)).dataLimitBytes
    ).toBe(1000n);
    expect(
      mergeMonotonicUsage(totals(1n, 1000n), totals(2n, 2000n)).dataLimitBytes
    ).toBe(2000n);
  });

  it("smsUsedCount volgt dezelfde monotone regel", () => {
    expect(
      mergeMonotonicUsage(totals(1n, null, 5), totals(1n, null, 12)).smsUsedCount
    ).toBe(12);
    expect(
      mergeMonotonicUsage(totals(1n, null, 12), totals(1n, null, 5)).smsUsedCount
    ).toBe(12);
  });
});
