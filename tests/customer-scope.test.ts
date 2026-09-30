import { describe, it, expect } from "vitest";
import { CustomerType, RoleScope } from "@/types/enums";

/**
 * Pure (stateless) herbouw van de core business rules uit customer.service.ts.
 * Test dezelfde invoercondities die de service ook inline afvangt.
 * We kunnen de niet-Prisma afhankelijke regels hier 1:1 nabootsen.
 */

type ValidatieFout = string | null;

/** Gelijk aan createCustomer: scope-forcing regels. */
function simulScopeForcing(
  input: { parentCustomerId?: string | null; type?: CustomerType | null },
  ctxRoleScope: RoleScope | null | undefined,
  ctxCustomerId: string | null
): { output: { parentCustomerId: string | null; type: CustomerType | null }; error: ValidatieFout } {
  const output = {
    parentCustomerId: input.parentCustomerId ?? null,
    type: input.type ?? null,
  };
  const isPartnerOrReseller =
    ctxRoleScope === RoleScope.RESELLER || ctxRoleScope === RoleScope.PARTNER;

  if (isPartnerOrReseller) {
    if (!ctxCustomerId) {
      return { output, error: "Kan geen sub-klanten aanmaken: geen eigen customer-id in sessie." };    }
    if (output.parentCustomerId != null && output.parentCustomerId !== ctxCustomerId) {
      return { output, error: "Parent customer mag alleen je eigen klantrecord zijn." };
    }
    output.parentCustomerId = ctxCustomerId;
    output.type = CustomerType.DIRECT;
  } else if (ctxRoleScope === RoleScope.CUSTOMER) {
    return { output, error: "Onvoldoende rechten: directe eindklanten kunnen geen sub-klanten aanmaken." };
  }
  return { output, error: null };
}

/** Gelijk aan createCustomer nesting-regels. */
function simulNestingRules(
  input: { parentCustomerId: string | null; type?: CustomerType | null; parentType?: CustomerType | null }
): ValidatieFout {
  if (input.parentCustomerId) {
    if (input.parentType === CustomerType.DIRECT || input.parentType == null) {
      return "Parent customer moet van type RESELLER of PARTNER zijn (DIRECT kan geen sub-klanten hebben).";
    }
  }
  if (
    (input.type === CustomerType.RESELLER || input.type === CustomerType.PARTNER) &&
    input.parentCustomerId
  ) {
    return "RESELLER en PARTNER klanten kunnen geen eigen parent hebben (geen geneste resellers/partners).";
  }
  return null;
}

describe("Customer scope business rules (pure herbouw van customer.service.ts)", () => {
  describe("Scope forcing: wat mag Reseller / Partner / DIRECT-klant", () => {
    it("Reseller (ctxRoleScope=RESELLER, customerId='res-1'): parentCustomerId wordt geforceerd naar eigen id, type=DIRECT", () => {
      const r = simulScopeForcing(
        { parentCustomerId: null, type: null },
        RoleScope.RESELLER,
        "res-1"
      );
      expect(r.error).toBeNull();
      expect(r.output.parentCustomerId).toBe("res-1");
      expect(r.output.type).toBe(CustomerType.DIRECT);
    });

    it("Partner probeert als parent een andere customer op te geven → fout", () => {
      const r = simulScopeForcing(
        { parentCustomerId: "some-other-id", type: null },
        RoleScope.PARTNER,
        "partner-7"
      );
      expect(r.error).not.toBeNull();
      expect(r.error).toMatch(/alleen je eigen klantrecord/);
    });

    it("Partner zonder ctx.customerId → fout (geen eigen klantrecord in sessie)", () => {
      const r = simulScopeForcing(
        { parentCustomerId: null, type: null },
        RoleScope.PARTNER,
        null
      );
      expect(r.error).not.toBeNull();
    });

    it("DIRECT eindklant (RoleScope.CUSTOMER) probeert subklant aan te maken → fout", () => {
      const r = simulScopeForcing(
        { parentCustomerId: "cust-1", type: null },
        RoleScope.CUSTOMER,
        "cust-1"
      );
      expect(r.error).toMatch(/directe eindklanten kunnen geen sub-klanten/);
    });

    it("INTERNAL gebruiker: geen forcing, input blijf staan", () => {
      const r = simulScopeForcing(
        { parentCustomerId: "reseller-42", type: CustomerType.RESELLER },
        RoleScope.INTERNAL,
        null
      );
      expect(r.error).toBeNull();
      expect(r.output.parentCustomerId).toBe("reseller-42");
      expect(r.output.type).toBe(CustomerType.RESELLER);
    });
  });

  describe("Nesting regels: geneste resellers verboden, parent type eisen", () => {
    it("DIRECT subklant met RESELLER parent → OK", () => {
      const err = simulNestingRules({
        parentCustomerId: "res-1",
        type: CustomerType.DIRECT,
        parentType: CustomerType.RESELLER,
      });
      expect(err).toBeNull();
    });

    it("DIRECT subklant met PARTNER parent → OK", () => {
      const err = simulNestingRules({
        parentCustomerId: "p-1",
        type: CustomerType.DIRECT,
        parentType: CustomerType.PARTNER,
      });
      expect(err).toBeNull();
    });

    it("DIRECT subklant met DIRECT parent → FOUT", () => {
      const err = simulNestingRules({
        parentCustomerId: "d-1",
        type: CustomerType.DIRECT,
        parentType: CustomerType.DIRECT,
      });
      expect(err).toMatch(/Parent customer moet van type RESELLER of PARTNER/);
    });

    it("Reseller met parentCustomerId (geneste reseller) → FOUT", () => {
      const err = simulNestingRules({
        parentCustomerId: "res-0",
        type: CustomerType.RESELLER,
        parentType: CustomerType.RESELLER,
      });
      expect(err).toMatch(/geen geneste resellers\/partners/);
    });

    it("Partner met parentCustomerId (geneste partner) → FOUT", () => {
      const err = simulNestingRules({
        parentCustomerId: "p-0",
        type: CustomerType.PARTNER,
        parentType: CustomerType.PARTNER,
      });
      expect(err).toMatch(/geen geneste resellers\/partners/);
    });

    it("Reseller zonder parent → OK (top-level reseller)", () => {
      const err = simulNestingRules({
        parentCustomerId: null,
        type: CustomerType.RESELLER,
        parentType: null,
      });
      expect(err).toBeNull();
    });

    it("Partner zonder parent → OK (top-level partner)", () => {
      const err = simulNestingRules({
        parentCustomerId: null,
        type: CustomerType.PARTNER,
        parentType: null,
      });
      expect(err).toBeNull();
    });
  });
});
