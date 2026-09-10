import type { UserRole, ResourceAction, ResourceType } from "@/types/enums";

type PermissionMatrix = Record<
  UserRole,
  Partial<Record<ResourceAction, ResourceType[]>>
>;

// Permissie matrix uit spec.md §7
const ALL_WRITE: ResourceType[] = [
  "customer",
  "tracker",
  "sim",
  "vehicle",
  "subscription",
  "product",
  "activation_order",
  "invoice",
];

const RBAC_MATRIX: PermissionMatrix = {
  ADMIN: {
    view: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
      "invoice",
      "user",
      "audit_log",
      "setting",
      "dashboard",
    ],
    create: [...ALL_WRITE],
    edit: [...ALL_WRITE],
    delete: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
      "invoice",
      "user",
    ],
    import: ["tracker", "sim", "customer"],
    export: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "activation_order",
      "invoice",
      "audit_log",
    ],
    override_price: ["subscription", "product", "activation_order"],
  },
  EMPLOYEE: {
    view: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
      "invoice",
      "audit_log",
      "dashboard",
    ],
    create: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
    ],
    edit: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
      "invoice",
    ],
    delete: [],
    import: ["tracker", "sim", "customer"],
    export: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "activation_order",
      "invoice",
    ],
  },
  VIEWER: {
    view: [
      "customer",
      "tracker",
      "sim",
      "vehicle",
      "subscription",
      "product",
      "activation_order",
      "invoice",
      "audit_log",
      "dashboard",
    ],
  },
};

/**
 * Controleert of een rol een actie mag uitvoeren op een resource.
 * Dit is de enig waarheidsbron voor RBAC binnen de applicatie.
 */
export function can(
  role: UserRole,
  action: ResourceAction,
  resource: ResourceType
): boolean {
  const actions = RBAC_MATRIX[role];
  if (!actions) return false;

  const resources = actions[action];
  if (!resources) return false;

  return resources.includes(resource);
}

/**
 * Gooit een PermissionError indien `can` false teruggeeft.
 */
export function requirePermission(
  role: UserRole,
  action: ResourceAction,
  resource: ResourceType,
  customMessage?: string
): void {
  if (!can(role, action, resource)) {
    throw new PermissionError(
      customMessage ??
        `Onvoldoende rechten: rol ${role} mag ${action} niet uitvoeren op ${resource}.`
    );
  }
}

export class PermissionError extends Error {
  public readonly statusCode = 403;
  public readonly code = "PERMISSION_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * Hulpfunctie: minimum rol-vereiste (ADMIN > EMPLOYEE > VIEWER).
 * Nuttig voor actions waar alleen ADMIN toegang toe heeft.
 */
export function hasMinRole(role: UserRole, minRole: UserRole): boolean {
  const order: UserRole[] = ["VIEWER", "EMPLOYEE", "ADMIN"] as UserRole[];
  return order.indexOf(role) >= order.indexOf(minRole);
}
