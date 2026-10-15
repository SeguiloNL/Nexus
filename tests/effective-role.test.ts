import { describe, expect, it } from "vitest";
import {
  fallbackLegacyRoleForScope,
  normalizeLegacyRole,
  resolveEffectiveLegacyRole,
} from "@/lib/auth/effective-role";
import { RoleScope, UserRole } from "@/types/enums";

describe("effective legacy role resolution", () => {
  it("promoveert een verouderde legacy EMPLOYEE naar ADMIN als de systeemrol ADMIN is", () => {
    const role = resolveEffectiveLegacyRole({
      assignedRole: UserRole.EMPLOYEE,
      roleName: "ADMIN",
      roleScope: RoleScope.INTERNAL,
      isSystemRole: true,
    });

    expect(role).toBe(UserRole.ADMIN);
  });

  it("respecteert custom rollen en houdt dan de toegewezen fallback-legacyrol aan", () => {
    const role = resolveEffectiveLegacyRole({
      assignedRole: UserRole.ADMIN,
      roleName: "Operations Manager",
      roleScope: RoleScope.INTERNAL,
      isSystemRole: false,
    });

    expect(role).toBe(UserRole.ADMIN);
  });

  it("valt voor interne scopes terug op EMPLOYEE als het legacy veld ontbreekt", () => {
    expect(normalizeLegacyRole(null, RoleScope.INTERNAL)).toBe(UserRole.EMPLOYEE);
    expect(fallbackLegacyRoleForScope(RoleScope.PARTNER)).toBe(UserRole.EMPLOYEE);
  });

  it("valt voor klantscopes terug op VIEWER als het legacy veld ontbreekt", () => {
    expect(normalizeLegacyRole(null, RoleScope.CUSTOMER)).toBe(UserRole.VIEWER);
    expect(fallbackLegacyRoleForScope(RoleScope.CUSTOMER)).toBe(UserRole.VIEWER);
  });
});
