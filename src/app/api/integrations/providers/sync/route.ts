import { NextResponse } from "next/server";
import { canUserRole, getCurrentUserOrNull } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac";
import {
  initializeProviderRegistry,
  providerRegistry,
} from "@/server/providers/registry";
import {
  syncAvailableSimsFromSimhuis,
  syncActiveSimsUsageFromSimhuis,
} from "@/server/services/simhuis-sim-sync.service";
import type { SimProviderCapability } from "@/server/providers/capabilities";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SyncJobName = "sims" | "usage" | "usage_alerts";
const VALID_JOBS: SyncJobName[] = ["sims", "usage", "usage_alerts"];

function capabilityFor(job: SyncJobName): SimProviderCapability {
  switch (job) {
    case "sims":
      return "listSims";
    case "usage":
      return "syncUsage";
    case "usage_alerts":
      return "syncUsage";
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const providerKey = url.searchParams.get("providerKey") ?? "simhuis";
  const job = (url.searchParams.get("job") ?? "sims") as SyncJobName;
  const force = url.searchParams.get("force") === "1";

  if (!VALID_JOBS.includes(job)) {
    return NextResponse.json(
      { ok: false, error: `Ongeldige job. Kies uit: ${VALID_JOBS.join(", ")}.` },
      { status: 400 }
    );
  }

  // Authorisatie: sessie-gebruiker (sim.edit of setting.edit)
  const user = await getCurrentUserOrNull();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Niet geauthenticeerd." },
      { status: 401 }
    );
  }
  try {
    requirePermission(user.role, "edit", "sim");
  } catch {
    try {
      requirePermission(user.role, "edit", "setting");
    } catch {
      if (!canUserRole(user.permissions, "edit", "sim")) {
        return NextResponse.json(
          { ok: false, error: "Onvoldoende rechten: sim.edit of setting.edit vereist." },
          { status: 403 }
        );
      }
    }
  }

  await initializeProviderRegistry();
  const adapter = await providerRegistry.require(providerKey);

  if (!(await providerRegistry.isConfigured(providerKey))) {
    return NextResponse.json(
      {
        ok: false,
        error: `Provider “${providerKey}” is niet geconfigureerd.`,
      },
      { status: 412 }
    );
  }
  try {
    await providerRegistry.guardActivated(providerKey);
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.safeMessage ?? `Provider “${providerKey}” is niet actief.`,
      },
      { status: 423 }
    );
  }
  const cap = capabilityFor(job);
  if (!adapter.capabilities[cap]) {
    return NextResponse.json(
      {
        ok: false,
        error: `Job “${job}” is niet ondersteund door provider “${providerKey}” (capability ${cap} ontbreekt).`,
      },
      { status: 501 }
    );
  }

  // --- Uitvoering --------------------------------------------------------------
  //
  // Aangezien SyncJobId enum NIET wordt uitgebreid (architectuurkeuze, zie
  // plan), lopen nieuwe providers hier niet via sync-schedule service.
  // Bestaande Simhuis-jobs blijven via hun eigen routes lopen.
  //
  // Voor providerKey === "simhuis" routeren we door naar de bestaande
  // sync-functies (compatibiliteit). Overige providers doen hun best-effort
  // via adapter methods; tot slot is dit extensie-mechanisme primair
  // bedoeld voor toekomstige providers.

  try {
    if (adapter.providerKey === "simhuis") {
      if (job === "sims") {
        const r = await syncAvailableSimsFromSimhuis({
          userId: user.id,
          userRole: user.role,
          ...(force ? { forceAll: true as const } : {}),
        } as any);
        return NextResponse.json({ ok: true, job, providerKey, result: r });
      }
      if (job === "usage") {
        const r = await syncActiveSimsUsageFromSimhuis({
          userId: user.id,
          userRole: user.role,
        });
        return NextResponse.json({ ok: true, job, providerKey, result: r });
      }
      // usage_alerts voor simhuis loopt via de dedicated route
      // /api/integrations/simhuis/notify-usage-alerts (met SyncJob scheduling).
      // Voor andere providers valt usage_alerts door naar de generieke no-op.
    }

    // Algemene provider-route: voor toekomstige providers.
    // Momenteel is dit een lichtgewicht no-op die alleen de capability
    // check uitvoert; de concrete methodes worden per adapter verder
    // verfijnd wanneer de scheduler ook generiek wordt gemaakt.
    return NextResponse.json(
      {
        ok: true,
        job,
        providerKey,
        info: "Generieke sync route — autorisatie en capability-check geslaagd. Implementatie per adapter volgt in een volgende stap als de scheduler eveneens generiek wordt.",
      },
      { status: 200 }
    );
  } catch (e: any) {
    const safeMsg =
      e?.safeMessage && typeof e.safeMessage === "string"
        ? e.safeMessage
        : "Onverwachte fout tijdens sync-job.";
    return NextResponse.json(
      { ok: false, error: safeMsg, job, providerKey },
      { status: 500 }
    );
  }
}
