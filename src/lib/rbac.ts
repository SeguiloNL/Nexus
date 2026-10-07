import type {
  ResourceAction,
  ResourceType,
} from "@/types/enums";
import {
  UserRole,
  RoleScope,
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
  RESELLER_SCOPE_RESOURCES,
  PARTNER_SCOPE_RESOURCES,
} from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

export function emptyPermissionBits(): PermissionBits {
  const obj = {} as PermissionBits;
  for (const r of ALL_RESOURCE_TYPES) obj[r] = { read: false, write: false };
  return obj;
}

export function buildLegacyPermissionsForRole(
  role: UserRole | null | undefined,
  scope?: RoleScope | null | undefined
): PermissionBits {
  const bits = emptyPermissionBits();
  const safeRole = role ?? UserRole.VIEWER;
  const safeScope = scope ?? RoleScope.INTERNAL;

  const allowedResources = (() => {
    switch (safeScope) {
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
  })();

  for (const r of allowedResources) {
    switch (safeRole) {
      case UserRole.ADMIN:
        bits[r] = { read: true, write: true };
        break;
      case UserRole.EMPLOYEE:
        if (
          r === "user" ||
          r === "role" ||
          r === "audit_log" ||
          r === "setting"
        ) {
          bits[r] = { read: true, write: false };
        } else {
          bits[r] = { read: true, write: true };
        }
        break;
      case UserRole.VIEWER:
      default:
        if (r !== "audit_log") {
          bits[r] = { read: true, write: false };
        }
        break;
    }
  }
  return bits;
}

export type PermissionActionBit = "read" | "write";

export function actionToBit(action: ResourceAction): PermissionActionBit {
  if (action === "view" || action === "view_all_sim_usage_dashboard") return "read";
  return "write";
}

export function permissionsMeaningful(bits: PermissionBits | null | undefined): boolean {
  if (!bits) return false;
  for (const k of Object.keys(bits) as ResourceType[]) {
    const e = bits[k];
    if (e && (e.read || e.write)) return true;
  }
  return false;
}

type MinimalAuthzCtx = {
  permissions?: PermissionBits | null;
  roleId?: string | null;
  userRole?: UserRole;
  roleScope?: RoleScope | null;
};

export function pickAuth(
  ctx: MinimalAuthzCtx
): PermissionBits | string {
  if (permissionsMeaningful(ctx.permissions)) {
    return ctx.permissions as PermissionBits;
  }

  const scope = (ctx.roleScope ?? RoleScope.INTERNAL) as RoleScope;

  if (typeof ctx.roleId === "string" && ctx.roleId) {
    if (
      ctx.roleId === UserRole.ADMIN ||
      ctx.roleId === UserRole.EMPLOYEE ||
      ctx.roleId === UserRole.VIEWER
    ) {
      return buildLegacyPermissionsForRole(ctx.roleId as UserRole, scope);
    }
  }

  if (ctx.userRole) {
    return buildLegacyPermissionsForRole(ctx.userRole, scope);
  }

  if (typeof ctx.roleId === "string" && ctx.roleId) {
    return ctx.roleId;
  }

  return emptyPermissionBits();
}

type RoleIdCanArgs = [roleId: string, action: ResourceAction, resource: ResourceType];
type BitsCanArgs = [
  bits: PermissionBits | null | undefined,
  action: ResourceAction,
  resource: ResourceType
];

let permissionsByRoleId: Map<string, { bits: PermissionBits; expiresAt: number }> | null =
  null;

const CACHE_TTL_MS = 5 * 60 * 1000;

function getCache(): Map<string, { bits: PermissionBits; expiresAt: number }> {
  if (!permissionsByRoleId) permissionsByRoleId = new Map();
  return permissionsByRoleId;
}

export function clearPermissionCache(): void {
  getCache().clear();
}

export function invalidateRolePermissions(roleId: string): void {
  getCache().delete(roleId);
}

async function loadPermissionsFromService(
  roleId: string
): Promise<PermissionBits> {
  const { getPermissionsByRoleId } = await import(
    "@/server/services/role.service"
  );
  return getPermissionsByRoleId(roleId);
}

export async function loadPermissionsForRole(
  roleId: string,
  opts: { force?: boolean } = {}
): Promise<PermissionBits> {
  if (!roleId) return emptyPermissionBits();

  if (
    roleId === UserRole.ADMIN ||
    roleId === UserRole.EMPLOYEE ||
    roleId === UserRole.VIEWER
  ) {
    return buildLegacyPermissionsForRole(roleId as UserRole, RoleScope.INTERNAL);
  }

  const cache = getCache();
  const now = Date.now();
  if (!opts.force) {
    const cached = cache.get(roleId);
    if (cached && cached.expiresAt > now) {
      return cached.bits;
    }
  }
  let bits: PermissionBits;
  try {
    bits = await loadPermissionsFromService(roleId);
  } catch (_e) {
    return emptyPermissionBits();
  }
  cache.set(roleId, { bits, expiresAt: now + CACHE_TTL_MS });
  try {
    const { registerRoleCacheInvalidator } = await import(
      "@/server/services/role.service"
    );
    registerRoleCacheInvalidator(() => {
      clearPermissionCache();
    });
  } catch (_) {
    /* noop */
  }
  return bits;
}

export function canWithBits(
  bits: PermissionBits | null | undefined,
  action: ResourceAction,
  resource: ResourceType
): boolean {
  if (!bits) return false;
  const entry = bits[resource];
  if (entry && typeof entry === "object") {
    const perAction = (entry as any).actions?.[action];
    if (typeof perAction === "boolean") return perAction;
  }
  const bit = actionToBit(action);
  if (!entry) return false;
  if (bit === "write") return Boolean(entry.write);
  return Boolean(entry.read);
}

export async function canWithRoleId(
  roleId: string,
  action: ResourceAction,
  resource: ResourceType
): Promise<boolean> {
  try {
    const bits = await loadPermissionsForRole(roleId);
    return canWithBits(bits, action, resource);
  } catch (_e) {
    return false;
  }
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

export async function can(...args: RoleIdCanArgs): Promise<boolean>;
export function can(...args: BitsCanArgs): boolean;
export function can(
  ...args: RoleIdCanArgs | BitsCanArgs
): boolean | Promise<boolean> {
  if (isString(args[0])) {
    return canWithRoleId(args[0] as string, args[1] as ResourceAction, args[2] as ResourceType);
  }
  return canWithBits(
    args[0] as PermissionBits | null | undefined,
    args[1] as ResourceAction,
    args[2] as ResourceType
  );
}

export class PermissionError extends Error {
  public readonly statusCode = 403;
  public readonly code = "PERMISSION_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export async function requirePermission(
  roleIdOrBits: string | PermissionBits | null | undefined,
  action: ResourceAction,
  resource: ResourceType,
  customMessage?: string
): Promise<void> {
  let ok: boolean;
  if (typeof roleIdOrBits === "string") {
    ok = await canWithRoleId(roleIdOrBits, action, resource);
  } else {
    ok = canWithBits(roleIdOrBits, action, resource);
  }
  if (!ok) {
    throw new PermissionError(
      customMessage ??
        (typeof roleIdOrBits === "string"
          ? `Onvoldoende rechten: rol ${roleIdOrBits} mag ${action} niet uitvoeren op ${resource}.`
          : `Onvoldoende rechten: je hebt geen toestemming om ${action} uit te voeren op ${resource}.`)
    );
  }
}

/**
 * Backward compat: minimum rol-vereiste op basis van legacy UserRole hiërarchie
 * (ADMIN > EMPLOYEE > VIEWER). Gebruik alleen als permissie-check niet mogelijk is.
 */
export function hasMinRole(
  role: UserRole | RoleScope | null | undefined,
  minRole: UserRole
): boolean {
  if (!role) return false;
  const scopeValues: string[] = ["INTERNAL", "CUSTOMER", "RESELLER", "PARTNER"];
  if (scopeValues.includes(role as string)) {
    if (role === RoleScope.INTERNAL) return minRole === UserRole.VIEWER;
    // CUSTOMER / RESELLER / PARTNER: minimale viewer rechten alleen als VIEWER gevraagd
    return minRole === UserRole.VIEWER;
  }
  const order: UserRole[] = ["VIEWER", "EMPLOYEE", "ADMIN"] as UserRole[];
  return order.indexOf(role as UserRole) >= order.indexOf(minRole);
}

export function isInternalScope(scope: RoleScope | string | null | undefined): boolean {
  return scope === "INTERNAL";
}

export function isCustomerScope(scope: RoleScope | string | null | undefined): boolean {
  return scope === "CUSTOMER";
}

export function isResellerScope(scope: RoleScope | string | null | undefined): boolean {
  return scope === "RESELLER";
}

export function isPartnerScope(scope: RoleScope | string | null | undefined): boolean {
  return scope === "PARTNER";
}

export function isPartnerOrResellerScope(
  scope: RoleScope | string | null | undefined
): boolean {
  return isResellerScope(scope) || isPartnerScope(scope);
}

// ------------------------------
// Customer Scope (M:N via UserCustomer junction + hiërarchie)
// ------------------------------

type CustomerScopeCacheEntry = {
  ids: string[];
  expiresAt: number;
};

const CUSTOMER_SCOPE_CACHE_TTL_MS = 5 * 60 * 1000;
let customerScopeCache: Map<string, CustomerScopeCacheEntry> | null = null;
let customerScopeInvalidator: (() => void) | null = null;

function getCustomerScopeCache(): Map<string, CustomerScopeCacheEntry> {
  if (!customerScopeCache) customerScopeCache = new Map();
  return customerScopeCache;
}

export function clearCustomerScopeCache(): void {
  getCustomerScopeCache().clear();
}

export function invalidateUserCustomerScope(userId: string): void {
  getCustomerScopeCache().delete(userId);
}

export function registerCustomerScopeInvalidator(fn: () => void): void {
  customerScopeInvalidator = fn;
}

async function resolveHierarchyIdsForCustomerIds(
  directCustomerIds: string[]
): Promise<string[]> {
  if (directCustomerIds.length === 0) return [];
  try {
    const { collectCustomerHierarchyIds } = await import(
      "@/server/services/customer.service"
    );
    const sets = await Promise.all(
      directCustomerIds.map((id) => collectCustomerHierarchyIds(id))
    );
    const merged = new Set<string>();
    for (const s of sets) for (const x of s) merged.add(x);
    return Array.from(merged);
  } catch (_e) {
    return directCustomerIds;
  }
}

/**
 * Bepaalt alle effectieve customerIds voor een gebruiker:
 *  1. Alle direct gekoppelde customers via UserCustomer junction
 *  2. Plus de legacy user.customerId (indien aanwezig en nog niet in junction)
 *  3. Plus per customerId de recursieve sub-hiërarchie
 *
 * Resultaat wordt 5 minuten gecachet per userId.
 */
export async function collectUserCustomerIds(
  userId: string,
  opts: { force?: boolean } = {}
): Promise<string[]> {
  if (!userId) return [];

  const cache = getCustomerScopeCache();
  const now = Date.now();
  if (!opts.force) {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.ids;
  }

  let directCustomerIds: string[] = [];
  try {
    const { collectDirectUserCustomerIds } = await import(
      "@/server/services/user.service"
    );
    directCustomerIds = await collectDirectUserCustomerIds(userId);
  } catch (_e) {
    directCustomerIds = [];
  }

  const fullIds = await resolveHierarchyIdsForCustomerIds(directCustomerIds);
  cache.set(userId, { ids: fullIds, expiresAt: now + CUSTOMER_SCOPE_CACHE_TTL_MS });

  if (customerScopeInvalidator) {
    try {
      customerScopeInvalidator();
    } catch (_) {
      /* noop */
    }
  }
  return fullIds;
}
