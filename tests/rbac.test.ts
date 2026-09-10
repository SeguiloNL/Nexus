import { describe, it, expect } from "vitest";
import { can } from "@/lib/rbac";
import { UserRole } from "@/types/enums";
import type { ResourceAction, ResourceType } from "@/types/enums";

/**
 * RBAC matrix test (ADMIN > EMPLOYEE > VIEWER).
 * We testen "can" direct vanuit src/lib/rbac.ts,
 * want canUserRole() in session.ts is alleen een wrapper die
 * next-auth dependencies meetrekt (next/server import die vitest niet vindt).
 */
describe("RBAC can() — 3-rollen matrix ADMIN / EMPLOYEE / VIEWER", () => {
  const R = UserRole.ADMIN;
  const E = UserRole.EMPLOYEE;
  const V = UserRole.VIEWER;

  // Helper: beetje korter
  const allow = (
    role: UserRole,
    action: ResourceAction,
    resource: ResourceType
  ) => expect(can(role, action, resource)).toBe(true);
  const deny = (
    role: UserRole,
    action: ResourceAction,
    resource: ResourceType
  ) => expect(can(role, action, resource)).toBe(false);

  // -----------------------------------------------------------------
  // 1. VIEWER = ALLEEN VIEW, GEEN CREATE / EDIT / DELETE / EXPORT
  // -----------------------------------------------------------------
  it("1. VIEWER: mag KLANT/TRACKER/SIM/VIEWEN, MAAR NIET maken/wijzigen/verwijderen", () => {
    allow(V, "view", "customer");
    allow(V, "view", "tracker");
    allow(V, "view", "sim");
    allow(V, "view", "subscription");
    allow(V, "view", "dashboard");
    allow(V, "view", "audit_log");

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
  it("2. EMPLOYEE: mag create+edit (incl activation_order), GEEN delete, GEEN users/settings/override_price", () => {
    allow(E, "create", "customer");
    allow(E, "create", "tracker");
    allow(E, "create", "sim");
    allow(E, "create", "vehicle");
    allow(E, "create", "subscription");
    allow(E, "create", "activation_order");
    allow(E, "edit", "customer");
    allow(E, "edit", "subscription");

    // GEEN delete
    deny(E, "delete", "customer");
    deny(E, "delete", "subscription");
    deny(E, "delete", "tracker");

    // GEEN user/setting resource bekijken of aanmaken
    deny(E, "view", "user");
    deny(E, "view", "setting");
    deny(E, "create", "user");

    // GEEN override_price
    deny(E, "override_price", "subscription");
    deny(E, "override_price", "product");
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
    expect(typeof can(R, "view", "user" as any)).toBe("boolean");
    expect(typeof can(R, "nonexistent_action" as any, "customer")).toBe("boolean");
    expect(can(R, "nonexistent_action" as any, "customer")).toBe(false);
    expect(can("INVALID_ROLE" as any, "view", "customer")).toBe(false);
  });
});
