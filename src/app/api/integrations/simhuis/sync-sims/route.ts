import { NextResponse } from "next/server";
import { getCurrentUser, canUserRole } from "@/lib/auth/session";
import {
  syncAvailableSimsFromSimhuis,
  type SimhuisSyncResult,
} from "@/server/services/simhuis-sim-sync.service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQ_TOKEN_VAR = "SIMHUIS_SYNC_API_TOKEN";

function bearerTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token;
  if (scheme?.toLowerCase() === "basic" && token) return token;
  return null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const envToken = (process.env[REQ_TOKEN_VAR] ?? "").trim();
    const bearer = bearerTokenFromHeader(authHeader);

    let principal: { userId?: string; userRole?: any; via: "session" | "api_token" } | null = null;

    const user = await getCurrentUser();
    if (user && canUserRole(user.role, "edit", "sim")) {
      principal = { userId: user.id, userRole: user.role, via: "session" };
    } else if (envToken && bearer && bearer === envToken) {
      principal = { via: "api_token" };
    } else {
      const msg = "Onvoldoende rechten (sim/edit) of ongeldige API-token.";
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 403 }
      );
    }

    const result: SimhuisSyncResult = await syncAvailableSimsFromSimhuis({
      userId: principal.userId,
      userRole: principal.userRole,
    });

    const summary =
      `SIM-voorraad bijgewerkt. Aangemaakt: ${result.created}, bijgewerkt: ${result.updated}, overgeslagen: ${result.skipped}. ` +
      `Totaal in Simhuis: ${result.totalInSimhuis}, in aanmerking: ${result.eligibleInSimhuis}. Fouten: ${result.errors}. ` +
      `Duur: ${result.durationMs}ms.`;

    return NextResponse.json({
      ok: true,
      summary,
      authenticatedVia: principal.via,
      ...result,
    });
  } catch (e: any) {
    console.error("[api/simhuis-sync] POST failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Onverwachte fout tijdens synchronisatie.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Alleen POST toegestaan. Authenticeer via sessie (sim/edit recht) of via Bearer token (SIMHUIS_SYNC_API_TOKEN).",
    },
    { status: 405 }
  );
}
