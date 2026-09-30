import { describe, it, expect } from "vitest";
import {
  can,
  buildLegacyPermissionsForRole,
  hasMinRole,
  isInternalScope,
  isCustomerScope,
  isResellerScope,
  isPartnerScope,
  isPartnerOrResellerScope,
} from "@/lib/rbac";
import type { PermissionBits } from "@/types/next-auth";
import { UserRole, RoleScope, CUSTOMER_SCOPE_RESOURCES, RESELLER_SCOPE_RESOURCES, PARTNER_SCOPE_RESOURCES, ALL_RESOURCE_TYPES } from "@/types/enums";
import type { ResourceAction, ResourceType } from "@/types/enums";

/**
 * RBAC matrix test (ADMIN > EMPLOYEE > VIEWER).
 * We bouwen eerst de legacy permission-bits op via buildLegacyPermissionsForRole()
 * (100% sync, geen DB nodig) en roepen daarna de sync-overload van can() aan
 * met bits als eerste argument. Dit vermijdt de async/DB-route van can(roleId, ...).
 */
describe("RBAC can() — 3-rollen matrix ADMIN / EMPLOYEE / VIEWER", () => {
  const R = UserRole.ADMIN;
  const E = UserRole.EMPLOYEE;
  const V = UserRole.VIEWER;

  const bitsOf = (role: UserRole): PermissionBits => buildLegacyPermissionsForRole(role);

  // Helper: beetje korter
  const allow = (
    role: UserRole,
    action: ResourceAction,
    resource: ResourceType
  ) => expect(can(bitsOf(role), action, resource)).toBe(true);
  const deny = (
    role: UserRole,
    action: ResourceAction,
    resource: ResourceType
  ) => expect(can(bitsOf(role), action, resource)).toBe(false);

  // -----------------------------------------------------------------
  // 1. VIEWER = ALLEEN VIEW, GEEN CREATE / EDIT / DELETE / EXPORT
  // -----------------------------------------------------------------
  it("1. VIEWER: mag KLANT/TRACKER/SIM/VIEWEN, MAAR NIET maken/wijzigen/verwijderen (geen audit_log view)", () => {
    allow(V, "view", "customer");
    allow(V, "view", "tracker");
    allow(V, "view", "sim");
    allow(V, "view", "subscription");
    allow(V, "view", "dashboard");
    deny(V, "view", "audit_log");

    deny(V, "create", "customer");
    deny(V, "create", "activation_order");
    deny(V, "edit", "subscription");
    deny(V, "delete", "customer");
    deny(V, "delete", "tracker");
    deny(V, "export", "audit_log");
  });

  // -----------------------------------------------------------------
  // 2. EMPLOYEE: MAG create/edit, MAAR NIET delete / NIET user / NIET setting / NIET override_price
  // -----------------------------------------------------------------
  it("2. EMPLOYEE: mag create+edit+delete+override (2-bit: write=true), WEL view:setting en view:user, user CREATE=write=maar in legacy EMployee user.write=readonly", () => {
    allow(E, "create", "customer");
    allow(E, "create", "tracker");
    allow(E, "create", "sim");
    allow(E, "create", "vehicle");
    allow(E, "create", "subscription");
    allow(E, "create", "activation_order");
    allow(E, "edit", "customer");
    allow(E, "edit", "subscription");

    // View: setting + user WEL toegestaan (read-only)
    allow(E, "view", "setting");
    allow(E, "view", "user");

    // Nieuwe 2-bit architectuur (READ/WRITE): "delete" = write = true voor employee
    allow(E, "delete", "customer");
    allow(E, "delete", "subscription");
    allow(E, "delete", "tracker");

    // user/setting/role/audit_log: employee heeft READ-only (write=false)
    deny(E, "edit", "setting");
    deny(E, "create", "user");
    deny(E, "edit", "user");
    deny(E, "edit", "role");
    deny(E, "create", "role");

    // Nieuwe 2-bit architectuur: "override_price" = write = employee heeft write=true voor subscription/product
    allow(E, "override_price", "subscription");
    allow(E, "override_price", "product");
  });

  // -----------------------------------------------------------------
  // 3. ADMIN: ALLE rechten (delete, users, settings, override_price, audit export)
  // -----------------------------------------------------------------
  it("3. ADMIN: delete user + override_price + settings + audit_log export — allemaal toegestaan", () => {
    allow(R, "delete", "customer");
    allow(R, "delete", "user");
    allow(R, "delete", "activation_order");

    allow(R, "view", "user");
    allow(R, "view", "setting");

    allow(R, "override_price", "subscription");
    allow(R, "override_price", "product");
    allow(R, "override_price", "activation_order");

    allow(R, "export", "audit_log");
    allow(R, "export", "customer");
    allow(R, "import", "tracker");
  });

  // -----------------------------------------------------------------
  // 4. Dashboard zichtbaarheid: ALLE 3 rollen mogen dashboard zien
  // -----------------------------------------------------------------
  it("4. Dashboard zichtbaar voor alle rollen (VIEWER/EMPLOYEE/ADMIN)", () => {
    allow(V, "view", "dashboard");
    allow(E, "view", "dashboard");
    allow(R, "view", "dashboard");
  });

  // -----------------------------------------------------------------
  // 5. Onbekende/lege combos → false (geen crash; we testen dat can() niet throwt)
  // -----------------------------------------------------------------
  it("5. can() geeft altijd boolean (geen crash) voor ongeldige combos of ontbrekende actions", () => {
    const adminBits = bitsOf(R);
    expect(typeof can(adminBits, "view", "user" as any)).toBe("boolean");
    expect(typeof can(adminBits, "nonexistent_action" as any, "customer")).toBe("boolean");
    // onbekende action valt terug naar write (admin heeft dus write=true):
    expect(can(adminBits, "nonexistent_action" as any, "customer")).toBe(true);
    // onbekende resource geeft false
    expect(can(adminBits, "view", "unknown_unknown" as any)).toBe(false);
    expect(can(null, "view", "customer")).toBe(false);
    expect(can(undefined, "view", "customer")).toBe(false);
  });
});

describe("buildLegacyPermissionsForRole() met RESELLER / PARTNER / CUSTOMER scopes", () => {
  it("RESELLER scope ADMIN krijgt write+read op alle RESELLER_SCOPE_RESOURCES, niet op user/role/product", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.RESELLER);
    for (const r of RESELLER_SCOPE_RESOURCES as ResourceType[]) {
      expect(bits[r]?.read).toBe(true);
      expect(bits[r]?.write).toBe(true);
    }
    expect(bits["user"]?.read).toBe(false);
    expect(bits["role"]?.read).toBe(false);
    expect(bits["product"]?.read).toBe(false);
  });

  it("PARTNER scope ADMIN krijgt write+read op PARTNER_SCOPE_RESOURCES (gelijk aan RESELLER lijst)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.PARTNER);
    for (const r of PARTNER_SCOPE_RESOURCES as ResourceType[]) {
      expect(bits[r]?.read).toBe(true);
      expect(bits[r]?.write).toBe(true);
    }
    expect(bits["user"]?.read).toBe(false);
  });

  it("CUSTOMER scope VIEWER: read-only op CUSTOMER_SCOPE_RESOURCES, geen write", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.VIEWER, RoleScope.CUSTOMER);
    for (const r of CUSTOMER_SCOPE_RESOURCES as ResourceType[]) {
      if (r !== "audit_log") {
        expect(bits[r]?.read).toBe(true);
      }
      expect(bits[r]?.write).toBe(false);
    }
    expect(bits["product"]?.read).toBe(false);
  });

  it("INTERNAL scope ADMIN krijgt write+read op ALLE resources", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.INTERNAL);
    for (const r of ALL_RESOURCE_TYPES as ResourceType[]) {
      expect(bits[r]?.read).toBe(true);
      expect(bits[r]?.write).toBe(true);
    }
  });

  it("RESELLER scope heeft customer.create rechten (write=true) bij ADMIN legacy-rol", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.RESELLER);
    expect(bits["customer"]?.write).toBe(true);
    expect(bits["subscription"]?.write).toBe(true);
    expect(bits["invoice"]?.read).toBe(true);
  });

  it("PARTNER scope heeft customer.create rechten (write=true) bij ADMIN legacy-rol", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.PARTNER);
    expect(bits["customer"]?.write).toBe(true);
    expect(bits["subscription"]?.write).toBe(true);
  });

  it("fallback: scope=null gedraagt zich als INTERNAL", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, null);
    expect(bits["user"]?.read).toBe(true);
    expect(bits["setting"]?.write).toBe(true);
  });
});

describe("Scope helpers + hasMinRole() met RoleScope waardes", () => {
  it("isResellerScope: herkent RESELLER en null/undefined/other als false", () => {
    expect(isResellerScope(RoleScope.RESELLER)).toBe(true);
    expect(isResellerScope("RESELLER")).toBe(true);
    expect(isResellerScope(RoleScope.PARTNER)).toBe(false);
    expect(isResellerScope(RoleScope.CUSTOMER)).toBe(false);
    expect(isResellerScope(RoleScope.INTERNAL)).toBe(false);
    expect(isResellerScope(null)).toBe(false);
    expect(isResellerScope(undefined)).toBe(false);
  });

  it("isPartnerScope: herkent PARTNER correct", () => {
    expect(isPartnerScope(RoleScope.PARTNER)).toBe(true);
    expect(isPartnerScope("PARTNER")).toBe(true);
    expect(isPartnerScope(RoleScope.RESELLER)).toBe(false);
    expect(isPartnerScope(null)).toBe(false);
  });

  it("isPartnerOrResellerScope: zowel PARTNER als RESELLER geven true", () => {
    expect(isPartnerOrResellerScope(RoleScope.RESELLER)).toBe(true);
    expect(isPartnerOrResellerScope(RoleScope.PARTNER)).toBe(true);
    expect(isPartnerOrResellerScope(RoleScope.CUSTOMER)).toBe(false);
    expect(isPartnerOrResellerScope(RoleScope.INTERNAL)).toBe(false);
    expect(isPartnerOrResellerScope(null)).toBe(false);
  });

  it("isCustomerScope + isInternalScope: terugwerkende kracht voor originele scopes", () => {
    expect(isCustomerScope(RoleScope.CUSTOMER)).toBe(true);
    expect(isCustomerScope(RoleScope.RESELLER)).toBe(false);
    expect(isInternalScope(RoleScope.INTERNAL)).toBe(true);
    expect(isInternalScope(RoleScope.PARTNER)).toBe(false);
  });

  it("hasMinRole() met RoleScope waardes: geeft VIEWER-niveau compat, nooit EMPLOYEE/ADMIN", () => {
    expect(hasMinRole(RoleScope.INTERNAL, UserRole.VIEWER)).toBe(true);
    expect(hasMinRole(RoleScope.CUSTOMER, UserRole.VIEWER)).toBe(true);
    expect(hasMinRole(RoleScope.RESELLER, UserRole.VIEWER)).toBe(true);
    expect(hasMinRole(RoleScope.PARTNER, UserRole.VIEWER)).toBe(true);

    expect(hasMinRole(RoleScope.CUSTOMER, UserRole.EMPLOYEE)).toBe(false);
    expect(hasMinRole(RoleScope.RESELLER, UserRole.ADMIN)).toBe(false);
    expect(hasMinRole(RoleScope.PARTNER, UserRole.EMPLOYEE)).toBe(false);
    expect(hasMinRole(RoleScope.INTERNAL, UserRole.ADMIN)).toBe(false);
  });

  it("hasMinRole() met null of ongeldig: altijd false", () => {
    expect(hasMinRole(null, UserRole.VIEWER)).toBe(false);
    expect(hasMinRole(undefined, UserRole.VIEWER)).toBe(false);
  });
});
