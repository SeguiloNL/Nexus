"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useFormState } from "react-dom";
import {
  ArrowLeft,
  Edit,
  Info,
  CreditCard,
  Phone,
  Calendar,
  Globe,
  FileText,
  History,
  Trash2,
  Package,
  Database,
  MessageSquare,
  Users,
  Activity,
  AlertTriangle,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { SimStatusBadge, AssignmentReasonLabel } from "@/components/ui/status-badges";
import { SimForm } from "./sim-form";
import {
  formatDate,
  formatDateTime,
  formatIccid,
  formatMsisdn,
  formatBytes,
  formatCount,
} from "@/lib/formatters";
import { canUserRole } from "@/lib/auth/session";
import { SIM_PROVIDER_UI_LABELS } from "@/lib/providers/provider-registry";
import type { UserRole, AuditAction } from "@/types/enums";
import type { SIM, SimStatus, AssignmentReason } from "@prisma/client";
import type { SimUsageSyncState, SimSuspendActionState, SimStatusRefreshActionState } from "../actions";

type DetailSim = SIM & {
  assignments: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    reason: AssignmentReason | null;
    subscription: {
      id: string;
      subscriptionNumber: string;
      customer: {
        id: string;
        companyName: string;
        customerNumber: string;
      } | null;
    } | null;
  }>;
};

type AuditLogForDetail = Array<{
  id: string;
  timestamp: Date;
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValues: any;
  newValues: any;
  user: { name: string | null; email: string } | null;
}>;

type SimDetailProps = {
  sim: DetailSim;
  role: UserRole;
  updateAction: (
    simId: string,
    prev: any,
    formData: FormData
  ) => Promise<any>;
  deleteAction: (simId: string) => Promise<void>;
  simId: string;
  auditLogs?: AuditLogForDetail;
  syncUsageAction: (
    simId: string,
    prev: SimUsageSyncState,
    formData: FormData
  ) => Promise<SimUsageSyncState>;
  suspendAction?: (
    simId: string,
    prev: SimSuspendActionState,
    formData: FormData
  ) => Promise<SimSuspendActionState>;
  unsuspendAction?: (
    simId: string,
    prev: SimSuspendActionState,
    formData: FormData
  ) => Promise<SimSuspendActionState>;
  refreshStatusAction: (
    simId: string,
    prev: SimStatusRefreshActionState,
    formData: FormData
  ) => Promise<SimStatusRefreshActionState>;
  isAdmin: boolean;
};

type SuspendSimDialogProps = {
  sim: DetailSim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  hasResult: boolean;
};

function SuspendSimDialog({
  sim,
  open,
  onOpenChange,
  formAction,
  isPending,
  hasResult,
}: SuspendSimDialogProps) {
  const submittedRef = useRef(false);
  const emergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPendingClient, setIsPendingClient] = useState(false);
  const [isTransitioning, startTransition] = useTransition();

  const combinedPending = isPending || isPendingClient || isTransitioning;

  useEffect(() => {
    if ((open === false && hasResult) || (hasResult && !combinedPending)) {
      submittedRef.current = false;
      setIsPendingClient(false);
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    }
  }, [open, combinedPending, hasResult]);

  useEffect(() => {
    return () => {
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    };
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (submittedRef.current || combinedPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    submittedRef.current = true;
    setIsPendingClient(true);
    if (emergencyTimerRef.current) clearTimeout(emergencyTimerRef.current);
    emergencyTimerRef.current = setTimeout(() => {
      console.warn("[sim-detail] ⏹️ Blokkeren noodstop na 18s timeout.");
      submittedRef.current = false;
      setIsPendingClient(false);
      emergencyTimerRef.current = null;
    }, 18_000);
    startTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        formAction(fd);
      } finally {
        setTimeout(() => {
          setIsPendingClient(false);
          submittedRef.current = false;
          if (emergencyTimerRef.current) {
            clearTimeout(emergencyTimerRef.current);
            emergencyTimerRef.current = null;
          }
        }, 0);
      }
    });
    e.preventDefault();
  }

  const simLabel = sim.simName && sim.simName.trim() ? sim.simName : formatIccid(sim.iccid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          disabled={combinedPending}
          aria-busy={combinedPending}
          aria-disabled={combinedPending}
        >
          {combinedPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Bezig met blokkeren…
            </>
          ) : (
            <>
              <PauseCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Blokkeren
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simkaart blokkeren?</DialogTitle>
          <DialogDescription>
            Je blokkeert simkaart <strong>{simLabel}</strong> tijdelijk. Wil je doorgaan?
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={combinedPending}>
                Annuleren
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={combinedPending}
              aria-busy={combinedPending}
              aria-disabled={combinedPending}
            >
              {combinedPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Bezig met blokkeren…
                </>
              ) : (
                <>Blokkeren</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type UnsuspendSimDialogProps = {
  sim: DetailSim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formAction: (payload: FormData) => void;
  isPending: boolean;
  hasResult: boolean;
};

function UnsuspendSimDialog({
  sim,
  open,
  onOpenChange,
  formAction,
  isPending,
  hasResult,
}: UnsuspendSimDialogProps) {
  const submittedRef = useRef(false);
  const emergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPendingClient, setIsPendingClient] = useState(false);
  const [isTransitioning, startTransition] = useTransition();

  const combinedPending = isPending || isPendingClient || isTransitioning;

  useEffect(() => {
    if ((open === false && hasResult) || (hasResult && !combinedPending)) {
      submittedRef.current = false;
      setIsPendingClient(false);
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    }
  }, [open, combinedPending, hasResult]);

  useEffect(() => {
    return () => {
      if (emergencyTimerRef.current) {
        clearTimeout(emergencyTimerRef.current);
        emergencyTimerRef.current = null;
      }
    };
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (submittedRef.current || combinedPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    submittedRef.current = true;
    setIsPendingClient(true);
    if (emergencyTimerRef.current) clearTimeout(emergencyTimerRef.current);
    emergencyTimerRef.current = setTimeout(() => {
      console.warn("[sim-detail] ⏹️ Deblokkeren noodstop na 18s timeout.");
      submittedRef.current = false;
      setIsPendingClient(false);
      emergencyTimerRef.current = null;
    }, 18_000);
    startTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        formAction(fd);
      } finally {
        setTimeout(() => {
          setIsPendingClient(false);
          submittedRef.current = false;
          if (emergencyTimerRef.current) {
            clearTimeout(emergencyTimerRef.current);
            emergencyTimerRef.current = null;
          }
        }, 0);
      }
    });
    e.preventDefault();
  }

  const simLabel = sim.simName && sim.simName.trim() ? sim.simName : formatIccid(sim.iccid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={combinedPending}
          aria-busy={combinedPending}
          aria-disabled={combinedPending}
        >
          {combinedPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Bezig met deblokkeren…
            </>
          ) : (
            <>
              <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Deblokkeren
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simkaart deblokkeren?</DialogTitle>
          <DialogDescription>
            Je deblokkeert simkaart <strong>{simLabel}</strong> en maakt deze opnieuw
            actief. Weet je zeker dat je wilt doorgaan?
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <DialogFooter className="gap-2 sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={combinedPending}>
                Annuleren
              </Button>
            </DialogClose>
            <Button
              type="submit"
              variant="secondary"
              disabled={combinedPending}
              aria-busy={combinedPending}
              aria-disabled={combinedPending}
            >
              {combinedPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Bezig met deblokkeren…
                </>
              ) : (
                <>Deblokkeren</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteSimDialogProps = {
  sim: DetailSim;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

function DeleteSimDialog({
  sim,
  open,
  onOpenChange,
  onConfirm,
}: DeleteSimDialogProps) {
  const [isPendingClient, setIsPendingClient] = useState(false);
  const simLabel = sim.simName && sim.simName.trim() ? sim.simName : formatIccid(sim.iccid);

  function handleConfirm() {
    setIsPendingClient(true);
    try {
      onConfirm();
    } finally {
      setTimeout(() => {
        setIsPendingClient(false);
      }, 0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          disabled={isPendingClient}
          aria-busy={isPendingClient}
          aria-disabled={isPendingClient}
        >
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Verwijderen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simkaart definitief verwijderen?</DialogTitle>
          <DialogDescription>
            Je verwijdert simkaart <strong>{simLabel}</strong> definitief uit het
            systeem. Deze actie is onomkeerbaar en kan niet ongedaan worden
            gemaakt.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isPendingClient}>
              Annuleren
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={isPendingClient}
            aria-busy={isPendingClient}
            aria-disabled={isPendingClient}
            onClick={handleConfirm}
          >
            {isPendingClient ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Verwijderen…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Definitief verwijderen
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderActionResult(s: SimSuspendActionState, action: "suspend" | "unsuspend", lastAction: "suspend" | "unsuspend" | null): React.ReactNode {
  if (!s || (!s.message && !s.error)) return null;

  if (lastAction && lastAction !== action && !s.ok && !s.error) return null;
  if (lastAction && lastAction !== action) {
    if (s.ok && !s.pendingConfirmation && (s.confirmedStatus === "ACTIVE" || s.confirmedStatus === "SUSPENDED")) {
      const successFor = s.confirmedStatus === "ACTIVE" ? "unsuspend" : "suspend";
      if (successFor !== lastAction) return null;
    }
  }

  if (s.ok && s.confirmedStatus === "SUSPENDED") {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm w-full"
        key="banner-suspend-success"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-emerald-900">Simkaart geblokkeerd</p>
          {s.message ? <p className="whitespace-pre-wrap break-words text-emerald-800/90">{s.message}</p> : null}
        </div>
      </div>
    );
  }
  if (s.ok && s.confirmedStatus === "ACTIVE") {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm w-full"
        key="banner-unsuspend-success"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-emerald-900">Simkaart gedeblokkeerd</p>
          {s.message ? <p className="whitespace-pre-wrap break-words text-emerald-800/90">{s.message}</p> : null}
        </div>
      </div>
    );
  }
  if (s.ok && s.pendingConfirmation) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 shadow-sm w-full"
        key={`banner-pending-${action}`}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-amber-900">Statuswijziging in behandeling</p>
          <p className="whitespace-pre-wrap break-words text-amber-800/90">
            {s.message || "Het verzoek is verwerkt. De statuswijziging is nog niet bevestigd."}
          </p>
          <p className="mt-1 text-xs text-amber-700/80">
            De provider kan enige tijd nodig hebben om de wijziging te verwerken. Controleer over enkele seconden opnieuw of ververs handmatig de SIM-status.
          </p>
        </div>
      </div>
    );
  }
  if (s.error || (!s.ok && s.message)) {
    const kind = s.error?.kind;
    const isTimeout = kind === "TIMEOUT_OR_NETWORK";
    const isWarning = isTimeout && s.ok === true;
    const isInvalid = kind === "INVALID_STATUS_TRANSITION";
    const isPermission = kind === "PERMISSION";
    const title = isPermission
      ? "Onvoldoende rechten"
      : isInvalid
        ? "Actie niet mogelijk"
        : isWarning
          ? "Status nog niet bevestigd"
          : isTimeout
            ? "Verzoek mislukt"
            : "Fout bij verzoek";
    const border = isWarning
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : isInvalid
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-red-300 bg-red-50 text-red-800";
    const iconColor = isWarning || isInvalid ? "text-amber-600" : "text-red-600";
    const titleColor = isWarning || isInvalid ? "text-amber-900" : "text-red-900";
    return (
      <div
        role={isWarning || isInvalid ? "status" : "alert"}
        className={`flex items-start gap-2.5 rounded-md border ${border} px-3.5 py-2.5 text-sm shadow-sm w-full`}
        key={`banner-${isWarning ? "warning" : "error"}-${action}`}
      >
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${titleColor}`}>{title}</p>
          <p className={`whitespace-pre-wrap break-words ${isWarning || isInvalid ? "text-amber-800/90" : "text-red-800/90"}`}>
            {s.message || s.error?.detail || "Onbekende fout."}
          </p>
          {isTimeout ? (
            <p className={`mt-1 text-xs ${isWarning || isInvalid ? "text-amber-700/80" : "text-red-700/80"}`}>
              {isWarning
                ? "Herhaal het verzoek niet blind. Controleer eerst de actuele SIM-status alvorens opnieuw te proberen of ververs handmatig."
                : "Herhaal het verzoek niet blind. Controleer eerst de actuele SIM-status alvorens opnieuw te proberen."}
            </p>
          ) : null}
        </div>
      </div>
    );
  }
  return null;
}

export function SimDetail({
  sim,
  role,
  updateAction,
  deleteAction,
  simId,
  auditLogs = [],
  syncUsageAction,
  suspendAction,
  unsuspendAction,
  refreshStatusAction,
  isAdmin,
}: SimDetailProps) {
  const canEdit = canUserRole(role, "edit", "sim");
  const canDelete = canUserRole(role, "delete", "sim");
  const canSyncUsage = canUserRole(role, "view", "sim");

  const [, deleteFormAction] = useFormState(
    async (_p: unknown) => deleteAction(simId),
    undefined
  );

  const [usageSyncState, usageSyncFormAction, usageSyncPendingNative] = useFormState(
    syncUsageAction.bind(null, simId),
    { ok: false } satisfies SimUsageSyncState
  );

  const [isUsageSyncPendingClient, setIsUsageSyncPendingClient] = useState(false);
  const [isUsageSyncTransitioning, startUsageSyncTransition] = useTransition();
  const usageSubmittedRef = useRef(false);
  const prevUsageSyncStateRef = useRef(usageSyncState);
  const usageEmergencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usageSyncPending =
    isUsageSyncPendingClient || isUsageSyncTransitioning || usageSyncPendingNative;

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lastAction, setLastAction] = useState<"suspend" | "unsuspend" | null>(null);

  useEffect(() => {
    if (suspendOpen) setLastAction("suspend");
  }, [suspendOpen]);
  useEffect(() => {
    if (unsuspendOpen) setLastAction("unsuspend");
  }, [unsuspendOpen]);
  const [suspendState, suspendFormAction, suspendPendingNative] = useFormState(
    suspendAction ? suspendAction.bind(null, simId) : async () => ({ ok: false, confirmedStatus: null, pendingConfirmation: false, message: "", error: undefined }) as SimSuspendActionState,
    { ok: false, confirmedStatus: null, pendingConfirmation: false, message: "", error: undefined } satisfies SimSuspendActionState
  );
  const [unsuspendState, unsuspendFormAction, unsuspendPendingNative] = useFormState(
    unsuspendAction ? unsuspendAction.bind(null, simId) : async () => ({ ok: false, confirmedStatus: null, pendingConfirmation: false, message: "", error: undefined }) as SimSuspendActionState,
    { ok: false, confirmedStatus: null, pendingConfirmation: false, message: "", error: undefined } satisfies SimSuspendActionState
  );

  const [refreshState, refreshFormAction, refreshPendingNative] = useFormState(
    refreshStatusAction.bind(null, simId),
    { ok: false, message: "" } satisfies SimStatusRefreshActionState
  );
  const [isStatusRefreshPendingClient, setIsStatusRefreshPendingClient] = useState(false);
  const [isStatusRefreshTransitioning, startStatusRefreshTransition] = useTransition();
  const statusRefreshSubmittedOnceRef = useRef(false);
  const statusRefreshRanRef = useRef(false);
  const prevRefreshStateRef = useRef(refreshState);
  const [simStatusOverride, setSimStatusOverride] = useState<SimStatus | null>(null);
  const statusRefreshEmergencyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isStatusRefreshPending =
    isStatusRefreshPendingClient ||
    isStatusRefreshTransitioning ||
    refreshPendingNative;

  const effectiveSimStatus: SimStatus = simStatusOverride ?? sim.status;

  const prevSuspendStateRef = useRef(suspendState);
  const prevUnsuspendStateRef = useRef(unsuspendState);

  useEffect(() => {
    const prev = prevSuspendStateRef.current;
    const curr = suspendState;
    const changed =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        (prev?.message !== curr?.message) ||
        (prev?.confirmedStatus !== curr?.confirmedStatus) ||
        (prev?.pendingConfirmation !== curr?.pendingConfirmation) ||
        (prev?.error !== curr?.error));
    if (changed && (curr?.ok || curr?.error) && !suspendPendingNative) {
      setSuspendOpen(false);
    }
    prevSuspendStateRef.current = curr;
  }, [suspendState, suspendPendingNative]);

  useEffect(() => {
    const prev = prevUnsuspendStateRef.current;
    const curr = unsuspendState;
    const changed =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        (prev?.message !== curr?.message) ||
        (prev?.confirmedStatus !== curr?.confirmedStatus) ||
        (prev?.pendingConfirmation !== curr?.pendingConfirmation) ||
        (prev?.error !== curr?.error));
    if (changed && (curr?.ok || curr?.error) && !unsuspendPendingNative) {
      setUnsuspendOpen(false);
    }
    prevUnsuspendStateRef.current = curr;
  }, [unsuspendState, unsuspendPendingNative]);

  useEffect(() => {
    const prev = prevUsageSyncStateRef.current;
    const curr = usageSyncState;
    const stateChanged =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        (prev?.message !== curr?.message) ||
        (prev?.error !== curr?.error));
    if (stateChanged || (!usageSyncPendingNative && isUsageSyncPendingClient)) {
      usageSubmittedRef.current = false;
      setIsUsageSyncPendingClient(false);
      if (usageEmergencyTimerRef.current) {
        clearTimeout(usageEmergencyTimerRef.current);
        usageEmergencyTimerRef.current = null;
      }
    }
    prevUsageSyncStateRef.current = curr;
  }, [usageSyncState, usageSyncPendingNative]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (usageEmergencyTimerRef.current) {
        clearTimeout(usageEmergencyTimerRef.current);
        usageEmergencyTimerRef.current = null;
      }
      if (statusRefreshEmergencyRef.current) {
        clearTimeout(statusRefreshEmergencyRef.current);
        statusRefreshEmergencyRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const prev = prevRefreshStateRef.current;
    const curr = refreshState;
    const stateChanged =
      prev !== curr &&
      ((prev?.ok !== curr?.ok) ||
        (prev?.message !== curr?.message) ||
        (prev?.changed !== curr?.changed) ||
        (prev?.refreshedStatus !== curr?.refreshedStatus) ||
        (prev?.error !== curr?.error));
    if (stateChanged || (!refreshPendingNative && isStatusRefreshPendingClient)) {
      statusRefreshSubmittedOnceRef.current = false;
      setIsStatusRefreshPendingClient(false);
      if (statusRefreshEmergencyRef.current) {
        clearTimeout(statusRefreshEmergencyRef.current);
        statusRefreshEmergencyRef.current = null;
      }
      if (curr?.ok && curr?.changed && curr?.refreshedStatus) {
        setSimStatusOverride(curr.refreshedStatus as SimStatus);
      }
    }
    prevRefreshStateRef.current = curr;
  }, [refreshState, refreshPendingNative]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (statusRefreshRanRef.current) return;
    if (!refreshStatusAction) return;
    statusRefreshRanRef.current = true;
    statusRefreshSubmittedOnceRef.current = true;
    setIsStatusRefreshPendingClient(true);
    if (statusRefreshEmergencyRef.current) clearTimeout(statusRefreshEmergencyRef.current);
    statusRefreshEmergencyRef.current = setTimeout(() => {
      console.warn("[sim-detail] ⏹️ Status refresh noodstop na 12s timeout (achtergrond sync gaat door).");
      statusRefreshSubmittedOnceRef.current = false;
      setIsStatusRefreshPendingClient(false);
      statusRefreshEmergencyRef.current = null;
    }, 12_000);
    startStatusRefreshTransition(async () => {
      try {
        const fd = new FormData();
        await refreshFormAction(fd);
      } catch (err: any) {
        console.error("[sim-detail] Status refresh action exception:", err);
      } finally {
        setTimeout(() => {
          setIsStatusRefreshPendingClient(false);
          statusRefreshSubmittedOnceRef.current = false;
          if (statusRefreshEmergencyRef.current) {
            clearTimeout(statusRefreshEmergencyRef.current);
            statusRefreshEmergencyRef.current = null;
          }
        }, 0);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function triggerManualStatusRefresh() {
    if (statusRefreshSubmittedOnceRef.current || isStatusRefreshPending) return;
    statusRefreshSubmittedOnceRef.current = true;
    setIsStatusRefreshPendingClient(true);
    if (statusRefreshEmergencyRef.current) clearTimeout(statusRefreshEmergencyRef.current);
    statusRefreshEmergencyRef.current = setTimeout(() => {
      console.warn("[sim-detail] ⏹️ Status refresh noodstop na 12s timeout (achtergrond sync gaat door).");
      statusRefreshSubmittedOnceRef.current = false;
      setIsStatusRefreshPendingClient(false);
      statusRefreshEmergencyRef.current = null;
    }, 12_000);
    startStatusRefreshTransition(async () => {
      try {
        const fd = new FormData();
        await refreshFormAction(fd);
      } catch (err: any) {
        console.error("[sim-detail] Status refresh action exception:", err);
      } finally {
        setTimeout(() => {
          setIsStatusRefreshPendingClient(false);
          statusRefreshSubmittedOnceRef.current = false;
          if (statusRefreshEmergencyRef.current) {
            clearTimeout(statusRefreshEmergencyRef.current);
            statusRefreshEmergencyRef.current = null;
          }
        }, 0);
      }
    });
  }

  function onUsageSyncSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (usageSubmittedRef.current || usageSyncPending) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    usageSubmittedRef.current = true;
    setIsUsageSyncPendingClient(true);
    if (usageEmergencyTimerRef.current) clearTimeout(usageEmergencyTimerRef.current);
    usageEmergencyTimerRef.current = setTimeout(() => {
      console.warn('[sim-detail] ⏹️ Usage sync noodstop na 60s timeout.');
      usageSubmittedRef.current = false;
      setIsUsageSyncPendingClient(false);
      usageEmergencyTimerRef.current = null;
    }, 60_000);
    startUsageSyncTransition(async () => {
      try {
        const fd = new FormData(e.currentTarget);
        await usageSyncFormAction(fd);
      } catch (err: any) {
        console.error('[sim-detail] Usage sync action exception:', err);
      } finally {
        setIsUsageSyncPendingClient(false);
        usageSubmittedRef.current = false;
        if (usageEmergencyTimerRef.current) {
          clearTimeout(usageEmergencyTimerRef.current);
          usageEmergencyTimerRef.current = null;
        }
      }
    });
    e.preventDefault();
  }

  const ACTION_LABEL: Record<string, string> = {
    CREATE: "Aangemaakt",
    UPDATE: "Gewijzigd",
    DELETE: "Verwijderd",
    ACTIVATE: "Geactiveerd",
    SUSPEND: "Gepauzeerd",
    CANCEL: "Geannuleerd",
    EXPIRE: "Verlopen",
    RESUME: "Hervat",
  };

  const suspendBanner = isAdmin && suspendAction ? renderActionResult(suspendState, "suspend", lastAction) : null;
  const unsuspendBanner = isAdmin && unsuspendAction ? renderActionResult(unsuspendState, "unsuspend", lastAction) : null;

  let statusRefreshBanner: React.ReactNode = null;
  if (refreshState && (refreshState.ok || refreshState.error)) {
    if (refreshState.ok && refreshState.changed) {
      statusRefreshBanner = (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm w-full"
          key="banner-status-refresh-updated"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-emerald-900">{SIM_PROVIDER_UI_LABELS.statusUpdatedFromProvider()}</p>
            {refreshState.message ? <p className="whitespace-pre-wrap break-words text-emerald-800/90">{refreshState.message}</p> : null}
          </div>
        </div>
      );
    } else if (refreshState.ok && !refreshState.changed) {
      statusRefreshBanner = null;
    } else if (refreshState.error) {
      const kind = refreshState.error?.kind;
      const isPermission = kind === "PERMISSION";
      const isNotFound = kind === "NOT_FOUND";
      const isTimeout = kind === "TIMEOUT_OR_NETWORK";
      const isProvider = kind === "PROVIDER";
      const isInvalid = kind === "INVALID_STATUS_TRANSITION";
      const isWarning = isTimeout || (isProvider && !isPermission && !isNotFound);
      const title = isPermission
        ? "Onvoldoende rechten"
        : isNotFound
          ? "Simkaart niet gevonden"
          : isTimeout
            ? "Status verversen duurde te lang"
            : isProvider
              ? SIM_PROVIDER_UI_LABELS.providerConnectionError()
              : isInvalid
                ? "Ongeldige status"
                : "Fout bij verversen";
      const bannerBorder = isWarning
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-red-300 bg-red-50 text-red-800";
      const iconColor = isWarning ? "text-amber-600" : "text-red-600";
      const titleColor = isWarning ? "text-amber-900" : "text-red-900";
      const msgColor = isWarning ? "text-amber-800/90" : "text-red-800/90";
      const hintColor = isWarning ? "text-amber-700/80" : "text-red-700/80";
      const IconComp = isWarning ? AlertTriangle : AlertTriangle;
      const bannerRole = isWarning ? "status" : "alert";
      statusRefreshBanner = (
        <div
          role={bannerRole}
          className={"flex items-start gap-2.5 rounded-md border " + bannerBorder + " px-3.5 py-2.5 text-sm shadow-sm w-full"}
          key="banner-status-refresh-error"
        >
          <IconComp className={"mt-0.5 h-4 w-4 shrink-0 " + iconColor} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className={"font-medium " + titleColor}>{title}</p>
            <p className={"whitespace-pre-wrap break-words " + msgColor}>
              {refreshState.message || refreshState.error?.detail || "Onbekende fout."}
            </p>
            {isWarning ? (
              <p className={"mt-1 text-xs " + hintColor}>
                De laatst bekende status blijft zichtbaar. Ververs handmatig als je zeker wilt zijn van de actuele waarde.
              </p>
            ) : isTimeout ? (
              <p className={"mt-1 text-xs " + hintColor}>
                Controleer je internetverbinding en ververs handmatig de status.
              </p>
            ) : null}
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isStatusRefreshPending}
                aria-disabled={isStatusRefreshPending}
                aria-busy={isStatusRefreshPending}
                onClick={triggerManualStatusRefresh}
                className="gap-1.5"
              >
                <RefreshCw
                  className={"h-3.5 w-3.5 " + (isStatusRefreshPending ? "animate-spin" : "")}
                  aria-hidden="true"
                />
                {isWarning ? "Status opnieuw verversen" : "Opnieuw proberen"}
              </Button>
            </div>
          </div>
        </div>
      );
    }
  }

  const actionBanners =
    suspendBanner || unsuspendBanner || statusRefreshBanner ? (
      <div className="flex flex-col gap-3" aria-live="polite">
        {statusRefreshBanner}
        {suspendBanner}
        {unsuspendBanner}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sims">
              <ArrowLeft className="h-4 w-4" /> Terug
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CreditCard className="h-5 w-5 text-slate-500" />
              <h1 className="text-2xl font-bold tracking-tight">
                {sim.provider}
              </h1>
              <div className="flex items-center gap-2">
                <SimStatusBadge status={effectiveSimStatus as SimStatus} />
                <div
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {isStatusRefreshPending ? (
                    <>
                      <RefreshCw
                        className="h-3.5 w-3.5 animate-spin text-slate-500"
                        aria-hidden="true"
                      />
                      <span>
                        {SIM_PROVIDER_UI_LABELS.providerStatusLoading()}
                      </span>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={triggerManualStatusRefresh}
                      disabled={isStatusRefreshPending}
                      aria-disabled={isStatusRefreshPending}
                      aria-busy={isStatusRefreshPending}
                      title={SIM_PROVIDER_UI_LABELS.providerStatusRefreshButtonAria()}
                      aria-label={SIM_PROVIDER_UI_LABELS.providerStatusRefreshButtonAria()}
                    >
                      <RefreshCw
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      Ververs
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="text-sm text-slate-500 font-mono">
              ICCID: {formatIccid(sim.iccid)}
              {sim.msisdn ? <> · MSISDN: {formatMsisdn(sim.msisdn)}</> : null}
            </div>
          </div>
        </div>
        <div className="flex gap-3 sm:gap-4 flex-wrap sm:justify-end ml-auto sm:ml-0">
          {canDelete ? (
            <DeleteSimDialog
              sim={sim}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              onConfirm={() => deleteFormAction()}
            />
          ) : null}
        </div>
      </div>

      {actionBanners}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="mr-1.5 h-4 w-4" /> Overzicht
          </TabsTrigger>
          {canEdit ? (
            <TabsTrigger value="edit">
              <Edit className="mr-1.5 h-4 w-4" /> Bewerken
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="assignments">
            <CreditCard className="mr-1.5 h-4 w-4" /> Toewijzingen (
            {sim.assignments.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-1.5 h-4 w-4" /> Geschiedenis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Netwerk &amp; Identificatie</CardTitle>
                </div>
                {canEdit ? (
                  <Button asChild size="sm" className="mt-0.5 shrink-0">
                    <Link href="#edit">
                      <Edit className="h-4 w-4" /> Bewerken
                    </Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="SIM type"
                  value={sim.simType}
                />
                <InfoRow
                  icon={<Globe className="h-4 w-4" />}
                  label="APN"
                  value={sim.apn}
                />
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="IMSI"
                  value={sim.imsi}
                  mono
                />
                <InfoRow
                  icon={<Phone className="h-4 w-4" />}
                  label="MSISDN"
                  value={sim.msisdn ? formatMsisdn(sim.msisdn) : null}
                  mono
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Geactiveerd"
                  value={
                    sim.providerActivationDate
                      ? formatDate(sim.providerActivationDate)
                      : null
                  }
                />
                <InfoRow
                  icon={<Calendar className="h-4 w-4" />}
                  label="Beëindigd"
                  value={
                    sim.providerDeactivationDate
                      ? formatDate(sim.providerDeactivationDate)
                      : null
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Systeem</CardTitle>
                <CardDescription>Metadata</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Aangemaakt</span>
                  <span className="text-right">{formatDate(sim.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Bijgewerkt</span>
                  <span className="text-right">{formatDate(sim.updatedAt)}</span>
                </div>
                {(sim.dataUsedBytes ?? sim.dataLimitBytes ?? sim.smsUsedCount ?? sim.smsLimitCount ?? sim.lastUsageSyncAt) ? (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Laatste verbruik-sync</span>
                    <span className="text-right">
                      {sim.lastUsageSyncAt ? formatDateTime(sim.lastUsageSyncAt) : "—"}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {usageSyncState?.message ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 shadow-sm"
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600">✓</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-emerald-900">Verbruik vernieuwd</p>
                <p className="whitespace-pre-wrap break-words text-emerald-800/90">{usageSyncState.message}</p>
              </div>
            </div>
          ) : null}
          {usageSyncState?.error ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 shadow-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-red-900">Verbruik vernieuwen mislukt</p>
                <p className="whitespace-pre-wrap break-words text-red-800/90">{usageSyncState.error}</p>
                {canEdit ? (
                  <p className="mt-1 text-xs text-red-700/80">
                    Controleer je internetverbinding of probeer het later opnieuw. Als het probleem blijft, neem dan contact op met de beheerder.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="h-4 w-4 text-slate-500" /> Product
                  </CardTitle>
                  <div className="flex flex-wrap gap-2 sm:gap-3 shrink-0">
                    {isAdmin && suspendAction && effectiveSimStatus === "ACTIVE" ? (
                      <SuspendSimDialog
                        sim={sim}
                        open={suspendOpen}
                        onOpenChange={setSuspendOpen}
                        formAction={suspendFormAction}
                        isPending={suspendPendingNative}
                        hasResult={Boolean(suspendState?.ok || suspendState?.error)}
                      />
                    ) : null}
                    {isAdmin && unsuspendAction && effectiveSimStatus === "SUSPENDED" ? (
                      <UnsuspendSimDialog
                        sim={sim}
                        open={unsuspendOpen}
                        onOpenChange={setUnsuspendOpen}
                        formAction={unsuspendFormAction}
                        isPending={unsuspendPendingNative}
                        hasResult={Boolean(unsuspendState?.ok || unsuspendState?.error)}
                      />
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <InfoRow
                  icon={<Package className="h-4 w-4" />}
                  label="Product naam"
                  value={sim.product}
                />
                <InfoRow
                  icon={<Activity className="h-4 w-4" />}
                  label="Product type"
                  value={sim.productType ?? null}
                />
                <InfoRow
                  icon={<CreditCard className="h-4 w-4" />}
                  label="SIM naam"
                  value={sim.simName ?? null}
                />
                <InfoRow
                  icon={<Users className="h-4 w-4" />}
                  label="Groep"
                  value={sim.simGroup ?? null}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="h-4 w-4 text-slate-500" /> Dataverbruik
                  </CardTitle>
                  {canSyncUsage ? (
                    <form
                      action={usageSyncFormAction as any}
                      onSubmit={onUsageSyncSubmit}
                    >
                      <Button
                        type="submit"
                        size="icon"
                        variant="ghost"
                        disabled={usageSyncPending}
                        aria-disabled={usageSyncPending}
                        aria-busy={usageSyncPending}
                        aria-label="Dataverbruik vernieuwen"
                        title="Dataverbruik vernieuwen"
                        className="h-8 w-8 shrink-0"
                      >
                        <RefreshCw
                          className={"h-4 w-4 " + (usageSyncPending ? "animate-spin" : "")}
                          aria-hidden="true"
                        />
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageProgress
                  used={sim.dataUsedBytes}
                  limit={sim.dataLimitBytes}
                  threshold={sim.lowestDataLimitBytes}
                  formatUsed={formatBytes(sim.dataUsedBytes)}
                  formatLimit={formatBytes(sim.dataLimitBytes)}
                />
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <InfoRowInline
                    label="Verbruikt"
                    value={formatBytes(sim.dataUsedBytes)}
                  />
                  <InfoRowInline
                    label="Limiet"
                    value={formatBytes(sim.dataLimitBytes)}
                  />
                  <InfoRowInline
                    label="Laagste drempel"
                    value={formatBytes(sim.lowestDataLimitBytes)}
                  />
                  <InfoRowInline
                    label="Resterend"
                    value={
                      typeof sim.dataUsedBytes === "bigint" &&
                      typeof sim.dataLimitBytes === "bigint"
                        ? formatBytes(sim.dataLimitBytes > sim.dataUsedBytes
                            ? sim.dataLimitBytes - sim.dataUsedBytes
                            : 0n)
                        : "—"
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageSquare className="h-4 w-4 text-slate-500" /> SMS
                  </CardTitle>
                  {canEdit ? (
                    <form
                      action={usageSyncFormAction as any}
                      onSubmit={onUsageSyncSubmit}
                    >
                      <Button
                        type="submit"
                        size="icon"
                        variant="ghost"
                        disabled={usageSyncPending}
                        aria-disabled={usageSyncPending}
                        aria-busy={usageSyncPending}
                        aria-label="SMS verbruik vernieuwen"
                        title="SMS verbruik vernieuwen"
                        className="h-8 w-8 shrink-0"
                      >
                        <RefreshCw
                          className={"h-4 w-4 " + (usageSyncPending ? "animate-spin" : "")}
                          aria-hidden="true"
                        />
                      </Button>
                    </form>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <UsageProgress
                  used={sim.smsUsedCount != null ? BigInt(sim.smsUsedCount) : null}
                  limit={sim.smsLimitCount != null ? BigInt(sim.smsLimitCount) : null}
                  threshold={sim.lowestSmsLimitCount != null ? BigInt(sim.lowestSmsLimitCount) : null}
                  formatUsed={formatCount(sim.smsUsedCount)}
                  formatLimit={formatCount(sim.smsLimitCount)}
                  unit="berichten"
                />
                <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                  <InfoRowInline
                    label="Verzonden"
                    value={formatCount(sim.smsUsedCount)}
                  />
                  <InfoRowInline
                    label="Limiet"
                    value={formatCount(sim.smsLimitCount)}
                  />
                  <InfoRowInline
                    label="Laagste drempel"
                    value={formatCount(sim.lowestSmsLimitCount)}
                  />
                  <InfoRowInline
                    label="Resterend"
                    value={
                      sim.smsUsedCount != null && sim.smsLimitCount != null
                        ? formatCount(Math.max(0, sim.smsLimitCount - sim.smsUsedCount))
                        : "—"
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {sim.notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Notities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {sim.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {canEdit ? (
          <TabsContent value="edit" id="edit" className="mt-6">
            <SimForm
              mode="edit"
              simId={simId}
              initial={sim}
              action={async (prev, form) =>
                updateAction(simId, prev, form)
              }
            />
          </TabsContent>
        ) : null}

        <TabsContent value="assignments" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Actieve en historie toewijzingen
              </CardTitle>
              <CardDescription>
                Abonnementen waaraan deze SIM is gekoppeld.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={sim.assignments}
                emptyTitle="Nog geen toewijzingen"
              >
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Periode</th>
                        <th className="px-3 py-2">Abonnement</th>
                        <th className="px-3 py-2">Klant</th>
                        <th className="px-3 py-2">Reden</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.assignments.map((a) => (
                        <tr
                          key={a.id}
                          className="border-t hover:bg-slate-50"
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {formatDate(a.startAt)}
                            {a.endAt
                              ? ` → ${formatDate(a.endAt)}`
                              : " (lopend)"}
                          </td>
                          <td className="px-3 py-2">
                            {a.subscription ? (
                              <Link
                                href={`/subscriptions/${a.subscription.id}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {a.subscription.subscriptionNumber}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {a.subscription?.customer ? (
                              <Link
                                href={`/customers/${a.subscription.customer.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {a.subscription.customer.companyName}
                              </Link>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {a.reason ? (
                              <AssignmentReasonLabel reason={a.reason} />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </EmptyOrList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Wijzigingsgeschiedenis
              </CardTitle>
              <CardDescription>
                Auditlog van wijzigingen op deze SIM en gerelateerde
                resources.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyOrList
                rows={auditLogs}
                emptyTitle="Nog geen wijzigingen gelogd"
              >
                <ul className="space-y-4">
                  {auditLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex items-start gap-3 border-b border-slate-100 pb-4 last:border-b-0"
                    >
                      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                        <History className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {ACTION_LABEL[log.action] ?? log.action}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-slate-500">
                            {log.entityType}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(log.timestamp)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600">
                          {log.user
                            ? `${log.user.name ?? "Onbekend"} (${log.user.email})`
                            : "Systeem"}
                        </div>
                        {log.oldValues || log.newValues ? (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                              Details bekijken
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                              {log.oldValues ? (
                                <div>
                                  <div className="mb-1 font-semibold text-red-700">
                                    Oude waarden
                                  </div>
                                  <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-red-900">
                                    {JSON.stringify(log.oldValues, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {log.newValues ? (
                                <div>
                                  <div className="mb-1 font-semibold text-emerald-700">
                                    Nieuwe waarden
                                  </div>
                                  <pre className="overflow-auto rounded bg-white p-2 text-[11px] text-emerald-900">
                                    {JSON.stringify(log.newValues, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </EmptyOrList>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {value ? (
          <div className={`truncate ${mono ? "font-mono text-xs" : ""}`}>
            {value}
          </div>
        ) : (
          <div className="text-slate-400">—</div>
        )}
      </div>
    </div>
  );
}

function InfoRowInline({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="font-medium text-slate-900">
        {value ?? "—"}
      </div>
    </div>
  );
}

function UsageProgress({
  used,
  limit,
  threshold,
  formatUsed,
  formatLimit,
  unit,
}: {
  used: bigint | null | undefined;
  limit: bigint | null | undefined;
  threshold: bigint | null | undefined;
  formatUsed: string;
  formatLimit: string;
  unit?: string;
}) {
  const hasUsage = used !== null && used !== undefined;
  const hasLimit = limit !== null && limit !== undefined && limit > 0n;
  const hasThreshold =
    threshold !== null && threshold !== undefined && threshold > 0n;

  if (!hasUsage && !hasLimit && !hasThreshold) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
        Geen verbruiksgegevens beschikbaar
      </div>
    );
  }

  let pct = 0;
  let overschreden = false;
  if (hasLimit && hasUsage) {
    if (limit === 0n) {
      pct = 0;
    } else {
      const num = Number(used) / Number(limit) * 100;
      pct = Math.min(100, Math.max(0, num));
      overschreden = used > limit;
    }
  }

  let barColor = "bg-emerald-500";
  let statusColor = "text-emerald-700";
  let statusLabel = "";

  if (!hasLimit) {
    barColor = "bg-slate-300";
    statusColor = "text-slate-600";
    statusLabel = "Onbeperkt";
  } else if (overschreden) {
    barColor = "bg-red-500";
    statusColor = "text-red-700";
    statusLabel = "Limiet overschreden";
  } else if (pct >= 90) {
    barColor = "bg-red-500";
    statusColor = "text-red-700";
    statusLabel = "Bijna op";
  } else if (
    hasThreshold &&
    hasUsage &&
    used >= threshold
  ) {
    barColor = "bg-amber-500";
    statusColor = "text-amber-700";
    statusLabel = "Drempel bereikt";
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Verbruik
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-slate-900">
              {formatUsed}
            </span>
            {hasLimit ? (
              <span className="text-xs text-slate-500">
                van {formatLimit}
                {unit ? ` ${unit}` : ""}
              </span>
            ) : unit ? (
              <span className="text-xs text-slate-500">{unit}</span>
            ) : null}
          </div>
        </div>
        {statusLabel ? (
          <div className={`flex items-center gap-1 text-xs font-medium ${statusColor}`}>
            {overschreden || pct >= 90 ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : null}
            {statusLabel}
          </div>
        ) : hasLimit ? (
          <div className={`text-xs font-semibold ${statusColor}`}>
            {pct.toFixed(0)}%
          </div>
        ) : null}
      </div>

      {hasLimit ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, overschreden ? 100 : 0)}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full w-full rounded-full ${barColor}`} />
        </div>
      )}

      {hasThreshold ? (
        <div className="text-[11px] text-slate-500">
          ⚠ Waarschuwingsdrempel: {formatThreshold(threshold, unit)}
        </div>
      ) : null}
    </div>
  );
}

function formatThreshold(
  value: bigint,
  unit?: string
): string {
  if (unit === "berichten") {
    return formatCount(value);
  }
  return formatBytes(value);
}

function EmptyOrList<T>({
  rows,
  children,
  emptyTitle,
}: {
  rows: T[];
  children: React.ReactNode;
  emptyTitle: string;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        {emptyTitle}
      </div>
    );
  }
  return <>{children}</>;
}
