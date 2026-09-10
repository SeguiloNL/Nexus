import { describe, it, expect } from "vitest";
import { isValidIccid } from "@/lib/validation";

describe("ICCID validatie (19-20 cijfers, begint met 89)", () => {
  const seed1 = "8931041012345678901"; // 19 cijfers, seed SIM1
  const seed2 = "8931041012345678902"; // 19 cijfers, seed SIM2
  const iccid20 = "89310410123456789012"; // 20 cijfers

  it("accepteert 19-cijferige ICCID die met 89 begint", () => {
    expect(isValidIccid(seed1)).toBe(true);
    expect(isValidIccid(seed2)).toBe(true);
    expect(isValidIccid("89-31 0410-1234567-8901")).toBe(true); // spaties/strepen normaliseren
  });

  it("accepteert 20-cijferige ICCID die met 89 begint", () => {
    expect(isValidIccid(iccid20)).toBe(true);
    expect(isValidIccid("89 310410 1234567 89012")).toBe(true);
  });

  it("weigert ICCID die NIET met 89 begint (zelfs al zijn 19-20 cijfers)", () => {
    expect(isValidIccid("0031041012345678901")).toBe(false); // 19 cijfers, begint met 00
    expect(isValidIccid("1234567890123456789")).toBe(false); // 19 cijfers, begint met 12
  });

  it("weigert te korte of te lange ICCID", () => {
    expect(isValidIccid("89")).toBe(false); // 2 cijfers
    expect(isValidIccid("89-310410 123")).toBe(false); // 11 cijfers na normalisatie
    expect(isValidIccid("893104101234567890123")).toBe(false); // 21 cijfers
  });

  it("normaliseert correct: letters/onzin mogen niet resteren", () => {
    expect(isValidIccid("89ABCDEF123456789012")).toBe(false);
  });
});
