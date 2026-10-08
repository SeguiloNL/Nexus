// Enum types als TypeScript enums voor runtime gebruik
// Mirror van Prisma schema enums

export enum UserRole {
  ADMIN = "ADMIN",
  EMPLOYEE = "EMPLOYEE",
  VIEWER = "VIEWER",
}

export enum RoleScope {
  INTERNAL = "INTERNAL",
  CUSTOMER = "CUSTOMER",
  RESELLER = "RESELLER",
  PARTNER = "PARTNER",
}

export enum CustomerType {
  DIRECT = "DIRECT",
  RESELLER = "RESELLER",
  PARTNER = "PARTNER",
}

export enum AccessLevel {
  NONE = "NONE",
  READ = "READ",
  WRITE = "WRITE",
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

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  SENT = "SENT",
  PAID = "PAID",
  OVERDUE = "OVERDUE",
  CANCELLED = "CANCELLED",
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
  HARD_DELETE = "HARD_DELETE",
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
  INSERVE_SYNCED = "INSERVE_SYNCED",
  INSERVE_SYNC_FAILED = "INSERVE_SYNC_FAILED",
  GENERATE_INVOICES = "GENERATE_INVOICES",
  MARK_INVOICE_PAID = "MARK_INVOICE_PAID",
  SEND_INVOICE = "SEND_INVOICE",
  UPDATE_SETTINGS = "UPDATE_SETTINGS",
  BATCH_CREATE = "BATCH_CREATE",
  BATCH_UPDATE = "BATCH_UPDATE",
  BATCH_ERROR = "BATCH_ERROR",
  SIMHUIS_SYNCED = "SIMHUIS_SYNCED",
  SIMHUIS_SYNC_FAILED = "SIMHUIS_SYNC_FAILED",
  CLONE_ROLE = "CLONE_ROLE",
  LINK_USER_CUSTOMER = "LINK_USER_CUSTOMER",
  UNLINK_USER_CUSTOMER = "UNLINK_USER_CUSTOMER",
  TOGGLE_USER_ACTIVE = "TOGGLE_USER_ACTIVE",
  BULK_UPDATE_ROLE = "BULK_UPDATE_ROLE",
  INSERVE_CUSTOMERS_IMPORTED = "INSERVE_CUSTOMERS_IMPORTED",
  INSERVE_CUSTOMER_IMPORT_FAILED = "INSERVE_CUSTOMER_IMPORT_FAILED",
}

export type ResourceAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "import"
  | "export"
  | "override_price"
  | "purge_network"
  | "suspend_sim"
  | "view_all_sim_usage_dashboard"
  | "import_from_inserve";

export type ActionOverrides = Partial<
  Record<ResourceType, Partial<Record<ResourceAction, boolean>>>
>;

export type ResourceType =
  | "customer"
  | "tracker"
  | "sim"
  | "vehicle"
  | "subscription"
  | "product"
  | "activation_order"
  | "invoice"
  | "user"
  | "audit_log"
  | "setting"
  | "dashboard"
  | "role";

/* ========================= Sync-Schedule enums (mirror Prisma) ========================= */

export enum SyncFrequency {
  EVERY_15_MINUTES = "EVERY_15_MINUTES",
  EVERY_30_MINUTES = "EVERY_30_MINUTES",
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
}

export enum SyncJobStatus {
  QUEUED = "QUEUED",
  RUNNING = "RUNNING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
  TIMEOUT = "TIMEOUT",
}

export enum SyncJobTrigger {
  MANUAL_ADMIN = "MANUAL_ADMIN",
  SYSTEMD_TIMER = "SYSTEMD_TIMER",
  FALLBACK_POLLING = "FALLBACK_POLLING",
  API_TOKEN = "API_TOKEN",
}

export enum SyncJobId {
  SIMHUIS_USAGE = "SIMHUIS_USAGE",
  SIMHUIS_SIMS = "SIMHUIS_SIMS",
  SIMHUIS_USAGE_ALERT_NOTIFY = "SIMHUIS_USAGE_ALERT_NOTIFY",
  INSERVE = "INSERVE",
  INSERVE_CUSTOMER_IMPORT = "INSERVE_CUSTOMER_IMPORT",
}

export const ALL_RESOURCE_TYPES: ResourceType[] = [
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
  "role",
];

export const CUSTOMER_SCOPE_RESOURCES: ResourceType[] = [
  "customer",
  "tracker",
  "sim",
  "vehicle",
  "subscription",
  "invoice",
  "dashboard",
];

export const RESELLER_SCOPE_RESOURCES: ResourceType[] = [
  "customer",
  "tracker",
  "sim",
  "vehicle",
  "subscription",
  "activation_order",
  "invoice",
  "dashboard",
];

export const PARTNER_SCOPE_RESOURCES: ResourceType[] = [
  "customer",
  "tracker",
  "sim",
  "vehicle",
  "subscription",
  "activation_order",
  "invoice",
  "dashboard",
];
