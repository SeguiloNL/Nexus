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
      const { getSimStatusFast } = await import('@/server/integrations/simhuis/service');
      let live: Awaited<ReturnType<typeof getSimStatus>> | null = null;
      try {
        const fast = await Promise.race<Awaited<ReturnType<typeof getSimStatusFast>> | null>([
          (async () => getSimStatusFast(sim.iccid))(),
          new Promise<null>((r) => setTimeout(() => r(null), 4_200)),
        ]);
        if (fast && (fast as any)?.status) {
          live = fast as Awaited<ReturnType<typeof getSimStatus>>;
        } else {
          live = await Promise.race<Awaited<ReturnType<typeof getSimStatus>> | null>([
            (async () => getSimStatus(sim.iccid))(),
            new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
          ]);
        }
      } catch {
        live = null;
      }
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

  // ============================================================
  // FIX 3: OVERALL ABORT 12s. Wanneer de status-checks langer duren
  // dan 12s, retourneren we ok=true + pendingConfirmation=true
  // (graceful degradation). De PUT is namelijk al 2xx OK bij Simhuis.
  // ============================================================
  type RaceResult = SimSuspendResult | "__OVERALL_TIMEOUT__";
  const overallTimeoutMs = 12_000;

  const workPromise: Promise<RaceResult> = (async () => {

  const nexusStatus = mapSimhuisStatusToNexus(providerRes.confirmedSimhuisStatus ?? null);
  let confirmed = nexusStatus === expectedAfter ? (expectedAfter as unknown as "ACTIVE" | "SUSPENDED") : null;
  let pendingConfirmation = confirmed === null;
  let confirmedSource: string | null = confirmed ? "provider-direct" : null;

  // #region debug-point dp-map-status
  try {
    console.info(
      `[DEBUG-sim-status-sync-fout] dp-map-status action=${action} iccidSuffix=${sim.iccid.slice(-6)} simInternalId=${sim.id} ` +
      `rawConfirmedSimhuisStatus=${JSON.stringify(providerRes.confirmedSimhuisStatus ?? null)} nexusStatus=${JSON.stringify(nexusStatus ?? null)} ` +
      `expectedAfter=${expectedAfter} confirmed=${JSON.stringify(confirmed ?? null)} pendingConfirmation=${String(pendingConfirmation)}`
    );
  } catch (debugErr) {
    console.warn(`[DEBUG-sim-status-sync-fout] dp-map-status instrumentation error:`, debugErr instanceof Error ? debugErr.message : debugErr);
  }
  // #endregion debug-point dp-map-status

  // ============================================================
  // FIX B: Fallback sanity check met bulk getSimStatus (robuust)
  // Indien nog steeds pendingConfirmation (extractie faalde of eventual consistency)
  // gebruiken we de assetsbulk/discover methode (die al bewezen werkt voor Simhuis).
  // ============================================================
  let fallbackBulkStatus: SimhuisSimStatus["status"] | null = null;
  let fallbackBulkNexus: SimStatus | null = null;
  if (pendingConfirmation) {
    try {
      // ⚡ Fast-path eerst (max 4s), daarna fallback (max 8s). GEEN 17s wachten!
      const { getSimStatusFast } = await import('@/server/integrations/simhuis/service');
      let live: Awaited<ReturnType<typeof getSimStatus>> | null = null;
      try {
        const fast = await Promise.race<Awaited<ReturnType<typeof getSimStatusFast>> | null>([
          (async () => getSimStatusFast(sim.iccid))(),
          new Promise<null>((r) => setTimeout(() => r(null), 4_200)),
        ]);
        if (fast && (fast as any)?.status) {
          live = fast as Awaited<ReturnType<typeof getSimStatus>>;
        } else {
          live = await Promise.race<Awaited<ReturnType<typeof getSimStatus>> | null>([
            (async () => getSimStatus(sim.iccid))(),
            new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
          ]);
        }
      } catch {
        live = null;
      }
      fallbackBulkStatus = live?.status ?? null;
      fallbackBulkNexus = mapSimhuisStatusToNexus(live?.status ?? null);
      if (fallbackBulkNexus === expectedAfter && !confirmed) {
        confirmed = expectedAfter as unknown as "ACTIVE" | "SUSPENDED";
        pendingConfirmation = false;
        confirmedSource = "fallback-bulk";
      }
    } catch (e: any) {
      // Ignore; probeer volgende methode
      console.warn(`[simhuis-asset-service] Fallback bulk getSimStatus mislukte:`, e?.message ?? e);
    }
  }

  // ============================================================
  // FIX D (Delayed re-check, 1x, max 3s): Als nog pendingConfirmation,
  // wacht 2.5s en probeer opnieuw bulk getSimStatus — eventual consistency.
  // GEEN onbeperkt pollen! Maximaal 1x vertraagd herbevestigen.
  // ============================================================
  let delayedRecheckDone = false;
  if (pendingConfirmation) {
    try {
      const timeoutMs = 2500;
      await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      // ⚡ Delayed recheck: eerst fast-path (3s max)
      const { getSimStatusFast } = await import('@/server/integrations/simhuis/service');
      let live2: Awaited<ReturnType<typeof getSimStatus>> | null = null;
      try {
        const fast = await Promise.race<Awaited<ReturnType<typeof getSimStatusFast>> | null>([
          (async () => getSimStatusFast(sim.iccid))(),
          new Promise<null>((r) => setTimeout(() => r(null), 3_200)),
        ]);
        if (fast && (fast as any)?.status) {
          live2 = fast as Awaited<ReturnType<typeof getSimStatus>>;
        } else {
          live2 = await Promise.race<Awaited<ReturnType<typeof getSimStatus>> | null>([
            (async () => getSimStatus(sim.iccid))(),
            new Promise<null>((r) => setTimeout(() => r(null), 6_000)),
          ]);
        }
      } catch {
        live2 = null;
      }
      const live2Nexus = mapSimhuisStatusToNexus(live2?.status ?? null);
      delayedRecheckDone = true;
      if (live2Nexus === expectedAfter && !confirmed) {
        confirmed = expectedAfter as unknown as "ACTIVE" | "SUSPENDED";
        pendingConfirmation = false;
        confirmedSource = "delayed-bulk";
      }
      try {
        console.info(
          `[DEBUG-sim-status-sync-fout] dp-delayed-recheck action=${action} iccidSuffix=${sim.iccid.slice(-6)} ` +
          `delayedBulkStatus=${JSON.stringify(live2?.status ?? null)} delayedBulkNexus=${JSON.stringify(live2Nexus ?? null)} ` +
          `confirmedAfterRecheck=${JSON.stringify(confirmed ?? null)}`
        );
      } catch {}
    } catch (e: any) {
      // negeer: blijf in pendingConfirmation
    }
  }

  let dbUpdated = false;
  try {
    if (!pendingConfirmation && confirmed) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.sIM.update({
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
            confirmedSource,
            fallbackBulkStatus,
            delayedRecheckDone,
          },
        });
        return updated;
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
            fallbackBulkStatus,
            delayedRecheckDone,
            note: "Provider call is 2xx OK, maar status nog niet bevestigd. Gebruik debloxkeren/hervat na de eerstvolgende verbruik-sync of ververs handmatig de SIM-status.",
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

  // #region debug-point dp-db-update
  try {
    console.info(
      `[DEBUG-sim-status-sync-fout] dp-db-update action=${action} iccidSuffix=${sim.iccid.slice(-6)} confirmed=${JSON.stringify(confirmed ?? null)} pendingConfirmation=${String(pendingConfirmation)} confirmedSource=${JSON.stringify(confirmedSource)} fallbackBulkNexus=${JSON.stringify(fallbackBulkNexus ?? null)} delayedRecheckDone=${String(delayedRecheckDone)} dbUpdated=${String(dbUpdated)} simStatusBefore=${sim.status}`
    );
  } catch (debugErr) {
    console.warn(`[DEBUG-sim-status-sync-fout] dp-db-update instrumentation error:`, debugErr instanceof Error ? debugErr.message : debugErr);
  }
  // #endregion debug-point dp-db-update

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

  })();

  const timeoutPromise: Promise<RaceResult> = new Promise((resolve) => {
    setTimeout(() => resolve("__OVERALL_TIMEOUT__"), overallTimeoutMs);
  });

  const raceResult = await Promise.race([workPromise, timeoutPromise]);

  if (raceResult === "__OVERALL_TIMEOUT__") {
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
          note: `Overall timeout van ${overallTimeoutMs}ms bereikt. Provider call is 2xx OK, maar status-bevestiging duurde te lang. SIM-status wordt later bijgewerkt door verbruik-sync of handmatig verversen.`,
        },
      });
    } catch {
      // ignore audit log fouten
    }
    return {
      ok: true,
      confirmedStatus: null,
      pendingConfirmation: true,
      message:
        action === "suspend"
          ? "Het verzoek tot blokkeren is verwerkt bij Simhuis. De actuele SIM-status kon niet direct worden bevestigd (binnen 12s). Controleer de status over enkele seconden of ververs handmatig."
          : "Het verzoek tot deblokkeren is verwerkt bij Simhuis. De actuele SIM-status kon niet direct worden bevestigd (binnen 12s). Controleer de status over enkele seconden of ververs handmatig.",
    };
  }

  return raceResult as SimSuspendResult;
}

export async function suspendSimById(simId: string, ctx: AuthContext): Promise<SimSuspendResult> {
  return performAction("suspend", simId, ctx);
}

export async function unsuspendSimById(simId: string, ctx: AuthContext): Promise<SimSuspendResult> {
  return performAction("unsuspend", simId, ctx);
}

export type SimStatusRefreshResult = {
  ok: boolean;
  message: string;
  previousStatus: string | null;
  refreshedStatus: string | null;
  simhuisStatusRaw: string | null;
  changed: boolean;
  error?: SimSuspendError;
};

export async function refreshSimStatusById(
  simId: string,
  ctx: AuthContext
): Promise<SimStatusRefreshResult> {
  try {
    await requirePermission(pickAuth(ctx), "view", "sim");
  } catch (e: any) {
    return {
      ok: false,
      message: e?.message ? String(e.message) : "Onvoldoende rechten.",
      previousStatus: null,
      refreshedStatus: null,
      simhuisStatusRaw: null,
      changed: false,
      error: { kind: "PERMISSION", detail: e?.message ? String(e.message) : "Onvoldoende rechten." },
    };
  }

  const sim = await findSimById(simId, ctx.customerScope);
  if (!sim) {
    return {
      ok: false,
      message: "SIM is niet (meer) beschikbaar in dit account.",
      previousStatus: null,
      refreshedStatus: null,
      simhuisStatusRaw: null,
      changed: false,
      error: { kind: "NOT_FOUND", detail: "SIM niet gevonden of onvoldoende toegang." },
    };
  }

  const previousStatus = sim.status;

  const configured = await simhuisClient.isConfigured();
  if (!configured) {
    return {
      ok: false,
      message: "Simhuis integratie is niet geconfigureerd.",
      previousStatus,
      refreshedStatus: null,
      simhuisStatusRaw: null,
      changed: false,
      error: {
        kind: "PROVIDER",
        detail: "Simhuis integratie is niet geconfigureerd (username/password ontbreken).",
      },
    };
  }

  let live: Awaited<ReturnType<typeof getSimStatus>> | null = null;
  try {
    // ⚡ Eerst fast-path (max 4s). Alleen als fast-path geen result geeft
    //    → fallback naar volledige getSimStatus (met 10s overall abort, GEEN 40s!)
    //    zodat de gebruiker nooit 17s hoeft te wachten.
    const { getSimStatusFast } = await import('@/server/integrations/simhuis/service');
    let fast: Awaited<ReturnType<typeof getSimStatusFast>> | null = null;
    try {
      fast = await Promise.race<Awaited<ReturnType<typeof getSimStatusFast>> | null>([
        (async () => getSimStatusFast(sim.iccid))(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_200)),
      ]);
    } catch {
      fast = null;
    }

    if (fast && (fast as any)?.status) {
      live = fast as Awaited<ReturnType<typeof getSimStatus>>;
    } else {
      // Fallback (vrij zelden nodig): geef getSimStatus MAXIMAAL 10 seconden
      live = await Promise.race<Awaited<ReturnType<typeof getSimStatus>> | null>([
        (async () => getSimStatus(sim.iccid))(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      if (!live) {
        return {
          ok: false,
          message: "Simhuis-antwoord liet te lang op zich wachten. De getoonde status is mogelijk niet actueel.",
          previousStatus,
          refreshedStatus: null,
          simhuisStatusRaw: null,
          changed: false,
          error: {
            kind: "TIMEOUT_OR_NETWORK",
            detail: "Fall-back getSimStatus timeout (>10s). Fast-path heeft ook geen match.",
          },
        };
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      message: "Kon actuele status niet ophalen van Simhuis.",
      previousStatus,
      refreshedStatus: null,
      simhuisStatusRaw: null,
      changed: false,
      error: {
        kind: "TIMEOUT_OR_NETWORK",
        detail: String(e?.message ?? e ?? "Netwerk- of timeout-fout bij Simhuis."),
      },
    };
  }

  const simhuisStatusRaw = (live?.status as string) ?? null;
  const refreshedStatus = mapSimhuisStatusToNexus(live?.status ?? null);

  if (!refreshedStatus) {
    return {
      ok: false,
      message: `Simhuis retourneerde een onbekende status (${JSON.stringify(simhuisStatusRaw ?? "null")}).`,
      previousStatus,
      refreshedStatus: null,
      simhuisStatusRaw,
      changed: false,
      error: {
        kind: "PROVIDER",
        detail: `Onbekende status-waarde van Simhuis: ${JSON.stringify(simhuisStatusRaw ?? "null")}`,
      },
    };
  }

  const changed = previousStatus !== refreshedStatus;

  let dbUpdated = false;
  try {
    if (changed) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.sIM.update({
          where: { id: sim.id },
          data: { status: refreshedStatus, updatedAt: new Date() },
        });
        await logAudit(tx, {
          entityType: "sim",
          entityId: sim.id,
          action: "UPDATE",
          userId: ctx.userId,
          oldValues: { status: previousStatus },
          newValues: { status: refreshedStatus },
          metadata: {
            source: "sim-status-refresh",
            simhuisStatusRaw,
          },
        });
        return updated;
      });
      dbUpdated = true;
    } else {
      try {
        await prisma.sIM.update({
          where: { id: sim.id },
          data: { updatedAt: new Date() },
        });
      } catch {
        // Ignore; refreshed at timestamp is best effort
      }
    }
  } catch (e: any) {
    console.error(
      `[simhuis-asset-service] Fout bij bijwerken DB na status refresh van sim ${sim.id}:`,
      e?.message ?? e
    );
    return {
      ok: false,
      message: "Simhuis status opgehaald, maar lokaal opslaan mislukte.",
      previousStatus,
      refreshedStatus,
      simhuisStatusRaw,
      changed,
      error: {
        kind: "TIMEOUT_OR_NETWORK",
        detail: String(e?.message ?? e ?? "Database-fout tijdens status-opslag."),
      },
    };
  }

  if (changed && dbUpdated) {
    return {
      ok: true,
      message: `Status bijgewerkt van ${previousStatus} naar ${refreshedStatus}.`,
      previousStatus,
      refreshedStatus,
      simhuisStatusRaw,
      changed: true,
    };
  }

  return {
    ok: true,
    message: `Status is actueel (${refreshedStatus}).`,
    previousStatus,
    refreshedStatus,
    simhuisStatusRaw,
    changed: false,
  };
}

export type { AuthContext };
