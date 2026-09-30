import { describe, it, expect, vi } from "vitest";
import { CustomerType } from "@/types/enums";
import type { BillingCustomerResolution } from "@/server/services/invoice.service";
import { resolveBillingCustomerForSubscription } from "@/server/services/invoice.service";

function makeMockPrisma(
  customerFindUniqueResult: any
) {
  return {
    customer: {
      findUnique: vi.fn().mockResolvedValue(customerFindUniqueResult),
    },
  };
}

describe("resolveBillingCustomerForSubscription() — 4 factuur-paden", () => {
  it("Pad 1: Expliciet billingCustomerId op subscription → hoogste prioriteit (geen DB nodig)", async () => {
    const subscription = {
      id: "sub-1",
      customerId: "cust-enduser",
      billingCustomerId: "cust-explicit",
    };
    const mockPrisma = makeMockPrisma(null);

    const result = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-explicit");
    expect(result.subCustomerId).toBe("cust-enduser");
    expect(mockPrisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it("Pad 1b: billingCustomerId === customerId → geen subCustomerId marker", async () => {
    const subscription = {
      id: "sub-2",
      customerId: "cust-same",
      billingCustomerId: "cust-same",
    };
    const mockPrisma = makeMockPrisma(null);

    const result = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-same");
    expect(result.subCustomerId).toBeNull();
  });

  it("Pad 2: DIRECT-klant ZONDER parent → factuur naar jezelf", async () => {
    const subscription = {
      id: "sub-3",
      customerId: "cust-direct",
      billingCustomerId: null,
    };
    const mockPrisma = makeMockPrisma({
      id: "cust-direct",
      companyName: "Directe Eindklant B.V.",
      type: CustomerType.DIRECT,
      parentCustomerId: null,
      parentCustomer: null,
    });

    const result = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-direct");
    expect(result.viaResellerId).toBeUndefined();
    expect(result.subCustomerId).toBeUndefined();
  });

  it("Pad 3: DIRECT-klant MET RESELLER parent → factuur NAAR DE RESELLER", async () => {
    const subscription = {
      id: "sub-4",
      customerId: "cust-sub-of-reseller",
      billingCustomerId: null,
    };
    const mockPrisma = makeMockPrisma({
      id: "cust-sub-of-reseller",
      companyName: "Subklantje van Reseller",
      type: CustomerType.DIRECT,
      parentCustomerId: "reseller-1",
      parentCustomer: {
        id: "reseller-1",
        companyName: "Grote Reseller B.V.",
        type: CustomerType.RESELLER,
      },
    });

    const result: BillingCustomerResolution = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("reseller-1");
    expect(result.viaResellerId).toBe("reseller-1");
    expect(result.viaResellerName).toBe("Grote Reseller B.V.");
    expect(result.subCustomerId).toBe("cust-sub-of-reseller");
    expect(result.subCustomerName).toBe("Subklantje van Reseller");
  });

  it("Pad 4: DIRECT-klant MET PARTNER parent → factuur NAAR DE EINDKLANT zelf", async () => {
    const subscription = {
      id: "sub-5",
      customerId: "cust-enduser-via-partner",
      billingCustomerId: null,
    };
    const mockPrisma = makeMockPrisma({
      id: "cust-enduser-via-partner",
      companyName: "Eindklant via Partner B.V.",
      type: CustomerType.DIRECT,
      parentCustomerId: "partner-1",
      parentCustomer: {
        id: "partner-1",
        companyName: "De Partner BV",
        type: CustomerType.PARTNER,
      },
    });

    const result: BillingCustomerResolution = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-enduser-via-partner");
    expect(result.viaResellerId).toBe("partner-1");
    expect(result.viaResellerName).toBe("De Partner BV");
    expect(result.subCustomerId).toBe("cust-enduser-via-partner");
    expect(result.subCustomerName).toBe("Eindklant via Partner B.V.");
  });

  it("Fallback: klant niet gevonden in DB → fallback naar subscription.customerId", async () => {
    const subscription = {
      id: "sub-6",
      customerId: "cust-orphan",
      billingCustomerId: null,
    };
    const mockPrisma = makeMockPrisma(null);

    const result = await resolveBillingCustomerForSubscription(
      subscription,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-orphan");
  });

  it("Backward compat: subscription zonder billingCustomerId key (ongedefinieerd) → fallback", async () => {
    const subscription = {
      id: "sub-old",
      customerId: "cust-compat",
    };
    const mockPrisma = makeMockPrisma({
      id: "cust-compat",
      companyName: "Compat klant",
      type: CustomerType.DIRECT,
      parentCustomerId: null,
      parentCustomer: null,
    });

    const result = await resolveBillingCustomerForSubscription(
      subscription as any,
      mockPrisma as any
    );

    expect(result.billingCustomerId).toBe("cust-compat");
  });
});
