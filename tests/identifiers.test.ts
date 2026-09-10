import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Identifier generators: generateCustomerNumber, generateSubscriptionNumber, generateOrderNumber
 *
 * Omdat ze importeren vanuit "@/lib/prisma" (singleton prisma client),
 * mocken we de "@/lib/prisma" module zodat we GEEN echte DB nodig hebben.
 * De test controleert het FORMAAT (prefix-JAAR-00001) en
 * de incrementele logica (wanneer latest gegeven, volgend nummer = +1).
 */

// Mock de prisma singleton module VOOR imports van generators
const mockFindFirst = vi.fn();
const mockPrisma = {
  customer: { findFirst: mockFindFirst },
  subscription: { findFirst: mockFindFirst },
  activationOrder: { findFirst: mockFindFirst },
};
vi.doMock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Importeer NA mock setup
const {
  generateCustomerNumber,
  generateSubscriptionNumber,
  generateOrderNumber,
} = await import("@/lib/identifiers");

beforeEach(() => {
  mockFindFirst.mockReset();
});

describe("Identifiers Formaat & Incrementeel (zonder DB, prisma mocked)", () => {
  const year = new Date().getFullYear();

  it("generateCustomerNumber() geeft K-YYYY-NNNNN (5 digits), begint met 00001 als latest leeg", async () => {
    mockFindFirst.mockResolvedValue(null); // geen latest
    const nr = await generateCustomerNumber(mockPrisma as any);
    expect(nr).toMatch(new RegExp(`^K-${year}-\\d{5}$`));
    expect(nr).toBe(`K-${year}-00001`);
  });

  it("generateSubscriptionNumber() geeft SUB-YYYY-NNNNNN (6 digits)", async () => {
    mockFindFirst.mockResolvedValue(null);
    const nr = await generateSubscriptionNumber(mockPrisma as any);
    expect(nr).toMatch(new RegExp(`^SUB-${year}-\\d{6}$`));
    expect(nr).toBe(`SUB-${year}-000001`);
  });

  it("generateOrderNumber() geeft ACT-YYYY-NNNNNN (6 digits)", async () => {
    mockFindFirst.mockResolvedValue(null);
    const nr = await generateOrderNumber(mockPrisma as any);
    expect(nr).toMatch(new RegExp(`^ACT-${year}-\\d{6}$`));
    expect(nr).toBe(`ACT-${year}-000001`);
  });

  it("increment +1 wanneer latest bestaat", async () => {
    mockFindFirst.mockResolvedValueOnce({ subscriptionNumber: `SUB-${year}-000042` });
    const nr = await generateSubscriptionNumber(mockPrisma as any);
    expect(nr).toBe(`SUB-${year}-000043`);
  });

  it("0-padding klopt zelfs bij grote nummers (geen leading zero mismatch)", async () => {
    mockFindFirst.mockResolvedValueOnce({ orderNumber: `ACT-${year}-099999` });
    const nr = await generateOrderNumber(mockPrisma as any);
    expect(nr).toBe(`ACT-${year}-100000`); // precies 6 digits, ook 100000 = 6 digits (past, 000001 tm 999999)
  });
});
