import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import {
  suspendSimhuisAsset,
  unsuspendSimhuisAsset,
  getSimStatus,
  simhuisClient,
  type SimhuisAssetActionResult,
} from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import { findSimById } from "./sim.service";
import { pickAuth, requirePermission, hasMinRole } from "@/lib/rbac";
import { SimStatus, UserRole, RoleScope } from "@/types/enums";
import type { PermissionBits } from "@/types/next-auth";

type AuthContext = {
  userId: string;
  userRole: UserRole;
  roleId?: string;
  roleScope?: RoleScope;
  customerId?: string | null;
  customerScope?: string[];
  permissions?: PermissionBits;
};

export type SimSuspendError =
  | { kind: "PERMISSION"; detail: string }
  | { kind: "INVALID_STATUS_TRANSITION"; detail: string }
  | { kind: "PROVIDER"; detail: string; statusCode?: number }
  | { kind: "TIMEOUT_OR_NETWORK"; detail: string }
  | { kind: "NOT_FOUND"; detail: string };

export type SimSuspendResult = {
  ok: boolean;
  confirmedStatus: "ACTIVE" | "SUSPENDED" | null;
  pendingConfirmation: boolean;
  message: string;
  error?: SimSuspendError;
};

function mapSimhuisStatusToNexus(
  simhuisStatus: SimhuisSimStatus["status"] | null | undefined,
): SimStatus | null {
  if (!simhuisStatus) return null;
  const s = String(simhuisStatus ?? "").toLowerCase();
  if (s === "inactive" || s === "disabled" || s === "offline" || s === "available" || s === "ready") {
    return SimStatus.IN_STOCK;
  }
  if (s === "active" || s === "enabled" || s === "online") {
    return SimStatus.ACTIVE;
  }
  if (s === "suspended" || s === "paused" || s === "barred") {
    return SimStatus.SUSPENDED;
  }
  if (s === "terminated" || s === "deleted" || s === "cancelled" || s === "canceled") {
    return SimStatus.CANCELLED;
  }
  if (s === "provisioning" || s === "activating" || s === "pending") {
    return SimStatus.RESERVED;
  }
  return SimStatus.IN_STOCK;
}

async function authorize(ctx: AuthContext): Promise<SimSuspendError | null> {
  try {
    if (ctx.roleScope !== "INTERNAL") {
      return {
        kind: "PERMISSION",
        detail: "Deze actie is alleen beschikbaar voor interne beheerders.",
      };
    }
    if (!hasMinRole(ctx.userRole, UserRole.ADMIN)) {
      return {
        kind: "PERMISSION",
        detail: "Deze actie is alleen beschikbaar voor beheerders (ADMIN).",
      };
    }
    await requirePermission(pickAuth(ctx), "edit", "sim");
    return null;
  } catch (e: any) {
    return {
      kind: "PERMISSION",
      detail: e?.message ? String(e.message) : "Onvoldoende rechten.",
    };
  }
}

function mapProviderError(
  providerRes: SimhuisAssetActionResult
): SimSuspendError {
  const err = providerRes.error;
  if (!err) {
    return {
      kind: "PROVIDER",
      detail: "Onbekende provider-fout.",
      statusCode: providerRes.httpStatusPut || undefined,
    };
  }
  switch (err.kind) {
    case "NOT_CONFIGURED":
    case "AUTH_FAILED":
    case "INVALID_ACCOUNTID":
      return {
        kind: "PROVIDER",
        detail: `Kan geen verbinding maken met Simhuis: ${err.detail}`,
        statusCode: err.kind === "AUTH_FAILED" ? err.httpStatus : undefined,
      };
    case "PROVIDER_REJECTED":
      if (err.httpStatus === 409 || /conflict|status|state|already|cannot|invalid/i.test(err.detail)) {
        return {
          kind: "INVALID_STATUS_TRANSITION",
          detail: `Kan actie niet uitvoeren: ${err.detail}`,
        };
      }
      return {
        kind: "PROVIDER",
        detail: err.detail,
        statusCode: err.httpStatus,
      };
    case "TIMEOUT_OR_NETWORK":
      return {
        kind: "TIMEOUT_OR_NETWORK",
        detail: err.detail,
      };
    default: {
      const exhaustive: never = err;
      void exhaustive;
      return {
        kind: "PROVIDER" as const,
        detail: (err as any)?.detail || "Onbekende provider-fout.",
      };
    }
  }
}

async function performAction(
  action: "suspend" | "unsuspend",
  simId: string,
  ctx: AuthContext
): Promise<SimSuspendResult> {
  const forbidden = await authorize(ctx);
  if (forbidden) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: forbidden.detail,
      error: forbidden,
    };
  }

  const sim = await findSimById(simId, ctx.customerScope);
  if (!sim) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "SIM is niet (meer) beschikbaar in dit account.",
      error: {
        kind: "NOT_FOUND",
        detail: "SIM niet gevonden of onvoldoende toegang.",
      },
    };
  }

  const expectedBefore = action === "suspend" ? SimStatus.ACTIVE : SimStatus.SUSPENDED;
  const expectedAfter = action === "suspend" ? SimStatus.SUSPENDED : SimStatus.ACTIVE;
  const actionLabel = action === "suspend" ? "blokkeren" : "deblokkeren";
  const auditAction = action === "suspend" ? "SUSPEND" : "RESUME";

  if (sim.status !== expectedBefore) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: `Kan niet ${actionLabel}: SIM heeft momenteel status ${sim.status}.`,
      error: {
        kind: "INVALID_STATUS_TRANSITION",
        detail: `Kan niet ${actionLabel}: SIM heeft momenteel status ${sim.status}. Alleen ${expectedBefore} SIMs kunnen worden ${actionLabel}d.`,
      },
    };
  }

  const configured = await simhuisClient.isConfigured();
  if (!configured) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Simhuis integratie is niet geconfigureerd.",
      error: {
        kind: "PROVIDER",
        detail: "Simhuis integratie is niet geconfigureerd (username/password ontbreken).",
      },
    };
  }

  let providerRes: SimhuisAssetActionResult;
  try {
    providerRes =
      action === "suspend"
        ? await suspendSimhuisAsset(sim.iccid)
        : await unsuspendSimhuisAsset(sim.iccid);
  } catch (e: any) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Onverwachte fout tijdens aanroep naar Simhuis.",
      error: {
        kind: "TIMEOUT_OR_NETWORK",
        detail: String(e?.message ?? e ?? "Onverwachte fout."),
      },
    };
  }

  if (providerRes.error?.kind === "TIMEOUT_OR_NETWORK") {
    try {
      const live = await getSimStatus(sim.iccid);
      const liveNexus = mapSimhuisStatusToNexus(live?.status ?? null);
      if (liveNexus === expectedAfter) {
        providerRes = {
          ok: true,
          rawPut: null,
          rawGet: live?.raw ?? null,
          confirmedSimhuisStatus: live?.status ?? (expectedAfter === SimStatus.SUSPENDED ? "suspended" : "active"),
          accountIdUsed: providerRes.accountIdUsed,
          httpStatusPut: 202,
        };
      }
    } catch {
      // ignore; return original timeout error
    }
  }

  if (!providerRes.ok) {
    const error = mapProviderError(providerRes);
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: error.detail,
      error,
    };
  }

  const nexusStatus = mapSimhuisStatusToNexus(providerRes.confirmedSimhuisStatus ?? null);
  const confirmed = nexusStatus === expectedAfter ? (expectedAfter as unknown as "ACTIVE" | "SUSPENDED") : null;
  const pendingConfirmation = confirmed === null;

  let dbUpdated = false;
  try {
    if (!pendingConfirmation && confirmed) {
      await prisma.$transaction(async (tx) => {
        await tx.sIM.update({
          where: { id: sim.id },
          data: { status: confirmed as SimStatus, updatedAt: new Date() },
        });
        await logAudit(tx, {
          entityType: "sim",
          entityId: sim.id,
          action: auditAction,
          userId: ctx.userId,
          oldValues: { status: sim.status },
          newValues: { status: confirmed },
          metadata: {
            source: "simhuis-asset-action",
            providerHttpStatusPut: providerRes.httpStatusPut,
            pendingConfirmation: false,
          },
        });
      });
      dbUpdated = true;
    } else if (pendingConfirmation) {
      try {
        await logAudit(prisma, {
          entityType: "sim",
          entityId: sim.id,
          action: auditAction,
          userId: ctx.userId,
          oldValues: { status: sim.status },
          newValues: { status: `PENDING_${expectedAfter}` as unknown as string },
          metadata: {
            source: "simhuis-asset-action",
            providerHttpStatusPut: providerRes.httpStatusPut,
            pendingConfirmation: true,
            confirmedStatusFromProvider: providerRes.confirmedSimhuisStatus ?? null,
          },
        });
      } catch {
        // ignore audit-log fouten: hoofddoel is al bereikt (provider call ok)
      }
    }
  } catch (e: any) {
    console.error(
      `[simhuis-asset-service] Fout bij bijwerken DB/audit na ${actionLabel} van sim ${sim.id}:`,
      e?.message ?? e
    );
  }

  if (confirmed === "SUSPENDED") {
    return {
      ok: true,
      confirmedStatus: "SUSPENDED",
      pendingConfirmation: false,
      message: "Simkaart geblokkeerd.",
    };
  }
  if (confirmed === "ACTIVE") {
    return {
      ok: true,
      confirmedStatus: "ACTIVE",
      pendingConfirmation: false,
      message: "Simkaart gedeblokkeerd.",
    };
  }

  return {
    ok: true,
    confirmedStatus: null,
    pendingConfirmation: true,
    message: "Het verzoek is verwerkt. De statuswijziging is nog niet bevestigd.",
  };
}

export async function suspendSimById(simId: string, ctx: AuthContext): Promise<SimSuspendResult> {
  return performAction("suspend", simId, ctx);
}

export async function unsuspendSimById(simId: string, ctx: AuthContext): Promise<SimSuspendResult> {
  return performAction("unsuspend", simId, ctx);
}

export type { AuthContext };
