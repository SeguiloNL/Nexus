import { describe, it, expect } from "vitest";
import { isValidImei } from "@/lib/validation";

describe("IMEI validatie (Luhn checksum)", () => {
  // Test samples:
  // Luhn geldige IMEIs:
  //   490154203237518 (15 cijfers, seed uit DB: TRK-00001-ST)
  //   490154203237526 (15 cijfers, seed: TRK-00002-ST)
  //   8672890400732125 (16 ongeldig)
  // Ongeldige IMEIs:
  //   123456789012345 (15 cijfers, Luhn check digit klopt NIET)
  //   86-72-ABCD-732125 (bevat letters na normalisatie = te kort)
  //   "" (leeg)

  it("laat geldige 15-cijferige IMEI met Luhn door (TRK-00001 seed)", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("4901 5420 3237 518")).toBe(true);
    expect(isValidImei("49-015420-323751-8")).toBe(true);
  });

  it("laat geldige 15-cijferige IMEI met Luhn door (TRK-00002 seed)", () => {
    expect(isValidImei("490154203237526")).toBe(true);
  });

  it("accepteert 14-cijferige IMEI (zonder check digit, validatie volgt later)", () => {
    expect(isValidImei("49015420323751")).toBe(true);
  });

  it("weigert IMEI met verkeerde Luhn check digit", () => {
    // 15 cijfers, maar laatste cijfer klopt niet
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("123456789012345")).toBe(false);
  });

  it("weigert ongeldige lengtes of niet-cijfers na normalisatie", () => {
    expect(isValidImei("")).toBe(false);
    expect(isValidImei("86-72-ABCD-732125")).toBe(false); // letters
    expect(isValidImei("12345")).toBe(false); // 5 cijfers
    expect(isValidImei("12345678901234567890")).toBe(false); // 20 cijfers
  });
});
