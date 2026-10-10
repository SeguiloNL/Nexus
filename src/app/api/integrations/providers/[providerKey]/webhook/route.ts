import { NextRequest, NextResponse } from "next/server";
import {
  initializeProviderRegistry,
  providerRegistry,
} from "@/server/providers/registry";
import { ProviderCapabilityNotSupportedError } from "@/server/providers/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// In-memory LRU-dedup (geen Redis, architectuurkeuze).
// Key = `${providerKey}:${eventId}`; value = expiry epoch ms.
// Wordt enkel gebruikt als supportsIdempotency === false.
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 min
const dedupStore = new Map<string, number>();
const DEDUP_MAX_ENTRIES = 2000;

function cleanExpiredDedup(now: number): void {
  if (dedupStore.size < DEDUP_MAX_ENTRIES) return;
  for (const [k, expiry] of dedupStore.entries()) {
    if (expiry < now) dedupStore.delete(k);
    if (dedupStore.size < DEDUP_MAX_ENTRIES * 0.8) break;
  }
}

function rememberEvent(providerKey: string, eventId: string | undefined): boolean {
  if (!eventId) return false;
  const now = Date.now();
  cleanExpiredDedup(now);
  const k = `${providerKey}:${eventId}`;
  const existing = dedupStore.get(k);
  if (existing && existing > now) {
    return true; // duplicate → verwerken overslaan
  }
  dedupStore.set(k, now + DEDUP_TTL_MS);
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ providerKey: string }> } | { params: { providerKey: string } }
) {
  const p = await Promise.resolve(params as any);
  const providerKey = p.providerKey as string;

  try {
    await initializeProviderRegistry();
    const adapter = await providerRegistry.require(providerKey);

    if (!adapter.capabilities.supportsWebhooks) {
      const e = new ProviderCapabilityNotSupportedError(
        providerKey,
        "supportsWebhooks"
      );
      return NextResponse.json(
        { ok: false, error: e.safeMessage },
        { status: 501 }
      );
    }

    // Activeringsstatus
    const activated = await providerRegistry.isActivated(providerKey);
    if (!activated) {
      const headers = new Headers();
      headers.set("X-Sim-Provider-Disabled", "1");
      return NextResponse.json(
        {
          ok: false,
          error: `Provider “${providerKey}” is niet actief. Webhooks worden momenteel niet verwerkt.`,
        },
        { status: 403, headers }
      );
    }

    if (!(await providerRegistry.isConfigured(providerKey))) {
      return NextResponse.json(
        { ok: false, error: "Provider is niet geconfigureerd." },
        { status: 412 }
      );
    }

    // Lees body raw (signature checks vereisen de ongewijzigde payload).
    const rawBody = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    // Idempotency-dedup enkel wanneer ondersteuning NIET in de provider
    // zelf zit (aanname: dan wordt event-validatie door adapter gedaan).
    if (!adapter.capabilities.supportsIdempotency) {
      const maybeEventId =
        headers["x-webhook-id"] ??
        headers["x-event-id"] ??
        headers["webhook-id"] ??
        (() => {
          try {
            const json = JSON.parse(rawBody);
            return json?.id ?? json?.eventId ?? json?.event_id ?? undefined;
          } catch {
            return undefined;
          }
        })();
      const isDup = rememberEvent(providerKey, maybeEventId);
      if (isDup) {
        return NextResponse.json(
          { ok: true, duplicate: true, info: "Event reeds verwerkt." },
          { status: 202 }
        );
      }
    }

    const result = await adapter.handleWebhook?.({
      rawBody,
      headers,
      timestamp: new Date(),
    });

    if (!result || !result?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            (result as any)?.safeMessage ??
            "Webhook kon niet worden gevalideerd of verwerkt.",
        },
        { status: (result as any)?.httpStatus ?? 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        action: (result as any)?.action ?? "processed",
        sims: (result as any)?.simsAffected ?? 0,
      },
      { status: 200 }
    );
  } catch (e: any) {
    const safeMsg =
      e?.safeMessage && typeof e.safeMessage === "string"
        ? e.safeMessage
        : "Onverwachte fout bij webhook-verwerking.";
    return NextResponse.json(
      { ok: false, error: safeMsg },
      { status: e?.httpStatus ?? 500 }
    );
  }
}
