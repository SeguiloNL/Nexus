import type {
  UserRole,
  CustomerStatus,
  SubscriptionStatus,
  TrackerStatus,
  SimStatus,
  ActivationOrderStatus,
  BillingCycle,
  AssignmentReason,
  AuditAction,
} from "./enums";

// ------------------------------
// Shared
// ------------------------------

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  perPage?: number;
}

export interface SortParams {
  sort?: string;
  order?: "asc" | "desc";
}

export interface SearchParams {
  search?: string;
}

export interface ListQueryParams
  extends PaginationParams,
    SortParams,
    SearchParams {}

export interface OperationContext {
  userId: string;
  userRole: UserRole;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ------------------------------
// User
// ------------------------------

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  password?: string;
}

// ------------------------------
// Customer
// ------------------------------

export interface CustomerFilterParams extends ListQueryParams {
  status?: CustomerStatus;
  parentCustomerId?: string;
  isParent?: boolean;
}

export interface CreateCustomerInput {
  customerNumber?: string;
  companyName: string;
  parentCustomerId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
}

export interface UpdateCustomerInput {
  companyName?: string;
  parentCustomerId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
}

// ------------------------------
// Product
// ------------------------------

export interface CreateProductInput {
  name: string;
  productCode: string;
  description?: string | null;
  monthlyPrice: number;
  currency?: string;
  isActive?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  productCode?: string;
  description?: string | null;
  monthlyPrice?: number;
  currency?: string;
  isActive?: boolean;
}

// ------------------------------
// Tracker
// ------------------------------

export interface TrackerFilterParams extends ListQueryParams {
  status?: TrackerStatus;
  brand?: string;
  model?: string;
  assignedOnly?: boolean;
}

export interface CreateTrackerInput {
  serialNumber: string;
  imei: string;
  brand: string;
  model: string;
  hardwareType?: string | null;
  firmwareVersion?: string | null;
  purchaseDate?: Date | string | null;
  supplier?: string | null;
  status?: TrackerStatus;
  notes?: string | null;
}

export interface UpdateTrackerInput {
  serialNumber?: string;
  imei?: string;
  brand?: string;
  model?: string;
  hardwareType?: string | null;
  firmwareVersion?: string | null;
  purchaseDate?: Date | string | null;
  supplier?: string | null;
  status?: TrackerStatus;
  notes?: string | null;
}

// ------------------------------
// SIM
// ------------------------------

export interface SimFilterParams extends ListQueryParams {
  status?: SimStatus;
  provider?: string;
}

export interface CreateSimInput {
  iccid: string;
  msisdn?: string | null;
  imsi?: string | null;
  provider: string;
  simType?: string | null;
  apn?: string | null;
  status?: SimStatus;
  providerActivationDate?: Date | string | null;
  providerDeactivationDate?: Date | string | null;
  notes?: string | null;
}

export interface UpdateSimInput {
  iccid?: string;
  msisdn?: string | null;
  imsi?: string | null;
  provider?: string;
  simType?: string | null;
  apn?: string | null;
  status?: SimStatus;
  providerActivationDate?: Date | string | null;
  providerDeactivationDate?: Date | string | null;
  notes?: string | null;
}

// ------------------------------
// Vehicle
// ------------------------------

export interface CreateVehicleInput {
  customerId: string;
  licensePlate?: string | null;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  notes?: string | null;
}

export interface UpdateVehicleInput {
  customerId?: string;
  licensePlate?: string | null;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  notes?: string | null;
}

// ------------------------------
// Subscription
// ------------------------------

export interface SubscriptionFilterParams extends ListQueryParams {
  customerId?: string;
  productId?: string;
  status?: SubscriptionStatus;
}

export interface CreateSubscriptionInput {
  subscriptionNumber?: string;
  customerId: string;
  productId: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  status?: SubscriptionStatus;
  monthlyPrice: number;
  billingCycle?: BillingCycle;
  notes?: string | null;
}

export interface UpdateSubscriptionInput {
  customerId?: string;
  productId?: string;
  startDate?: Date | string;
  endDate?: Date | string | null;
  status?: SubscriptionStatus;
  monthlyPrice?: number;
  billingCycle?: BillingCycle;
  notes?: string | null;
}

export interface UpdateSubscriptionStatusInput {
  status: SubscriptionStatus;
  reason?: string;
}

// ------------------------------
// Activation Order
// ------------------------------

export interface ActivationOrderFilterParams extends ListQueryParams {
  customerId?: string;
  status?: ActivationOrderStatus;
  productId?: string;
  trackerId?: string;
  simId?: string;
}

export interface CreateActivationOrderInput {
  orderNumber?: string;
  customerId: string;
  subCustomerId?: string | null;
  productId: string;
  desiredStartDate: Date | string;
  monthlyPrice: number;
  billingCycle?: BillingCycle;
  trackerId?: string | null;
  simId?: string | null;
  vehicleId?: string | null;
  internalNotes?: string | null;
}

// ------------------------------
// Tracker/Sim Assignment
// ------------------------------

export interface AssignTrackerInput {
  subscriptionId: string;
  trackerId: string;
  vehicleId?: string | null;
  reason?: AssignmentReason;
}

export interface UnassignTrackerInput {
  trackerId: string;
  newTrackerStatus?: TrackerStatus;
  reason?: AssignmentReason;
}

export interface ReplaceTrackerInput {
  subscriptionId: string;
  oldTrackerId: string;
  newTrackerId: string;
  oldTrackerDisposition: TrackerStatus.IN_STOCK | TrackerStatus.RETIRED | TrackerStatus.DEFECTIVE | TrackerStatus.RMA;
  reason?: string;
}

export interface AssignSimInput {
  subscriptionId: string;
  simId: string;
  reason?: AssignmentReason;
}

export interface UnassignSimInput {
  simId: string;
  newSimStatus?: SimStatus;
  reason?: AssignmentReason;
}

export interface ReplaceSimInput {
  subscriptionId: string;
  oldSimId: string;
  newSimId: string;
  oldSimDisposition: SimStatus.IN_STOCK | SimStatus.RETIRED | SimStatus.CANCELLED;
  reason?: string;
}

// ------------------------------
// Audit Log
// ------------------------------

export interface AuditLogFilterParams extends ListQueryParams {
  userId?: string;
  entityType?: string;
  action?: AuditAction;
  fromDate?: Date | string;
  toDate?: Date | string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName?: string;
  timestamp: Date;
  entityType: string;
  entityId: string;
  action: AuditAction;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

// ------------------------------
// Dashboard
// ------------------------------

export interface DashboardStats {
  activeSubscriptions: number;
  pendingActivations: number;
  trackersInStock: number;
  activeTrackers: number;
  defectiveTrackers: number;
  simsInStock: number;
  activeSims: number;
  openActivationOrders: number;
  failedActivationsToday: number;
}

export interface RecentActivation {
  id: string;
  orderNumber: string;
  customerName: string;
  customerId: string;
  subscriptionId: string | null;
  trackerImei: string | null;
  simIccid: string | null;
  completedAt: Date;
}
