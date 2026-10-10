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
  permissionsMeaningful,
} from "@/lib/rbac";
import type { PermissionBits } from "@/types/next-auth";
import { UserRole, RoleScope, CustomerType, CUSTOMER_SCOPE_RESOURCES, RESELLER_SCOPE_RESOURCES, PARTNER_SCOPE_RESOURCES, ALL_RESOURCE_TYPES } from "@/types/enums";
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

describe("collectUserCustomerIds: junction + legacy customerId merge (pure simulatie)", () => {
  type SimCustomer = { id: string; parentCustomerId?: string | null; type?: CustomerType };
  type SimUserCustomerLink = { customerId: string };

  function collectDirectUserCustomerIds(
    legacyCustomerId: string | null,
    links: SimUserCustomerLink[]
  ): string[] {
    const set = new Set<string>();
    if (legacyCustomerId) set.add(legacyCustomerId);
    for (const l of links) {
      if (l.customerId) set.add(l.customerId);
    }
    return Array.from(set);
  }

  function collectCustomerHierarchyIds(
    rootIds: string[],
    allCustomers: SimCustomer[]
  ): string[] {
    const byParent = new Map<string | null, string[]>();
    for (const c of allCustomers) {
      const key = c.parentCustomerId ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(c.id);
      byParent.set(key, arr);
    }
    const result = new Set<string>();
    const queue: string[] = [...rootIds];
    while (queue.length) {
      const id = queue.shift()!;
      if (result.has(id)) continue;
      result.add(id);
      const children = byParent.get(id) ?? [];
      for (const child of children) queue.push(child);
    }
    return Array.from(result);
  }

  function simCollectUserCustomerIds(
    legacyCustomerId: string | null,
    links: SimUserCustomerLink[],
    allCustomers: SimCustomer[]
  ): string[] {
    const direct = collectDirectUserCustomerIds(legacyCustomerId, links);
    return collectCustomerHierarchyIds(direct, allCustomers);
  }

  const CUSTOMERS: SimCustomer[] = [
    { id: "res-1", type: CustomerType.RESELLER, parentCustomerId: null },
    { id: "d-res-1a", type: CustomerType.DIRECT, parentCustomerId: "res-1" },
    { id: "d-res-1b", type: CustomerType.DIRECT, parentCustomerId: "res-1" },
    { id: "d-res-1b-sub", type: CustomerType.DIRECT, parentCustomerId: "d-res-1b" },
    { id: "p-9", type: CustomerType.PARTNER, parentCustomerId: null },
    { id: "d-p-9a", type: CustomerType.DIRECT, parentCustomerId: "p-9" },
    { id: "d-loose", type: CustomerType.DIRECT, parentCustomerId: null },
  ];

  it("Legacy customerId alleen (geen junction): neemt tree van die klant mee", () => {
    const ids = simCollectUserCustomerIds("res-1", [], CUSTOMERS);
    expect(ids.sort()).toEqual(
      ["res-1", "d-res-1a", "d-res-1b", "d-res-1b-sub"].sort()
    );
  });

  it("Junction alleen (geen legacy): includeert alle gelinkte bomen", () => {
    const ids = simCollectUserCustomerIds(null, [
      { customerId: "d-loose" },
      { customerId: "p-9" },
    ], CUSTOMERS);
    expect(ids.sort()).toEqual(
      ["d-loose", "p-9", "d-p-9a"].sort()
    );
  });

  it("Legacy EN junction met overlap: GEEN duplicaten (dedupe werkt)", () => {
    const ids = simCollectUserCustomerIds("res-1", [
      { customerId: "d-res-1a" },
      { customerId: "res-1" },
    ], CUSTOMERS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      ["res-1", "d-res-1a", "d-res-1b", "d-res-1b-sub"].sort()
    );
  });

  it("DIRECT-subklant als root: geeft alleen eigen subtree (geen broertjes/zusjes)", () => {
    const ids = simCollectUserCustomerIds("d-res-1b", [], CUSTOMERS);
    expect(ids.sort()).toEqual(
      ["d-res-1b", "d-res-1b-sub"].sort()
    );
    expect(ids).not.toContain("d-res-1a");
    expect(ids).not.toContain("res-1");
  });

  it("Geen links EN geen legacy: lege set", () => {
    const ids = simCollectUserCustomerIds(null, [], CUSTOMERS);
    expect(ids).toEqual([]);
  });
});

describe("canUserRole 3-traps resolve (permissions → roleId → userRole)", () => {
  it("Als permissions bits gezet zijn: gaat die voor (zelfs als roleId/userRole minder rechten hebben)", () => {
    const viewerBits: PermissionBits = buildLegacyPermissionsForRole(UserRole.VIEWER);
    expect(can(viewerBits, "view", "customer")).toBe(true);
    expect(can(viewerBits, "create", "customer")).toBe(false);

    const adminBits: PermissionBits = buildLegacyPermissionsForRole(UserRole.ADMIN);
    expect(can(adminBits, "create", "customer")).toBe(true);
    expect(can(adminBits, "delete", "user")).toBe(true);
  });

  it("Permissions=null of leeg: fallback moet nog steeds werken (geen crash)", () => {
    expect(can(null as any, "view", "customer")).toBe(false);
    expect(can(undefined as any, "view", "customer")).toBe(false);
    expect(can({} as any, "view", "customer")).toBe(false);
  });
});

describe("Sim-only restricted rol (klant@seguilo.nl bug): sim.read=true en legacy EMPLOYEE achtergrond", () => {
  it("Permissions bits met alleen sim.read=true → alleen sim.view toegestaan", () => {
    const simOnlyBits: PermissionBits = {
      customer:       { read: false, write: false },
      tracker:        { read: false, write: false },
      sim:            { read: true,  write: false },
      vehicle:        { read: false, write: false },
      subscription:   { read: false, write: false },
      invoice:        { read: false, write: false },
      activation_order: { read: false, write: false },
      user:           { read: false, write: false },
      role:           { read: false, write: false },
      audit_log:      { read: false, write: false },
      setting:        { read: false, write: false },
      product:        { read: false, write: false },
      dashboard:      { read: false, write: false },
      data_plan:      { read: false, write: false },
    };

    expect(can(simOnlyBits, "view", "sim")).toBe(true);
    expect(can(simOnlyBits, "create", "sim")).toBe(false);
    expect(can(simOnlyBits, "edit",   "sim")).toBe(false);
    expect(can(simOnlyBits, "delete", "sim")).toBe(false);

    expect(can(simOnlyBits, "view", "dashboard")).toBe(false);
    expect(can(simOnlyBits, "view", "customer")).toBe(false);
    expect(can(simOnlyBits, "view", "tracker")).toBe(false);
    expect(can(simOnlyBits, "view", "vehicle")).toBe(false);
    expect(can(simOnlyBits, "view", "subscription")).toBe(false);
    expect(can(simOnlyBits, "view", "invoice")).toBe(false);
    expect(can(simOnlyBits, "view", "activation_order")).toBe(false);
    expect(can(simOnlyBits, "view", "user")).toBe(false);
    expect(can(simOnlyBits, "view", "role")).toBe(false);
    expect(can(simOnlyBits, "view", "audit_log")).toBe(false);
    expect(can(simOnlyBits, "view", "setting")).toBe(false);
    expect(can(simOnlyBits, "view", "product")).toBe(false);
  });

  it("Bewijs: legacy EMPLOYEE geeft WEL toegang tot dashboard/customer/tracker (te breed; mag dus niet gebruikt worden als roleId != null en dynamische rol WEL meaningful permissions heeft)", () => {
    const legacyEmployeeBits = buildLegacyPermissionsForRole(UserRole.EMPLOYEE, RoleScope.RESELLER);
    expect(legacyEmployeeBits.dashboard.read).toBe(true);
    expect(legacyEmployeeBits.customer.read).toBe(true);
    expect(legacyEmployeeBits.customer.write).toBe(true);
    expect(legacyEmployeeBits.sim.read).toBe(true);
    expect(legacyEmployeeBits.tracker.read).toBe(true);
    expect(legacyEmployeeBits.tracker.write).toBe(true);
    expect(legacyEmployeeBits.vehicle.read).toBe(true);
    expect(legacyEmployeeBits.subscription.read).toBe(true);
    expect(legacyEmployeeBits.invoice.read).toBe(true);
    expect(legacyEmployeeBits.activation_order.read).toBe(true);
  });
});

describe("Legacy ADMIN Beheerder safety-net (role.permissions leeg / isSystem → fallback legacy buildLegacyPermissionsForRole)", () => {
  it("ADMIN (legacy UserRole) met geladen role.permissions = alles false (lege permission-rijen): fallback geeft volledige toegang", () => {
    const loadedPermissions: PermissionBits = {
      customer:       { read: false, write: false },
      tracker:        { read: false, write: false },
      sim:            { read: false, write: false },
      vehicle:        { read: false, write: false },
      subscription:   { read: false, write: false },
      invoice:        { read: false, write: false },
      activation_order: { read: false, write: false },
      user:           { read: false, write: false },
      role:           { read: false, write: false },
      audit_log:      { read: false, write: false },
      setting:        { read: false, write: false },
      product:        { read: false, write: false },
      dashboard:      { read: false, write: false },
      data_plan:      { read: false, write: false },
    };

    const isLegacySystemRole = true;
    const legacyRole = UserRole.ADMIN;
    const scope = RoleScope.INTERNAL;
    const effectivePermissions: PermissionBits =
      (isLegacySystemRole || !permissionsMeaningful(loadedPermissions))
        ? buildLegacyPermissionsForRole(legacyRole, scope)
        : loadedPermissions;

    expect(can(effectivePermissions, "view", "dashboard")).toBe(true);
    expect(can(effectivePermissions, "create", "customer")).toBe(true);
    expect(can(effectivePermissions, "edit",   "tracker")).toBe(true);
    expect(can(effectivePermissions, "delete", "user")).toBe(true);
    expect(can(effectivePermissions, "edit",   "setting")).toBe(true);
    expect(can(effectivePermissions, "view", "audit_log")).toBe(true);
  });

  it("Niet-legacy dynamic role (SIM-only) met meaningful permissions: fallback activeert NIET (handhaaft restrictie)", () => {
    const loadedPermissions: PermissionBits = {
      customer:       { read: false, write: false },
      tracker:        { read: false, write: false },
      sim:            { read: true,  write: false },
      vehicle:        { read: false, write: false },
      subscription:   { read: false, write: false },
      invoice:        { read: false, write: false },
      activation_order: { read: false, write: false },
      user:           { read: false, write: false },
      role:           { read: false, write: false },
      audit_log:      { read: false, write: false },
      setting:        { read: false, write: false },
      product:        { read: false, write: false },
      dashboard:      { read: false, write: false },
      data_plan:      { read: false, write: false },
    };

    const isLegacySystemRole = false;
    const legacyRole = UserRole.EMPLOYEE;
    const scope = RoleScope.RESELLER;
    const effectivePermissions: PermissionBits =
      (isLegacySystemRole || !permissionsMeaningful(loadedPermissions))
        ? buildLegacyPermissionsForRole(legacyRole, scope)
        : loadedPermissions;

    expect(can(effectivePermissions, "view", "sim")).toBe(true);
    expect(can(effectivePermissions, "view", "dashboard")).toBe(false);
    expect(can(effectivePermissions, "view", "customer")).toBe(false);
    expect(can(effectivePermissions, "view", "user")).toBe(false);
  });
});

type DashTileResource = ResourceType;

const DASH_TILES_RESOURCES: DashTileResource[] = [
  "subscription",
  "subscription",
  "tracker",
  "tracker",
  "tracker",
  "sim",
  "sim",
  "activation_order",
  "activation_order",
  "customer",
  "vehicle",
  "product",
];

function dashboardAllowedResources(scope: RoleScope | null): readonly ResourceType[] {
  switch (scope) {
    case RoleScope.RESELLER:
      return RESELLER_SCOPE_RESOURCES;
    case RoleScope.PARTNER:
      return PARTNER_SCOPE_RESOURCES;
    case RoleScope.CUSTOMER:
      return CUSTOMER_SCOPE_RESOURCES;
    case RoleScope.INTERNAL:
    default:
      return ALL_RESOURCE_TYPES;
  }
}

function canUserRoleStringSync(
  roleOrRoleId: string,
  action: ResourceAction,
  resource: ResourceType
): boolean {
  switch (roleOrRoleId) {
    case "ADMIN":
      return true;
    case "EMPLOYEE":
      if (
        resource === "user" ||
        resource === "role" ||
        resource === "audit_log" ||
        resource === "setting"
      ) {
        return action === "view";
      }
      return true;
    case "VIEWER":
      return action === "view" && resource !== "audit_log";
    default:
      const s = roleOrRoleId;
      if (s.startsWith("rl_admin")) return true;
      if (s.startsWith("rl_emp")) {
        if (
          resource === "user" ||
          resource === "role" ||
          resource === "audit_log" ||
          resource === "setting"
        ) {
          return action === "view";
        }
        return true;
      }
      if (s.startsWith("rl_view")) {
        return action === "view" && resource !== "audit_log";
      }
      if (s.startsWith("rl_custedit")) {
        const wr = ["vehicle"];
        if (wr.includes(resource)) return true;
        const vr = [
          "customer",
          "tracker",
          "sim",
          "vehicle",
          "subscription",
          "invoice",
          "dashboard",
        ];
        return vr.includes(resource) && action === "view";
      }
      if (s.startsWith("rl_custview")) {
        const vr = [
          "customer",
          "tracker",
          "sim",
          "vehicle",
          "subscription",
          "invoice",
          "dashboard",
        ];
        return vr.includes(resource) && action === "view";
      }
      return false;
  }
}

function dashboardCanView(
  permissions: PermissionBits | null | undefined,
  roleId: string | null,
  userRole: UserRole | null,
  scope: RoleScope | null,
  resource: ResourceType
): boolean {
  const allowed = dashboardAllowedResources(scope);
  if (!allowed.includes(resource)) return false;

  const meaningful = permissionsMeaningful(permissions);
  if (meaningful) {
    return can(permissions as PermissionBits, "view", resource);
  }
  if (roleId && canUserRoleStringSync(roleId, "view", resource)) return true;
  if (userRole) {
    const bits = buildLegacyPermissionsForRole(userRole, scope ?? undefined);
    return can(bits, "view", resource);
  }
  return false;
}

function countVisibleTiles(
  permissions: PermissionBits | null,
  roleId: string | null,
  userRole: UserRole | null,
  scope: RoleScope | null
): number {
  let n = 0;
  for (const r of DASH_TILES_RESOURCES) {
    if (dashboardCanView(permissions, roleId, userRole, scope, r)) n++;
  }
  return n;
}

describe("Dashboard Tegel-Permissie Matrix", () => {
  it("1. ADMIN INTERNAL: alle 12 tegels zichtbaar + activation_order sectie", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.INTERNAL);
    const visible = countVisibleTiles(bits, null, UserRole.ADMIN, RoleScope.INTERNAL);
    expect(visible).toBe(12);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.INTERNAL, "activation_order")).toBe(true);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.INTERNAL, "product")).toBe(true);
  });

  it("2. EMPLOYEE INTERNAL: alle 12 tegels zichtbaar (heeft view op ALL_RESOURCE_TYPES)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.EMPLOYEE, RoleScope.INTERNAL);
    const visible = countVisibleTiles(bits, null, UserRole.EMPLOYEE, RoleScope.INTERNAL);
    expect(visible).toBe(12);
    expect(dashboardCanView(bits, null, UserRole.EMPLOYEE, RoleScope.INTERNAL, "product")).toBe(true);
    expect(dashboardCanView(bits, null, UserRole.EMPLOYEE, RoleScope.INTERNAL, "activation_order")).toBe(true);
  });

  it("3. VIEWER INTERNAL: alle 12 tegels zichtbaar (heeft read op alle resources behalve audit_log; audit_log heeft geen tegel)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.VIEWER, RoleScope.INTERNAL);
    const visible = countVisibleTiles(bits, null, UserRole.VIEWER, RoleScope.INTERNAL);
    expect(visible).toBe(12);
    expect(dashboardCanView(bits, null, UserRole.VIEWER, RoleScope.INTERNAL, "product")).toBe(true);
    expect(dashboardCanView(bits, null, UserRole.VIEWER, RoleScope.INTERNAL, "activation_order")).toBe(true);
  });

  it("4. ADMIN RESELLER scope: 11 tegels (GEEN product, WEL 2x activation_order)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.RESELLER);
    const visible = countVisibleTiles(bits, null, UserRole.ADMIN, RoleScope.RESELLER);
    expect(visible).toBe(11);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.RESELLER, "product")).toBe(false);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.RESELLER, "activation_order")).toBe(true);
    const activationTiles = DASH_TILES_RESOURCES.filter(r => r === "activation_order").length;
    expect(activationTiles).toBe(2);
  });

  it("5. ADMIN PARTNER scope: 11 tegels (zelfde als RESELLER: geen product, wel activation_order)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.PARTNER);
    const visible = countVisibleTiles(bits, null, UserRole.ADMIN, RoleScope.PARTNER);
    expect(visible).toBe(11);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.PARTNER, "product")).toBe(false);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.PARTNER, "activation_order")).toBe(true);
  });

  it("6. ADMIN CUSTOMER scope: 9 tegels (GEEN product, GEEN 2x activation_order)", () => {
    const bits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.CUSTOMER);
    const visible = countVisibleTiles(bits, null, UserRole.ADMIN, RoleScope.CUSTOMER);
    expect(visible).toBe(9);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.CUSTOMER, "product")).toBe(false);
    expect(dashboardCanView(bits, null, UserRole.ADMIN, RoleScope.CUSTOMER, "activation_order")).toBe(false);

    const subs = DASH_TILES_RESOURCES.filter(r => r === "subscription").length;
    const trk = DASH_TILES_RESOURCES.filter(r => r === "tracker").length;
    const sims = DASH_TILES_RESOURCES.filter(r => r === "sim").length;
    const cust = DASH_TILES_RESOURCES.filter(r => r === "customer").length;
    const veh = DASH_TILES_RESOURCES.filter(r => r === "vehicle").length;
    expect(subs + trk + sims + cust + veh).toBe(9);
  });

  it("7. Custom role: alleen SIM + TRACKER view (5 tegels: 3 tracker + 2 sim), rest onzichtbaar", () => {
    const simTrackerBits: PermissionBits = {
      customer:         { read: false, write: false },
      tracker:          { read: true,  write: false },
      sim:              { read: true,  write: false },
      vehicle:          { read: false, write: false },
      subscription:     { read: false, write: false },
      invoice:          { read: false, write: false },
      activation_order: { read: false, write: false },
      user:             { read: false, write: false },
      role:             { read: false, write: false },
      audit_log:        { read: false, write: false },
      setting:          { read: false, write: false },
      product:          { read: false, write: false },
      dashboard:        { read: true,  write: false },
      data_plan:        { read: false, write: false },
    };
    const visible = countVisibleTiles(simTrackerBits, null, null, RoleScope.INTERNAL);
    expect(visible).toBe(5);
    expect(dashboardCanView(simTrackerBits, null, null, RoleScope.INTERNAL, "tracker")).toBe(true);
    expect(dashboardCanView(simTrackerBits, null, null, RoleScope.INTERNAL, "sim")).toBe(true);
    expect(dashboardCanView(simTrackerBits, null, null, RoleScope.INTERNAL, "subscription")).toBe(false);
    expect(dashboardCanView(simTrackerBits, null, null, RoleScope.INTERNAL, "product")).toBe(false);
  });

  it("8. Custom role: ALLEEN dashboard.view (geen enkele andere resource) → 0 tegels zichtbaar", () => {
    const dashOnlyBits: PermissionBits = {
      customer:         { read: false, write: false },
      tracker:          { read: false, write: false },
      sim:              { read: false, write: false },
      vehicle:          { read: false, write: false },
      subscription:     { read: false, write: false },
      invoice:          { read: false, write: false },
      activation_order: { read: false, write: false },
      user:             { read: false, write: false },
      role:             { read: false, write: false },
      audit_log:        { read: false, write: false },
      setting:          { read: false, write: false },
      product:          { read: false, write: false },
      dashboard:        { read: true,  write: false },
      data_plan:        { read: false, write: false },
    };
    const visible = countVisibleTiles(dashOnlyBits, null, null, RoleScope.INTERNAL);
    expect(visible).toBe(0);
  });

  it("9. Scope-whitelist overtreft permissie bits: CUSTOMER scope met product.read=true → toch product tegel VERBORGEN", () => {
    const productBits: PermissionBits = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.CUSTOMER);
    productBits.product = { read: true, write: true };
    expect(can(productBits, "view", "product")).toBe(true);
    expect(dashboardCanView(productBits, null, null, RoleScope.CUSTOMER, "product")).toBe(false);
  });

  it("10. 3-traps fallback: GEEN permissions (leeg), WEL roleId=r1_admin → alle 12 tegels (INTERNAL)", () => {
    const empty: PermissionBits | null = null;
    const visible = countVisibleTiles(empty, "rl_admin_x1", null, RoleScope.INTERNAL);
    expect(visible).toBe(12);
  });

  it("11. 3-traps fallback: GEEN permissions, WEL userRole=VIEWER (INTERNAL) → 12 tegels zichtbaar", () => {
    const visible = countVisibleTiles(null, null, UserRole.VIEWER, RoleScope.INTERNAL);
    expect(visible).toBe(12);
  });

  it("12. Recente activaties sectie zichtbaarheid: CUSTOMER = onzichtbaar; RESELLER/PARTNER/INTERNAL = zichtbaar", () => {
    const adminCust = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.CUSTOMER);
    const adminRes = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.RESELLER);
    const adminInt = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.INTERNAL);
    const adminPart = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.PARTNER);
    expect(dashboardCanView(adminCust, null, UserRole.ADMIN, RoleScope.CUSTOMER, "activation_order")).toBe(false);
    expect(dashboardCanView(adminRes, null, UserRole.ADMIN, RoleScope.RESELLER, "activation_order")).toBe(true);
    expect(dashboardCanView(adminPart, null, UserRole.ADMIN, RoleScope.PARTNER, "activation_order")).toBe(true);
    expect(dashboardCanView(adminInt, null, UserRole.ADMIN, RoleScope.INTERNAL, "activation_order")).toBe(true);
  });
});

// --------------------------------------------------------------------
// NIEUW: DataPlan resource + Sim-only action (sim_only_order op activation_order)
// --------------------------------------------------------------------
describe("DataPlan resource scope en Sim-only action", () => {
  it("data_plan alleen zichtbaar in INTERNAL scope, NIET in CUSTOMER/RESELLER/PARTNER", () => {
    expect(CUSTOMER_SCOPE_RESOURCES.includes("data_plan" as any)).toBe(false);
    expect(RESELLER_SCOPE_RESOURCES.includes("data_plan" as any)).toBe(false);
    expect(PARTNER_SCOPE_RESOURCES.includes("data_plan" as any)).toBe(false);
    expect(ALL_RESOURCE_TYPES.includes("data_plan" as any)).toBe(true);
  });

  it("INTERNAL ADMIN/EMPLOYEE krijgen read+write op data_plan (legacy matrix)", () => {
    const admin = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.INTERNAL);
    const employee = buildLegacyPermissionsForRole(UserRole.EMPLOYEE, RoleScope.INTERNAL);
    const viewer = buildLegacyPermissionsForRole(UserRole.VIEWER, RoleScope.INTERNAL);

    expect(admin.data_plan?.read).toBe(true);
    expect(admin.data_plan?.write).toBe(true);
    expect(employee.data_plan?.read).toBe(true);
    expect(employee.data_plan?.write).toBe(true);
    expect(viewer.data_plan?.read).toBe(true);
    expect(viewer.data_plan?.write).toBe(false);
  });

  it("CUSTOMER/RESELLER/PARTNER scopes: data_plan bits altijd read=false write=false (buiten scope)", () => {
    const cust = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.CUSTOMER);
    const res = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.RESELLER);
    const part = buildLegacyPermissionsForRole(UserRole.ADMIN, RoleScope.PARTNER);
    for (const bits of [cust, res, part]) {
      expect(bits.data_plan?.read).not.toBe(true);
      expect(bits.data_plan?.write).not.toBe(true);
    }
  });
});

describe("ActivationOrder action: sim_only_order (aparte rechtengroep)", () => {
  it("legacy ADMIN/EMPLOYEE hebben sim_only_order via write=true op activation_order", () => {
    const adminBits = buildLegacyPermissionsForRole(UserRole.ADMIN);
    const employeeBits = buildLegacyPermissionsForRole(UserRole.EMPLOYEE);
    const viewerBits = buildLegacyPermissionsForRole(UserRole.VIEWER);

    expect(can(adminBits, "sim_only_order", "activation_order")).toBe(true);
    expect(can(employeeBits, "sim_only_order", "activation_order")).toBe(true);
    // Viewer heeft alleen read → sim_only_order is write-type fallback → denied
    expect(can(viewerBits, "sim_only_order", "activation_order")).toBe(false);
  });

  it("role bits met expliciete actions entry: sim_only_order=true overschrijft write=false", () => {
    const restrictedBits: PermissionBits = {
      ...(buildLegacyPermissionsForRole(UserRole.VIEWER) as any),
      activation_order: {
        read: true,
        write: false,
        actions: { sim_only_order: true },
      },
    };
    expect(can(restrictedBits, "sim_only_order", "activation_order")).toBe(true);
    // write=false, dus edit mag niet
    expect(can(restrictedBits, "edit", "activation_order")).toBe(false);
  });

  it("role bits met actions.sim_only_order=false → expliciet deny ook al is write=true", () => {
    const bits: PermissionBits = {
      ...(buildLegacyPermissionsForRole(UserRole.EMPLOYEE) as any),
      activation_order: {
        read: true,
        write: true,
        actions: { sim_only_order: false },
      },
    };
    expect(can(bits, "sim_only_order", "activation_order")).toBe(false);
    // overige write actions (create/edit/delete) mogen nog wel via write=true
    expect(can(bits, "create", "activation_order")).toBe(true);
  });
});
