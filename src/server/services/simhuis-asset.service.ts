import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import {
  suspendSimhuisAsset,
  unsuspendSimhuisAsset,
  getSimStatus,
  simhuisClient,
  precheckProductById,
  precheckProductAvailability,
  subscribeSimhuisAsset,
  getAssetByIccid,
  type SimhuisAssetActionResult,
  type SimhuisSubscribeResult,
} from "@/server/integrations/simhuis/service";
import type { SimhuisSimStatus } from "@/server/integrations/simhuis/types";
import { findSimById } from "./sim.service";
import { findActivationOrderById } from "./activation-order.service";
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

export type SimSubscribeError =
  | { kind: "PERMISSION"; detail: string; statusCode?: number }
  | { kind: "INVALID_STATUS_TRANSITION"; detail: string; statusCode?: number }
  | { kind: "PRODUCT_MISMATCH"; detail: string; statusCode?: number }
  | { kind: "PRODUCT_UNAVAILABLE_FOR_ICCID"; detail: string; statusCode?: number }
  | { kind: "PROVIDER"; detail: string; statusCode?: number }
  | { kind: "TIMEOUT_OR_NETWORK"; detail: string; statusCode?: number }
  | { kind: "NOT_FOUND"; detail: string; statusCode?: number }
  | { kind: "MISSING_PROVISIONING"; detail: string; statusCode?: number };

export type SimSubscribeResult = {
  ok: boolean;
  confirmedStatus: "ACTIVE" | null;
  pendingConfirmation: boolean;
  message: string;
  confirmedLocalProductId?: string | null;
  confirmedLocalProductName?: string | null;
  error?: SimSubscribeError;
};

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

function toDateOrNull(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  try {
    const d = raw instanceof Date ? raw : new Date(String(raw));
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
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
      return {
        kind: "PROVIDER" as const,
        detail: (err as any)?.detail || "Onbekende provider-fout.",
        statusCode: (err as any)?.httpStatus ?? undefined,
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

async function authorizeSubscribe(ctx: AuthContext): Promise<SimSubscribeError | null> {
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
    await requirePermission(pickAuth(ctx), "edit", "activation_order");
    return null;
  } catch (e: any) {
    return {
      kind: "PERMISSION",
      detail: e?.message ? String(e.message) : "Onvoldoende rechten.",
    };
  }
}

export async function subscribeSimById(
  simId: string,
  ctx: AuthContext,
  opts: {
    orderId?: string;
    targetProductId: string;
    targetProductName: string;
  }
): Promise<SimSubscribeResult> {
  const { orderId, targetProductId, targetProductName } = opts;
  const t0 = Date.now();

  const forbidden = await authorizeSubscribe(ctx);
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

  const allowedBefore = new Set<SimStatus>([SimStatus.IN_STOCK, SimStatus.RESERVED]);
  if (!allowedBefore.has(sim.status as any) && (sim.status as string) !== "IN_STOCK" && (sim.status as string) !== "RESERVED") {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: `Kan niet activeren: SIM heeft momenteel status ${sim.status}.`,
      error: {
        kind: "INVALID_STATUS_TRANSITION",
        detail: `Kan niet activeren: SIM heeft momenteel status ${sim.status}. Alleen SIM's met status "Op voorraad" of "Gereserveerd" kunnen voor de eerstmaal worden geactiveerd. Gebruik Deblokkeren voor reeds geactiveerde, geblokkeerde SIM's.`,
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

  let subscriberAccountId: string | null = null;
  if (orderId) {
    try {
      const order = await findActivationOrderById(orderId, ctx.customerScope);
      if (order) {
        subscriberAccountId =
          (order as any).subCustomerId ?? (order as any).customerId ?? subscriberAccountId;
        if (typeof subscriberAccountId === "string" && subscriberAccountId.trim().length === 0) {
          subscriberAccountId = null;
        }
      }
    } catch (e: any) {
      console.warn(`[simhuis-asset-service] order lookup (${orderId}) mislukte:`, e?.message ?? e);
    }
  }
  if (!subscriberAccountId && ctx.customerId) {
    subscriberAccountId = ctx.customerId;
  }
  if (!subscriberAccountId) {
    try {
      const fallback = await prisma.appSetting.findFirst({
        where: { key: "simhuis.defaultSubscriberAccountId" },
        select: { value: true },
      });
      if (fallback?.value && typeof fallback.value === "string") {
        subscriberAccountId = fallback.value;
      }
    } catch {}
  }
  if (!subscriberAccountId) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Subscriber-account kon niet worden bepaald.",
      error: {
        kind: "MISSING_PROVISIONING",
        detail: "SubscriberAccountId ontbreekt. Controleer de activatie-ordervoorkeuren of stel een standaardwaarde in via AppSetting 'simhuis.defaultSubscriberAccountId'.",
      },
    };
  }

  let ipPools: string[] | Record<string, string> | undefined = undefined;
  try {
    const prefixes = await prisma.appSetting.findMany({
      where: { key: { startsWith: "simhuis.ipPool." } },
      select: { key: true, value: true },
    });
    if (prefixes.length > 0) {
      const pools: Record<string, string> = {};
      for (const p of prefixes) {
        const suffix = p.key.slice("simhuis.ipPool.".length);
        if (suffix && typeof p.value === "string" && p.value.length > 0) {
          pools[suffix] = p.value;
        }
      }
      if (Object.keys(pools).length > 0) ipPools = pools;
    }
  } catch {}

  try {
    const pre1 = await precheckProductById(targetProductId, targetProductName);
    if (!pre1.ok) {
      return {
        ok: false,
        confirmedStatus: null,
        pendingConfirmation: false,
        message: pre1.detail ?? "Productcontrole (stap 1) mislukte.",
        error: {
          kind: "PRODUCT_MISMATCH",
          detail: pre1.detail ?? "Product is ongeldig of naam komt niet overeen.",
          statusCode: pre1.httpStatus,
        },
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Productcontrole kon niet worden uitgevoerd.",
      error: {
        kind: "TIMEOUT_OR_NETWORK",
        detail: String(e?.message ?? e ?? "Precheck product mislukte."),
      },
    };
  }

  try {
    const pre2 = await precheckProductAvailability(sim.iccid, targetProductId);
    if (!pre2.ok) {
      return {
        ok: false,
        confirmedStatus: null,
        pendingConfirmation: false,
        message: pre2.detail ?? "Product is niet beschikbaar voor deze SIM.",
        error: {
          kind: "PRODUCT_UNAVAILABLE_FOR_ICCID",
          detail: pre2.detail ?? "Product is niet beschikbaar voor deze ICCID.",
          statusCode: pre2.httpStatus,
        },
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: "Productbeschikbaarheid kon niet worden gecontroleerd.",
      error: {
        kind: "TIMEOUT_OR_NETWORK",
        detail: String(e?.message ?? e ?? "Precheck availability mislukte."),
      },
    };
  }

  let providerRes: SimhuisSubscribeResult;
  try {
    providerRes = await subscribeSimhuisAsset(sim.iccid, {
      productId: targetProductId,
      subscriberAccountId: subscriberAccountId!,
      ipPools,
    });
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
      let live: Awaited<ReturnType<typeof getSimStatus>> | null = null;
      const { getSimStatusFast } = await import('@/server/integrations/simhuis/service');
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
      if (liveNexus === SimStatus.ACTIVE) {
        providerRes = {
          ok: true,
          rawPut: null,
          rawGet: live?.raw ?? null,
          accountIdUsed: providerRes.accountIdUsed,
          httpStatusPut: 202,
          confirmedSimhuisStatus: live?.status ?? "active",
          confirmedLocalProductId: providerRes.confirmedLocalProductId ?? null,
          confirmedLocalProductName: providerRes.confirmedLocalProductName ?? null,
        };
      } else {
        try {
          const fresh = await getAssetByIccid(sim.iccid);
          if (fresh.ok && fresh.raw) {
            const parsed = (await import('@/server/integrations/simhuis/service')).toSimStatus?.(fresh.raw, sim.iccid);
            const status = parsed?.status ?? null;
            const nexus = mapSimhuisStatusToNexus(status);
            if (nexus === SimStatus.ACTIVE) {
              providerRes = {
                ok: true,
                rawPut: null,
                rawGet: fresh.raw,
                accountIdUsed: fresh.accountIdUsed ?? providerRes.accountIdUsed,
                httpStatusPut: 202,
                confirmedSimhuisStatus: status ?? "active",
                confirmedLocalProductId: providerRes.confirmedLocalProductId ?? null,
                confirmedLocalProductName: providerRes.confirmedLocalProductName ?? null,
              };
            }
          }
        } catch {}
      }
    } catch {
      // negeer: originele timeout error blijft
    }
  }

  if (!providerRes.ok) {
    const err = providerRes.error;
    const mapKind = (k: string): SimSubscribeError['kind'] => {
      switch (k) {
        case 'NOT_CONFIGURED':
        case 'AUTH_FAILED':
        case 'INVALID_ACCOUNTID':
        case 'PROVIDER_REJECTED':
          return 'PROVIDER';
        case 'PRODUCT_MISMATCH':
          return 'PRODUCT_MISMATCH';
        case 'PRODUCT_UNAVAILABLE_FOR_ICCID':
          return 'PRODUCT_UNAVAILABLE_FOR_ICCID';
        case 'MISSING_PROVISIONING_SETTINGS':
          return 'MISSING_PROVISIONING';
        case 'TIMEOUT_OR_NETWORK':
        default:
          return 'TIMEOUT_OR_NETWORK';
      }
    };
    return {
      ok: false,
      confirmedStatus: null,
      pendingConfirmation: false,
      message: err?.detail ?? "Activeren mislukte.",
      error: {
        kind: err?.kind ? mapKind(err.kind) : 'PROVIDER',
        detail: err?.detail ?? "Activeren via provider mislukte.",
        statusCode: err?.httpStatus,
      },
    };
  }

  type RaceResult = SimSubscribeResult | "__OVERALL_TIMEOUT__";
  const overallTimeoutMs = 15_000;

  const workPromise: Promise<RaceResult> = (async () => {
    const nexusStatus = mapSimhuisStatusToNexus(providerRes.confirmedSimhuisStatus ?? null);
    let confirmed: "ACTIVE" | null = nexusStatus === SimStatus.ACTIVE ? "ACTIVE" : null;
    let pendingConfirmation = confirmed === null;
    let confirmedSource: string | null = confirmed ? "provider-direct" : null;

    let confirmedLocalProductId: string | null = providerRes.confirmedLocalProductId ?? null;
    let confirmedLocalProductName: string | null = providerRes.confirmedLocalProductName ?? null;

    if (pendingConfirmation) {
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
        if (liveNexus === SimStatus.ACTIVE && !confirmed) {
          confirmed = "ACTIVE";
          pendingConfirmation = false;
          confirmedSource = "fallback-bulk";
        }
      } catch {}
    }

    if (pendingConfirmation) {
      try {
        await new Promise<void>((r) => setTimeout(r, 2500));
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
        if (live2Nexus === SimStatus.ACTIVE && !confirmed) {
          confirmed = "ACTIVE";
          pendingConfirmation = false;
          confirmedSource = "delayed-bulk";
        }
      } catch {}
    }

    if (confirmed === "ACTIVE" && (!confirmedLocalProductId || !confirmedLocalProductName)) {
      try {
        const fresh = await getAssetByIccid(sim.iccid);
        if (fresh.ok && fresh.raw) {
          const mod = await import('@/server/integrations/simhuis/service');
          const r = fresh.raw as Record<string, any>;
          const subscriptions = Array.isArray(r?.subscriptions) ? r.subscriptions : [];
          outer: for (const sub of subscriptions) {
            if (!sub || typeof sub !== "object") continue;
            const bundles = Array.isArray((sub as any).bundles) ? (sub as any).bundles : [];
            for (const bundle of bundles) {
              if (!bundle || typeof bundle !== "object") continue;
              const b = bundle as Record<string, any>;
              const lpid = b?.['localProductId'] ?? b?.['productId'] ?? b?.['_id'] ?? b?.['id'];
              const lpnm = b?.['localProductName'] ?? b?.['productName'] ?? b?.['name'] ?? b?.['displayName'];
              if (lpid || lpnm) {
                confirmedLocalProductId = lpid ? String(lpid) : confirmedLocalProductId;
                confirmedLocalProductName = lpnm ? String(lpnm) : confirmedLocalProductName;
                break outer;
              }
            }
          }
        }
      } catch {}
    }

    let dbUpdated = false;
    try {
      if (!pendingConfirmation && confirmed) {
        await prisma.$transaction(async (tx) => {
          const updateData: any = {
            status: SimStatus.ACTIVE,
            updatedAt: new Date(),
          };
          if (confirmedLocalProductId || confirmedLocalProductName) {
            const prev = (sim as any).productMetadata ?? {};
            updateData.productMetadata = {
              ...(typeof prev === "object" && prev ? prev : {}),
              localProductId: confirmedLocalProductId ?? undefined,
              localProductName: confirmedLocalProductName ?? undefined,
              activatedProductId: targetProductId,
              activatedProductName: targetProductName,
              activatedAt: new Date().toISOString(),
              subscriberAccountId: subscriberAccountId ?? undefined,
              accountIdUsed: providerRes.accountIdUsed ?? undefined,
            };
          }
          const updated = await tx.sIM.update({
            where: { id: sim.id },
            data: updateData,
          });
          await logAudit(tx, {
            entityType: "sim",
            entityId: sim.id,
            action: "SUBSCRIBE_ACTIVATE",
            userId: ctx.userId,
            oldValues: { status: sim.status },
            newValues: {
              status: SimStatus.ACTIVE,
              confirmedLocalProductId,
              confirmedLocalProductName,
            },
            metadata: {
              source: "simhuis-asset-subscribe",
              providerHttpStatusPut: providerRes.httpStatusPut,
              pendingConfirmation: false,
              confirmedSource,
              targetProductId,
              targetProductName,
              subscriberAccountId: subscriberAccountId ?? null,
              accountIdUsed: providerRes.accountIdUsed ?? null,
              orderId: orderId ?? null,
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
            action: "SUBSCRIBE_ACTIVATE",
            userId: ctx.userId,
            oldValues: { status: sim.status },
            newValues: { status: "PENDING_ACTIVE" as unknown as string },
            metadata: {
              source: "simhuis-asset-subscribe",
              providerHttpStatusPut: providerRes.httpStatusPut,
              pendingConfirmation: true,
              confirmedStatusFromProvider: providerRes.confirmedSimhuisStatus ?? null,
              confirmedLocalProductId: providerRes.confirmedLocalProductId ?? null,
              confirmedLocalProductName: providerRes.confirmedLocalProductName ?? null,
              targetProductId,
              targetProductName,
              subscriberAccountId: subscriberAccountId ?? null,
              accountIdUsed: providerRes.accountIdUsed ?? null,
              orderId: orderId ?? null,
              note: "Provider call is 2xx OK, maar status en productkoppeling nog niet bevestigd. SIM-status wordt later bijgewerkt door verbruik-sync of handmatig verversen.",
            },
          });
        } catch {}
      }
    } catch (e: any) {
      console.error(
        `[simhuis-asset-service] Fout bij bijwerken DB/audit na activeren van sim ${sim.id}:`,
        e?.message ?? e
      );
    }

    if (confirmed === "ACTIVE") {
      const productOk =
        confirmedLocalProductId === targetProductId ||
        (confirmedLocalProductName && confirmedLocalProductName.trim().toLowerCase() === targetProductName.trim().toLowerCase());
      if (productOk) {
        return {
          ok: true,
          confirmedStatus: "ACTIVE",
          pendingConfirmation: false,
          message: "Simkaart geactiveerd.",
          confirmedLocalProductId,
          confirmedLocalProductName,
        };
      }
      return {
        ok: true,
        confirmedStatus: "ACTIVE",
        pendingConfirmation: false,
        message: "Simkaart geactiveerd. Let op: de productkoppeling kon nog niet volledig worden bevestigd.",
        confirmedLocalProductId,
        confirmedLocalProductName,
      };
    }

    return {
      ok: true,
      confirmedStatus: null,
      pendingConfirmation: true,
      message: "Het activatieverzoek is verwerkt. De activatie wordt nog gecontroleerd.",
      confirmedLocalProductId,
      confirmedLocalProductName,
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
        action: "SUBSCRIBE_ACTIVATE",
        userId: ctx.userId,
        oldValues: { status: sim.status },
        newValues: { status: "PENDING_ACTIVE" as unknown as string },
        metadata: {
          source: "simhuis-asset-subscribe",
          providerHttpStatusPut: providerRes.httpStatusPut,
          pendingConfirmation: true,
          confirmedStatusFromProvider: providerRes.confirmedSimhuisStatus ?? null,
          confirmedLocalProductId: providerRes.confirmedLocalProductId ?? null,
          confirmedLocalProductName: providerRes.confirmedLocalProductName ?? null,
          targetProductId,
          targetProductName,
          subscriberAccountId: subscriberAccountId ?? null,
          accountIdUsed: providerRes.accountIdUsed ?? null,
          orderId: orderId ?? null,
          note: `Overall timeout van ${overallTimeoutMs}ms bereikt. Provider call is 2xx OK, maar status-bevestiging duurde te lang. SIM-status wordt later bijgewerkt door verbruik-sync of handmatig verversen.`,
        },
      });
    } catch {}
    return {
      ok: true,
      confirmedStatus: null,
      pendingConfirmation: true,
      message:
        "Het activatieverzoek is verwerkt bij Simhuis. De actuele SIM-status en productkoppeling kon niet direct worden bevestigd (binnen 15s). Controleer de status over enkele seconden of ververs handmatig.",
      confirmedLocalProductId: providerRes.confirmedLocalProductId ?? null,
      confirmedLocalProductName: providerRes.confirmedLocalProductName ?? null,
    };
  }

  return raceResult as SimSubscribeResult;
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
    await requirePermission(pickAuth(ctx), "edit", "sim");
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

  const dateFields: { activationDate?: Date; reactivationDate?: Date; subscriptionDate?: Date } = {};
  const liveAd = toDateOrNull((live as any).activationDate);
  const liveRad = toDateOrNull((live as any).reactivationDate);
  const liveSd = toDateOrNull((live as any).subscriptionDate);
  if (liveAd) dateFields.activationDate = liveAd;
  if (liveRad) dateFields.reactivationDate = liveRad;
  if (liveSd) dateFields.subscriptionDate = liveSd;

  let dbUpdated = false;
  try {
    if (changed) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.sIM.update({
          where: { id: sim.id },
          data: { status: refreshedStatus, updatedAt: new Date(), ...dateFields },
        });
        await logAudit(tx, {
          entityType: "sim",
          entityId: sim.id,
          action: "UPDATE",
          userId: ctx.userId,
          oldValues: { status: previousStatus },
          newValues: { status: refreshedStatus, ...dateFields },
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
          data: { updatedAt: new Date(), ...dateFields },
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
