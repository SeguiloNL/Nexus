// Enum types als TypeScript enums voor runtime gebruik
// Mirror van Prisma schema enums

export enum UserRole {
  ADMIN = "ADMIN",
  EMPLOYEE = "EMPLOYEE",
  VIEWER = "VIEWER",
}

export enum CustomerStatus {
  PROSPECT = "PROSPECT",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  INACTIVE = "INACTIVE",
}

export enum SubscriptionStatus {
  DRAFT = "DRAFT",
  PENDING_ACTIVATION = "PENDING_ACTIVATION",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  CANCELLED = "CANCELLED",
  TERMINATED = "TERMINATED",
}

export enum TrackerStatus {
  IN_STOCK = "IN_STOCK",
  RESERVED = "RESERVED",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  DEFECTIVE = "DEFECTIVE",
  RMA = "RMA",
  RETIRED = "RETIRED",
  LOST = "LOST",
}

export enum SimStatus {
  IN_STOCK = "IN_STOCK",
  RESERVED = "RESERVED",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  BLOCKED = "BLOCKED",
  CANCELLED = "CANCELLED",
  RETIRED = "RETIRED",
}

export enum ActivationOrderStatus {
  DRAFT = "DRAFT",
  READY = "READY",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export enum BillingCycle {
  MONTHLY = "MONTHLY",
  QUARTERLY = "QUARTERLY",
  YEARLY = "YEARLY",
}

export enum AssignmentReason {
  INITIAL = "INITIAL",
  REPLACEMENT = "REPLACEMENT",
  REMOVED = "REMOVED",
  RMA = "RMA",
  UPGRADE = "UPGRADE",
}

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  ACTIVATE = "ACTIVATE",
  SUSPEND = "SUSPEND",
  RESUME = "RESUME",
  CANCEL = "CANCEL",
  TERMINATE = "TERMINATE",
  ASSIGN_TRACKER = "ASSIGN_TRACKER",
  UNASSIGN_TRACKER = "UNASSIGN_TRACKER",
  ASSIGN_SIM = "ASSIGN_SIM",
  UNASSIGN_SIM = "UNASSIGN_SIM",
  REPLACE_TRACKER = "REPLACE_TRACKER",
  REPLACE_SIM = "REPLACE_SIM",
  COMPLETE_ACTIVATION = "COMPLETE_ACTIVATION",
  FAIL_ACTIVATION = "FAIL_ACTIVATION",
}

export type ResourceAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "import"
  | "export"
  | "override_price";

export type ResourceType =
  | "customer"
  | "tracker"
  | "sim"
  | "vehicle"
  | "subscription"
  | "product"
  | "activation_order"
  | "user"
  | "audit_log"
  | "setting";
