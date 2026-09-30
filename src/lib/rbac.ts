import type {
  ResourceAction,
  ResourceType,
} from "@/types/enums";
import {
  UserRole,
  RoleScope,
  ALL_RESOURCE_TYPES,
  CUSTOMER_SCOPE_RESOURCES,
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

  const allowedResources =
    safeScope === RoleScope.CUSTOMER
      ? CUSTOMER_SCOPE_RESOURCES
      : ALL_RESOURCE_TYPES;

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
  if (action === "view") return "read";
  return "write";
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
  const bit = actionToBit(action);
  const entry = bits[resource];
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
  if (role === "CUSTOMER" || role === "INTERNAL") {
    return role === "INTERNAL" && minRole === "VIEWER";
  }
  const order: UserRole[] = ["VIEWER", "EMPLOYEE", "ADMIN"] as UserRole[];
  return order.indexOf(role as UserRole) >= order.indexOf(minRole);
}

export function isInternalScope(scope: RoleScope | null | undefined): boolean {
  return scope === "INTERNAL";
}

export function isCustomerScope(scope: RoleScope | null | undefined): boolean {
  return scope === "CUSTOMER";
}
