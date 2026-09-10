import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "muted";

type StatusMap<T extends string> = Record<
  T,
  { label: string; variant: BadgeVariant; icon?: ReactNode }
>;

// -------------------
// CustomerStatus
// -------------------
const CUSTOMER_STATUS: StatusMap<string> = {
  PROSPECT: { label: "Prospect", variant: "info" },
  ACTIVE: { label: "Actief", variant: "success" },
  SUSPENDED: { label: "Opgeschort", variant: "warning" },
  INACTIVE: { label: "Inactief", variant: "muted" },
};

export function CustomerStatusBadge({ status }: { status: string }) {
  const s = CUSTOMER_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// SubscriptionStatus
// -------------------
const SUBSCRIPTION_STATUS: StatusMap<string> = {
  DRAFT: { label: "Concept", variant: "muted" },
  PENDING_ACTIVATION: { label: "Te activeren", variant: "warning" },
  ACTIVE: { label: "Actief", variant: "success" },
  SUSPENDED: { label: "Opgeschort", variant: "warning" },
  CANCELLED: { label: "Geannuleerd", variant: "muted" },
  TERMINATED: { label: "Beëindigd", variant: "destructive" },
};

export function SubscriptionStatusBadge({
  status,
}: {
  status: string;
}) {
  const s = SUBSCRIPTION_STATUS[status] ?? {
    label: status,
    variant: "muted" as const,
  };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// TrackerStatus
// -------------------
const TRACKER_STATUS: StatusMap<string> = {
  IN_STOCK: { label: "Op voorraad", variant: "info" },
  RESERVED: { label: "Gereserveerd", variant: "warning" },
  ACTIVE: { label: "Actief", variant: "success" },
  SUSPENDED: { label: "Opgeschort", variant: "warning" },
  DEFECTIVE: { label: "Defect", variant: "destructive" },
  RMA: { label: "RMA", variant: "warning" },
  RETIRED: { label: "Buiten gebruik", variant: "muted" },
  LOST: { label: "Verloren", variant: "destructive" },
};

export function TrackerStatusBadge({ status }: { status: string }) {
  const s = TRACKER_STATUS[status] ?? {
    label: status,
    variant: "muted" as const,
  };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// SimStatus
// -------------------
const SIM_STATUS: StatusMap<string> = {
  IN_STOCK: { label: "Op voorraad", variant: "info" },
  RESERVED: { label: "Gereserveerd", variant: "warning" },
  ACTIVE: { label: "Actief", variant: "success" },
  SUSPENDED: { label: "Opgeschort", variant: "warning" },
  BLOCKED: { label: "Geblokkeerd", variant: "destructive" },
  CANCELLED: { label: "Opgezegd", variant: "muted" },
  RETIRED: { label: "Buiten gebruik", variant: "muted" },
};

export function SimStatusBadge({ status }: { status: string }) {
  const s = SIM_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// ActivationOrderStatus
// -------------------
const ACTIVATION_STATUS: StatusMap<string> = {
  DRAFT: { label: "Concept", variant: "muted" },
  READY: { label: "Gereed", variant: "info" },
  PROCESSING: { label: "Verwerken…", variant: "warning" },
  COMPLETED: { label: "Voltooid", variant: "success" },
  FAILED: { label: "Mislukt", variant: "destructive" },
  CANCELLED: { label: "Geannuleerd", variant: "muted" },
};

export function ActivationOrderStatusBadge({
  status,
}: {
  status: string;
}) {
  const s = ACTIVATION_STATUS[status] ?? {
    label: status,
    variant: "muted" as const,
  };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// UserRole
// -------------------
const ROLE: StatusMap<string> = {
  ADMIN: { label: "Beheerder", variant: "success" },
  EMPLOYEE: { label: "Medewerker", variant: "info" },
  VIEWER: { label: "Alleen-lezen", variant: "muted" },
};

export function UserRoleBadge({ role }: { role: string }) {
  const s = ROLE[role] ?? { label: role, variant: "muted" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// BillingCycle
// -------------------
const BILLING_CYCLE: Record<string, string> = {
  MONTHLY: "Per maand",
  QUARTERLY: "Per kwartaal",
  YEARLY: "Per jaar",
};

export function BillingCycleLabel({ cycle }: { cycle: string }) {
  return <span>{BILLING_CYCLE[cycle] ?? cycle}</span>;
}

// -------------------
// InvoiceStatus
// -------------------
const INVOICE_STATUS: StatusMap<string> = {
  DRAFT: { label: "Concept", variant: "muted" },
  SENT: { label: "Verzonden", variant: "info" },
  PAID: { label: "Betaald", variant: "success" },
  OVERDUE: { label: "Achterstallig", variant: "destructive" },
  CANCELLED: { label: "Geannuleerd", variant: "secondary" },
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const s = INVOICE_STATUS[status] ?? { label: status, variant: "muted" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// -------------------
// AuditAction
// -------------------
const AUDIT_ACTION_VARIANT: Record<string, BadgeVariant> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "destructive",
  ACTIVATE: "success",
  SUSPEND: "warning",
  RESUME: "info",
  CANCEL: "muted",
  TERMINATE: "destructive",
  ASSIGN_TRACKER: "info",
  UNASSIGN_TRACKER: "warning",
  ASSIGN_SIM: "info",
  UNASSIGN_SIM: "warning",
  REPLACE_TRACKER: "warning",
  REPLACE_SIM: "warning",
  COMPLETE_ACTIVATION: "success",
  FAIL_ACTIVATION: "destructive",
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: "Aangemaakt",
  UPDATE: "Gewijzigd",
  DELETE: "Verwijderd",
  ACTIVATE: "Geactiveerd",
  SUSPEND: "Opgeschort",
  RESUME: "Hervat",
  CANCEL: "Geannuleerd",
  TERMINATE: "Beëindigd",
  ASSIGN_TRACKER: "Tracker toegewezen",
  UNASSIGN_TRACKER: "Tracker verwijderd",
  ASSIGN_SIM: "SIM toegewezen",
  UNASSIGN_SIM: "SIM verwijderd",
  REPLACE_TRACKER: "Tracker vervangen",
  REPLACE_SIM: "SIM vervangen",
  COMPLETE_ACTIVATION: "Activatie voltooid",
  FAIL_ACTIVATION: "Activatie mislukt",
};

export function AuditActionBadge({ action }: { action: string }) {
  return (
    <Badge variant={AUDIT_ACTION_VARIANT[action] ?? "muted"}>
      {AUDIT_ACTION_LABEL[action] ?? action}
    </Badge>
  );
}

// -------------------
// AssignmentReason
// -------------------
const ASSIGNMENT_REASON_LABEL: Record<string, string> = {
  INITIAL: "Eerste toewijzing",
  REPLACEMENT: "Vervanging",
  REMOVED: "Verwijderd",
  RMA: "RMA",
  UPGRADE: "Upgrade",
};

export function AssignmentReasonLabel({
  reason,
}: {
  reason: string | null | undefined;
}) {
  if (!reason) return <span className="text-slate-400">—</span>;
  return <span>{ASSIGNMENT_REASON_LABEL[reason] ?? reason}</span>;
}
