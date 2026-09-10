import { describe, it, expect } from "vitest";
import { normalizeLicensePlate } from "@/lib/validation";
import { normalizeImei, normalizeIccid } from "@/lib/validation";

describe("Kenteken / LicensePlate normalisatie", () => {
  it("stript niet-alfanumerieke tekens en zet uppercase", () => {
    expect(normalizeLicensePlate("AB-01-CD")).toBe("AB01CD");
    expect(normalizeLicensePlate("ab 01 cd")).toBe("AB01CD");
    expect(normalizeLicensePlate("1-aa-bb")).toBe("1AABB");
    expect(normalizeLicensePlate("KP-01-NL")).toBe("KP01NL");
  });

  it("accepteert al schone invoer en sorteert op niet-wijzigen", () => {
    expect(normalizeLicensePlate("AB01CD")).toBe("AB01CD");
    expect(normalizeLicensePlate("EF23GH")).toBe("EF23GH");
  });

  it("slaat lege invoer over als lege string", () => {
    expect(normalizeLicensePlate("")).toBe("");
    expect(normalizeLicensePlate("---///  ")).toBe("");
  });
});

describe("IMEI / ICCID normalisatie sanity checks", () => {
  it("IMEI: alle niet-cijfers gestript", () => {
    expect(normalizeImei("4901 5420 3237 518")).toBe("490154203237518");
    expect(normalizeImei("IMEI: 86-728904-0073-21")).toBe("86728904007321");
  });

  it("ICCID: niet-cijfers gestript + uppercase", () => {
    expect(normalizeIccid("8931 0410 1234 5678 901")).toBe("8931041012345678901");
    expect(normalizeIccid("89-ab-12-cdef")).toBe("8912");
  });
});
