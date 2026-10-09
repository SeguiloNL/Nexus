import { prisma } from "@/lib/prisma";
import { AuditAction, CustomerStatus, CustomerLinkSource } from "@prisma/client";
import { logAudit } from "./audit.service";
import type { Prisma, SIM as PrismaSim, Customer as PrismaCustomer } from "@prisma/client";
import {
  listAllAssets,
  assetIsSimkaart,
  resolveAssetCategoryName,
  extractAssetCompanyId,
  extractAssetIdentifiers,
} from "@/server/integrations/inserve/service";
import type { InserveAsset } from "@/server/integrations/inserve/types";
import { InserveClient, InserveRateLimitExceededError, isInserveRateLimitError } from "@/server/integrations/inserve/client";
import { normalizeIccid, normalizeMsisdn, normalizeEid, normalizeImsi, maskIccid, isPlaceholderIdentifier } from "@/lib/identifiers";

export type SimLinkSkipReason =
  | "no_company_in_inserve"
  | "company_not_linked_or_inactive"
  | "duplicate_asset_same_iccid_same_company"
  | "category_not_simkaart"
  | "asset_inactive_filter";

export type SimLinkConflictReason =
  | "multiple_nexus_sims_for_iccid"
  | "multiple_inserve_assets_same_iccid_different_company"
  | "existing_manual_link_to_different_customer"
  | "existing_subscription_derived_link_to_different_customer"
  | "existing_unknown_link_to_different_customer"
  | "inserve_asset_id_linked_to_other_sim"
  | "existing_assignment_to_different_customer";

export interface SimLinkSkipDetail {
  assetId: number | string;
  iccidMasked: string | null;
  companyName: string | null;
  companyId: number | null;
  reason: SimLinkSkipReason;
  detail?: string | null;
}
export interface SimLinkConflictDetail {
  assetId: number | string;
  iccidMasked: string | null;
  nexusSimIds: string[];
  companyId: number | null;
  companyName: string | null;
  otherCompanyId?: number | null;
  otherCompanyName?: string | null;
  reason: SimLinkConflictReason;
  detail?: string | null;
}
export interface SimLinkNoMatchDetail {
  assetId: number | string;
  companyId: number | null;
  companyName: string | null;
  iccidRaw: string | null;
  msisdnRaw: string | null;
  reason:
    | "missing_identifier"
    | "invalid_or_placeholder_identifier"
    | "no_nexus_sim_found_for_iccid"
    | "identifier_value_absurd";
  detail?: string | null;
}

export interface SimLinkSummary {
  totalAssetsExamined: number;
  totalAssetsFetched: number;
  newlyLinked: number;
  reassignedInserveManaged: number;
  unchanged: number;
  notMatched: number;
  conflicts: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  endpointUsed: string | null;
  pagesProcessed: number;
  totalExpectedAssets: number;
  skippedDetails: SimLinkSkipDetail[];
  conflictDetails: SimLinkConflictDetail[];
  notMatchedDetails: SimLinkNoMatchDetail[];
  errorMessages: string[];
  rateLimitBreached?: boolean;
  skippedDueToLowBudget?: boolean;
  budgetRemainingAtStart?: number;
  budgetUsedAtStart?: number;
}

export interface RunSimLinkOptions {
  dryRun?: boolean;
  maxPages?: number;
  endpointHint?: string;
  perPage?: number;
  auditUserId?: string;
}

export const EMPTY_SIM_LINK_SUMMARY: SimLinkSummary = {
  totalAssetsExamined: 0,
  totalAssetsFetched: 0,
  newlyLinked: 0,
  reassignedInserveManaged: 0,
  unchanged: 0,
  notMatched: 0,
  conflicts: 0,
  skipped: 0,
  errors: 0,
  dryRun: false,
  endpointUsed: null,
  pagesProcessed: 0,
  totalExpectedAssets: 0,
  skippedDetails: [],
  conflictDetails: [],
  notMatchedDetails: [],
  errorMessages: [],
  rateLimitBreached: false,
  skippedDueToLowBudget: false,
};

type CompanyInfo = { customerId: string; companyName: string; customerNumber: string | null; status: CustomerStatus };

function coerceAssetId(asset: InserveAsset): number | string {
  const raw = (asset as any).id;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n) && Number.isInteger(n)) return n;
    return raw;
  }
  return String(raw ?? 'unknown');
}

function pushLimited<T>(arr: T[], v: T, limit = 500): void {
  if (arr.length < limit) arr.push(v);
}

export async function runInserveSimAssetLink(opts: RunSimLinkOptions = {}): Promise<SimLinkSummary> {
  const { dryRun = false, maxPages, endpointHint, perPage, auditUserId } = opts;
  const summary: SimLinkSummary = { ...EMPTY_SIM_LINK_SUMMARY, dryRun };

  // Budget snapshot (voor debug/rapportage)
  const snap = InserveClient.getBudget();
  summary.budgetRemainingAtStart = snap.remaining;
  summary.budgetUsedAtStart = snap.used;

  // [RC5] Budget onder de drempel — skip de gehele SIM-koppelingsfase.
  //     (We willen geen 39 strategy-trial calls opeten als er al < 15
  //      calls over zijn, dat verspilt alleen budget voor de eerstvolgende
  //      run.)
  const MIN_BUDGET_FOR_SIM_LINK = 15;
  if (InserveClient.isBudgetBelow(MIN_BUDGET_FOR_SIM_LINK)) {
    summary.skippedDueToLowBudget = true;
    summary.errorMessages.push(
      `SIM-link overgeslagen: resterend API-budget ${snap.remaining}/${snap.max} < ${MIN_BUDGET_FOR_SIM_LINK}. Wacht tot het rolling-window bijvult.`
    );
    return summary;
  }

  try {
    // [1] Actieve, Inserve-gekoppelde bedrijven
    const linkedCustomers: Array<PrismaCustomer & { inserveCompanyId: number }> = await prisma.customer.findMany({
      where: {
        inserveCompanyId: { not: null },
        status: CustomerStatus.ACTIVE,
        deletedAt: null,
      },
    }) as any;

    const companyMap = new Map<number, CompanyInfo>();
    for (const c of linkedCustomers) {
      if (c.inserveCompanyId == null) continue;
      companyMap.set(c.inserveCompanyId, {
        customerId: c.id,
        companyName: c.companyName,
        customerNumber: c.customerNumber,
        status: c.status,
      });
    }

    // [2] Ophalen alle assets
    let listResult: Awaited<ReturnType<typeof listAllAssets>>;
    try {
      listResult = await listAllAssets({ maxPages, endpointHint, perPage });
    } catch (e: any) {
      const rl = isInserveRateLimitError(e);
      if (rl) {
        summary.rateLimitBreached = true;
        summary.errors++;
        summary.errorMessages.push(
          `Rate limit bereikt tijdens listAllAssets (${rl.usedCount}/${rl.maxCount}). ` +
          `SIM-koppeling onderbroken; probeer over ${Math.ceil(rl.remainingMs / 1000)}s opnieuw.`
        );
        return summary;
      }
      summary.errors++;
      summary.errorMessages.push(`listAllAssets failed: ${e?.message ?? String(e)}`.slice(0, 400));
      return summary;
    }
    summary.endpointUsed = listResult.endpointUsed;
    summary.pagesProcessed = listResult.pagesProcessed;
    summary.totalExpectedAssets = listResult.totalExpected;
    summary.totalAssetsFetched = listResult.totalFetched;

    type ParsedAsset = {
      asset: InserveAsset;
      assetId: number | string;
      categoryName: string | null;
      isSimkaart: boolean;
      companyId: number | null;
      company: CompanyInfo | null;
      iccidNormalized: string | null;
      eidNormalized: string | null;
      msisdnNormalized: string | null;
      imsiNormalized: string | null;
      identifierFieldsCount: number;
    };

    const parsed: ParsedAsset[] = [];
    const nonSimAssets: ParsedAsset[] = [];

    for (const asset of listResult.items) {
      const assetId = coerceAssetId(asset);
      const categoryName = resolveAssetCategoryName(asset);
      const isSim = assetIsSimkaart(asset);
      const ids = extractAssetIdentifiers(asset);
      const iccidNorm = normalizeIccid(ids.iccid);
      const eidNorm = normalizeEid(ids.eid);
      const msisdnNorm = normalizeMsisdn(ids.msisdn);
      const imsiNorm = normalizeImsi(ids.imsi);
      const inCompanyId = extractAssetCompanyId(asset);
      const company = inCompanyId ? companyMap.get(inCompanyId) ?? null : null;

      const entry: ParsedAsset = {
        asset,
        assetId,
        categoryName,
        isSimkaart: isSim,
        companyId: inCompanyId,
        company,
        iccidNormalized: iccidNorm,
        eidNormalized: eidNorm,
        msisdnNormalized: msisdnNorm,
        imsiNormalized: imsiNorm,
        identifierFieldsCount: ids.allFound.length,
      };
      if (isSim) {
        parsed.push(entry);
      } else {
        nonSimAssets.push(entry);
      }
    }
    summary.totalAssetsExamined = parsed.length + nonSimAssets.length;

    // [2b] Niet-simkaart assets: direct naar skipped met reden category_not_simkaart
    for (const p of nonSimAssets) {
      summary.skipped++;
      pushLimited(summary.skippedDetails, {
        assetId: p.assetId,
        iccidMasked: maskIccid(p.iccidNormalized),
        companyId: p.companyId,
        companyName: p.company?.companyName ?? null,
        reason: "category_not_simkaart",
        detail: p.categoryName ?? undefined,
      });
    }

    // [3] Eerste schifting: overslaan van niet-simkaart of bedrijf ontbreekt/niet-actief
    type QualifiedAsset = ParsedAsset; // alleen assets die Simkaart-zijn
    const qualifiedAssets: QualifiedAsset[] = [];
    for (const p of parsed) {
      if (!p.companyId) {
        summary.skipped++;
        pushLimited(summary.skippedDetails, {
          assetId: p.assetId,
          iccidMasked: maskIccid(p.iccidNormalized),
          companyId: null,
          companyName: null,
          reason: "no_company_in_inserve",
          detail: p.categoryName ?? undefined,
        });
        continue;
      }
      if (!p.company) {
        summary.skipped++;
        pushLimited(summary.skippedDetails, {
          assetId: p.assetId,
          iccidMasked: maskIccid(p.iccidNormalized),
          companyId: p.companyId,
          companyName: null,
          reason: "company_not_linked_or_inactive",
          detail: p.categoryName ?? undefined,
        });
        continue;
      }
      qualifiedAssets.push(p);
    }

    // [4] Per asset identificatie: ICCID ontbreekt?
    type ReadyAsset = QualifiedAsset & {
      normIccid: string;
    };
    const readyAssets: ReadyAsset[] = [];
    for (const q of qualifiedAssets) {
      if (!q.iccidNormalized) {
        // Bepaal waarom: geen identifier, of placeholder
        const anyRaw = (extractAssetIdentifiers(q.asset).iccid ?? (q.asset as any).iccid ?? (q.asset as any).serial ?? null);
        let reason: SimLinkNoMatchDetail["reason"] = "missing_identifier";
        if (anyRaw != null) {
          const s = String(anyRaw);
          if (isPlaceholderIdentifier(s)) reason = "invalid_or_placeholder_identifier";
          else if (s.length > 0) reason = "invalid_or_placeholder_identifier";
        }
        summary.notMatched++;
        pushLimited(summary.notMatchedDetails, {
          assetId: q.assetId,
          companyId: q.companyId,
          companyName: q.company?.companyName ?? null,
          iccidRaw: anyRaw ? String(anyRaw).slice(0, 60) : null,
          msisdnRaw: q.msisdnNormalized,
          reason,
          detail: q.categoryName ?? undefined,
        });
        continue;
      }
      readyAssets.push({ ...q, normIccid: q.iccidNormalized });
    }

    // [5] Twee-fase grouping per ICCID
    type GroupEntry = {
      ready: ReadyAsset;
      companyId: number;
      companyName: string;
      customerId: string;
      assetId: number | string;
    };
    const byIccid = new Map<string, GroupEntry[]>();
    for (const r of readyAssets) {
      const entries = byIccid.get(r.normIccid) ?? [];
      entries.push({
        ready: r,
        companyId: r.companyId!,
        companyName: r.company!.companyName,
        customerId: r.company!.customerId,
        assetId: r.assetId,
      });
      byIccid.set(r.normIccid, entries);
    }

    // [5a] Conflict: zelfde ICCID meerdere assets, verschillende bedrijven
    const iccidBlockedMultiCompany = new Set<string>();
    const iccidBlockedDuplicatesSameCompany = new Map<string, number>(); // iccid -> master assetId (laagste id)
    for (const [normIccid, arr] of byIccid) {
      const companies = Array.from(new Set(arr.map((a) => a.companyId)));
      if (companies.length > 1) {
        // Alle assets in deze ICCID: markeren als conflict, none applied
        iccidBlockedMultiCompany.add(normIccid);
        summary.conflicts += arr.length;
        for (const a of arr) {
          pushLimited(summary.conflictDetails, {
            assetId: a.assetId,
            iccidMasked: maskIccid(normIccid),
            nexusSimIds: [],
            companyId: a.companyId,
            companyName: a.companyName,
            otherCompanyId: companies.find((c) => c !== a.companyId) ?? null,
            otherCompanyName: arr.find((x) => x.companyId !== a.companyId)?.companyName ?? null,
            reason: "multiple_inserve_assets_same_iccid_different_company",
            detail: `assets=${arr.length}, companies=${companies.length}`,
          });
        }
      } else {
        // Zelfde bedrijf: laagste assetId als master, de rest is "duplicate" (skipped)
        if (arr.length > 1) {
          const sorted = [...arr].sort((x, y) => {
            const ax = typeof x.assetId === 'number' ? x.assetId : Number.MAX_SAFE_INTEGER;
            const ay = typeof y.assetId === 'number' ? y.assetId : Number.MAX_SAFE_INTEGER;
            return ax - ay;
          });
          const masterId = sorted[0].assetId;
          iccidBlockedDuplicatesSameCompany.set(normIccid, (sorted[0].assetId as number) || 0);
          for (let i = 1; i < sorted.length; i++) {
            const dup = sorted[i];
            summary.skipped++;
            pushLimited(summary.skippedDetails, {
              assetId: dup.assetId,
              iccidMasked: maskIccid(normIccid),
              companyId: dup.companyId,
              companyName: dup.companyName,
              reason: "duplicate_asset_same_iccid_same_company",
              detail: `masterAssetId=${String(masterId)}`,
            });
          }
        }
      }
    }

    // [6] DB-lookup: per niet-blocked ICCID: zoek bestaande SIM(s) + bestaande per assetId
    const lookupIccids: string[] = [];
    const lookupAssetIds: Array<number | string> = [];
    for (const [normIccid, arr] of byIccid) {
      if (iccidBlockedMultiCompany.has(normIccid)) continue;
      lookupIccids.push(normIccid);
      for (const a of arr) lookupAssetIds.push(a.assetId);
    }

    const [simsByIccidRows, simsByInserveAssetIdRows] = await Promise.all([
      lookupIccids.length > 0
        ? prisma.sIM.findMany({ where: { iccid: { in: lookupIccids } } })
        : Promise.resolve([] as PrismaSim[]),
      lookupAssetIds.length > 0
        ? prisma.sIM.findMany({
            where: { inserveAssetId: { in: lookupAssetIds.filter((x): x is number => typeof x === 'number') } as Prisma.IntFilter },
          })
        : Promise.resolve([] as PrismaSim[]),
    ]);

    const simsByIccid = new Map<string, PrismaSim[]>();
    for (const sim of simsByIccidRows) {
      const arr = simsByIccid.get(sim.iccid) ?? [];
      arr.push(sim);
      simsByIccid.set(sim.iccid, arr);
    }
    const simByInserveAssetId = new Map<number, PrismaSim>();
    for (const sim of simsByInserveAssetIdRows) {
      if (sim.inserveAssetId != null) simByInserveAssetId.set(sim.inserveAssetId, sim);
    }

    // [7] Beslissingsmatrix per asset (alleen niet-blocked en alleen master bij duplicates)
    const auditNewly: Array<{ simId: string; iccid: string; customerId: string; assetId: number | string; before: any; after: any }> = [];
    const auditReassigned: Array<{ simId: string; iccid: string; assetId: number | string; beforeCustomerId: string; afterCustomerId: string; before: any; after: any }> = [];
    const auditConflicts: Array<{ simId: string; iccid: string; assetId: number | string; reason: string }> = [];

    const prismaOps: Array<Promise<unknown>> = [];

    for (const [normIccid, arr] of byIccid) {
      if (iccidBlockedMultiCompany.has(normIccid)) continue;
      const masterAssetIdNum = iccidBlockedDuplicatesSameCompany.get(normIccid);
      const masterEntry =
        masterAssetIdNum !== undefined
          ? arr.find((a) => a.assetId === masterAssetIdNum) ??
            arr.find((a) => typeof a.assetId === 'number' && a.assetId === masterAssetIdNum) ??
            arr[0]
          : arr[0];

      const nexusSims = simsByIccid.get(normIccid) ?? [];
      if (nexusSims.length === 0) {
        // Geen match in Nexus
        summary.notMatched++;
        pushLimited(summary.notMatchedDetails, {
          assetId: masterEntry.assetId,
          companyId: masterEntry.companyId,
          companyName: masterEntry.companyName,
          iccidRaw: normIccid,
          msisdnRaw: masterEntry.ready.msisdnNormalized,
          reason: "no_nexus_sim_found_for_iccid",
          detail: null,
        });
        continue;
      }
      if (nexusSims.length > 1) {
        // Meerdere matches op ICCID (Zou niet mogen via unique, maar kan via soft-deleted of race)
        summary.conflicts++;
        pushLimited(summary.conflictDetails, {
          assetId: masterEntry.assetId,
          iccidMasked: maskIccid(normIccid),
          nexusSimIds: nexusSims.map((s) => s.id),
          companyId: masterEntry.companyId,
          companyName: masterEntry.companyName,
          reason: "multiple_nexus_sims_for_iccid",
          detail: `nexus_sims=${nexusSims.length}`,
        });
        if (!dryRun) auditConflicts.push({ simId: nexusSims[0].id, iccid: normIccid, assetId: masterEntry.assetId, reason: "multiple_nexus_sims_for_iccid" });
        continue;
      }

      const sim = nexusSims[0];
      // Check: inserveAssetId reeds bezet door ANDERE sim in DB (door unique constraint, maar soft-deleted)
      const assetIdNum = typeof masterEntry.assetId === 'number' ? masterEntry.assetId : null;
      if (assetIdNum !== null) {
        const existingByAsset = simByInserveAssetId.get(assetIdNum);
        if (existingByAsset && existingByAsset.id !== sim.id) {
          summary.conflicts++;
          pushLimited(summary.conflictDetails, {
            assetId: masterEntry.assetId,
            iccidMasked: maskIccid(normIccid),
            nexusSimIds: [existingByAsset.id, sim.id],
            companyId: masterEntry.companyId,
            companyName: masterEntry.companyName,
            reason: "inserve_asset_id_linked_to_other_sim",
            detail: `other_sim=${existingByAsset.id}`,
          });
          if (!dryRun) auditConflicts.push({ simId: sim.id, iccid: normIccid, assetId: masterEntry.assetId, reason: "inserve_asset_id_linked_to_other_sim" });
          continue;
        }
      }

      // Bestaande herkomst
      const existingCustomerId = sim.customerId ?? null;
      const existingSource = sim.customerLinkSource ?? null;
      const targetCustomerId = masterEntry.customerId;

      const sameCustomer = existingCustomerId !== null && existingCustomerId === targetCustomerId;

      let action:
        | "new"
        | "unchanged"
        | "reassign"
        | "conflict-manual"
        | "conflict-subscription"
        | "conflict-unknown" = "new";

      if (existingCustomerId === null || existingSource === null) {
        action = "new";
      } else if (sameCustomer && existingSource === CustomerLinkSource.INSERVE_ASSET) {
        action = "unchanged";
      } else if (existingSource === CustomerLinkSource.INSERVE_ASSET) {
        action = "reassign";
      } else if (existingSource === CustomerLinkSource.MANUAL) {
        action = sameCustomer ? "unchanged" : "conflict-manual";
      } else if (existingSource === CustomerLinkSource.SUBSCRIPTION_DERIVED) {
        action = sameCustomer ? "unchanged" : "conflict-subscription";
      } else if (existingSource === CustomerLinkSource.UNKNOWN) {
        action = sameCustomer ? "unchanged" : "conflict-unknown";
      } else {
        action = sameCustomer ? "unchanged" : "conflict-unknown";
      }

      // Extra: Bestaande SimAssignment naar ANDERE customer? => conflict
      if (action === "new" || action === "reassign") {
        try {
          const activeAssign = await prisma.simAssignment.findFirst({
            where: { simId: sim.id, endAt: null },
            select: { id: true, subscription: { select: { customerId: true } } },
          });
          const otherAssign =
            activeAssign?.subscription?.customerId && activeAssign.subscription.customerId !== targetCustomerId
              ? activeAssign.subscription.customerId
              : null;
          if (otherAssign) {
            pushLimited(summary.conflictDetails, {
              assetId: masterEntry.assetId,
              iccidMasked: maskIccid(normIccid),
              nexusSimIds: [sim.id],
              companyId: masterEntry.companyId,
              companyName: masterEntry.companyName,
              otherCompanyId: null,
              otherCompanyName: null,
              reason: "existing_assignment_to_different_customer",
              detail: `assignment_to_subscription_customer=${otherAssign}`,
            });
            summary.conflicts++;
            if (!dryRun) auditConflicts.push({ simId: sim.id, iccid: normIccid, assetId: masterEntry.assetId, reason: "existing_assignment_to_different_customer" });
            continue;
          }
        } catch (e: any) {
          summary.errors++;
          pushLimited(summary.errorMessages, `[${sim.id}] SimAssignment lookup: ${e?.message ?? String(e)}`.slice(0, 300));
          continue;
        }
      }

      const now = new Date();
      if (action === "new") {
        summary.newlyLinked++;
        if (!dryRun) {
          const before = {
            customerId: sim.customerId,
            customerLinkSource: sim.customerLinkSource,
            inserveAssetId: sim.inserveAssetId,
            customerLinkedAt: sim.customerLinkedAt,
            inserveAssetLinkedAt: sim.inserveAssetLinkedAt,
          };
          const after = {
            customerId: targetCustomerId,
            customerLinkSource: CustomerLinkSource.INSERVE_ASSET,
            customerLinkedAt: now,
            inserveAssetId: assetIdNum,
            inserveAssetLinkedAt: now,
          };
          auditNewly.push({ simId: sim.id, iccid: normIccid, customerId: targetCustomerId, assetId: masterEntry.assetId, before, after });
          const op = prisma.sIM
            .update({
              where: { id: sim.id },
              data: after,
            })
            .catch((e) => {
              summary.errors++;
              summary.errorMessages.push(`[NEW] sim=${sim.id} iccid=${maskIccid(normIccid)}: ${e?.message ?? String(e)}`.slice(0, 300));
              // verwijder uit audit list
              const idx = auditNewly.findIndex((x) => x.simId === sim.id);
              if (idx >= 0) auditNewly.splice(idx, 1);
            });
          prismaOps.push(op);
        }
      } else if (action === "unchanged") {
        summary.unchanged++;
      } else if (action === "reassign") {
        summary.reassignedInserveManaged++;
        if (!dryRun) {
          const before = {
            customerId: sim.customerId,
            customerLinkSource: sim.customerLinkSource,
            inserveAssetId: sim.inserveAssetId,
            customerLinkedAt: sim.customerLinkedAt,
            inserveAssetLinkedAt: sim.inserveAssetLinkedAt,
          };
          const after = {
            customerId: targetCustomerId,
            customerLinkSource: CustomerLinkSource.INSERVE_ASSET,
            customerLinkedAt: now,
            inserveAssetId: assetIdNum,
            inserveAssetLinkedAt: now,
          };
          auditReassigned.push({
            simId: sim.id,
            iccid: normIccid,
            assetId: masterEntry.assetId,
            beforeCustomerId: before.customerId ?? "",
            afterCustomerId: after.customerId,
            before,
            after,
          });
          const op = prisma.sIM
            .update({
              where: { id: sim.id },
              data: after,
            })
            .catch((e) => {
              summary.errors++;
              summary.errorMessages.push(`[REASSIGN] sim=${sim.id} iccid=${maskIccid(normIccid)}: ${e?.message ?? String(e)}`.slice(0, 300));
              const idx = auditReassigned.findIndex((x) => x.simId === sim.id);
              if (idx >= 0) auditReassigned.splice(idx, 1);
            });
          prismaOps.push(op);
        }
      } else {
        // Conflicts: manual/subscription derived/unknown
        summary.conflicts++;
        const conflictReason: SimLinkConflictReason =
          action === "conflict-manual"
            ? "existing_manual_link_to_different_customer"
            : action === "conflict-subscription"
              ? "existing_subscription_derived_link_to_different_customer"
              : "existing_unknown_link_to_different_customer";
        pushLimited(summary.conflictDetails, {
          assetId: masterEntry.assetId,
          iccidMasked: maskIccid(normIccid),
          nexusSimIds: [sim.id],
          companyId: masterEntry.companyId,
          companyName: masterEntry.companyName,
          reason: conflictReason,
          detail: `existing_customer=${existingCustomerId ?? "<null>"} existing_source=${existingSource}`,
        });
        if (!dryRun) auditConflicts.push({ simId: sim.id, iccid: normIccid, assetId: masterEntry.assetId, reason: conflictReason });
      }
    }

    // [8] Wacht op DB writes (indien niet dryRun)
    if (!dryRun && prismaOps.length > 0) {
      await Promise.all(prismaOps);
    }

    // [9] Audit logging (buiten transacties, defensief)
    if (!dryRun) {
      for (const a of auditNewly) {
        try {
          await logAudit(prisma, {
            entityType: "sim",
            entityId: a.simId,
            action: AuditAction.INSERVE_SIM_LINKED,
            userId: auditUserId ?? undefined,
            oldValues: a.before,
            newValues: a.after,
            metadata: {
              customerId: a.customerId,
              assetId: String(a.assetId),
              iccidMasked: maskIccid(a.iccid),
              source: "inserve_sim_link",
            },
          });
        } catch {
          /* ignore audit failures */
        }
      }
      for (const a of auditReassigned) {
        try {
          await logAudit(prisma, {
            entityType: "sim",
            entityId: a.simId,
            action: AuditAction.INSERVE_SIM_REASSIGNED,
            userId: auditUserId ?? undefined,
            oldValues: a.before,
            newValues: a.after,
            metadata: {
              beforeCustomerId: a.beforeCustomerId || null,
              afterCustomerId: a.afterCustomerId,
              assetId: String(a.assetId),
              iccidMasked: maskIccid(a.iccid),
              source: "inserve_sim_link",
            },
          });
        } catch {
          /* ignore */
        }
      }
      for (const a of auditConflicts) {
        try {
          await logAudit(prisma, {
            entityType: "sim",
            entityId: a.simId,
            action: AuditAction.INSERVE_SIM_LINK_CONFLICT,
            userId: auditUserId ?? undefined,
            oldValues: { iccidMasked: maskIccid(a.iccid), assetId: String(a.assetId) },
            newValues: { reason: a.reason },
            metadata: {
              assetId: String(a.assetId),
              iccidMasked: maskIccid(a.iccid),
              source: "inserve_sim_link",
            },
          });
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e: any) {
    summary.errors++;
    summary.errorMessages.push(`Top-level error: ${e?.message ?? String(e)}`.slice(0, 400));
  }

  return summary;
}
