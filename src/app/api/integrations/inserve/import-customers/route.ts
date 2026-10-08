import { NextResponse } from "next/server";
import {
  bearerTokenFromHeader,
  getCurrentUserOrNull,
  tokensEqual,
} from "@/lib/auth/session";
import { pickAuth, requirePermission } from "@/lib/rbac";
import {
  runInserveCustomerImport,
  type ImportSummary,
} from "@/server/services/inserve-customer-import.service";
import { SyncJobTrigger, RoleScope } from "@/types/enums";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQ_TOKEN_VAR = "SIMHUIS_SYNC_API_TOKEN";

function determineTriggeredBy(
  req: Request,
  via: "session" | "api_token"
): SyncJobTrigger {
  if (via === "session") return SyncJobTrigger.MANUAL_ADMIN;
  const hdr = (req.headers.get("x-sync-triggered-by") ?? "").toLowerCase();
  if (hdr === "systemd-timer") return SyncJobTrigger.SYSTEMD_TIMER;
  return SyncJobTrigger.API_TOKEN;
}

export async function POST(req: Request) {
  try {
    const authHeader =
      req.headers.get("authorization") ?? req.headers.get("Authorization");
    const envToken = (process.env[REQ_TOKEN_VAR] ?? "").trim();
    const bearer = bearerTokenFromHeader(authHeader);

    let principal: {
      userId?: string;
      userRole?: unknown | null;
      roleId?: string | null;
      roleScope?: RoleScope | null;
      permissions?: unknown | null;
      customerIds?: string[] | null;
      via: "session" | "api_token";
    } | null = null;

    if (bearer && envToken && tokensEqual(bearer, envToken)) {
      principal = {
        via: "api_token",
        userId: "inserve_customer_import_job",
        userRole: "ADMIN",
        roleScope: RoleScope.INTERNAL,
      };
    }

    if (!principal) {
      const user = await getCurrentUserOrNull();
      if (user) {
        try {
          await requirePermission(
            pickAuth(user as any),
            "import_from_inserve",
            "customer"
          );
        } catch {
          principal = null;
        }
        const scope = (user as any).roleScope;
        if (principal && scope !== "INTERNAL" && scope) {
          principal = null;
        }
        if (principal) {
          principal = {
            userId: user.id,
            userRole: (user as any).role,
            roleId: (user as any).roleId,
            roleScope: scope,
            permissions: (user as any).permissions,
            customerIds: (user as any).customerIds,
            via: "session",
          };
        }
      }
    }

    if (!principal) {
      return NextResponse.json(
        {
          ok: false,
          error: bearer
            ? "Ongeldige Bearer-token (SIMHUIS_SYNC_API_TOKEN komt niet overeen)."
            : "Niet geautoriseerd: log in met de permissie 'import_from_inserve' (INTERNAL scope) of stuur een geldige Bearer-token (SIMHUIS_SYNC_API_TOKEN) mee.",
        },
        { status: 403 }
      );
    }

    const triggeredBy = determineTriggeredBy(req, principal.via);
    const summary: ImportSummary = await runInserveCustomerImport({
      userId: principal.userId!,
      userRole: principal.userRole ?? null,
      roleId: principal.roleId ?? null,
      roleScope: (principal.roleScope as RoleScope) ?? null,
      permissions: (principal.permissions as any) ?? null,
      customerIds: (principal.customerIds as any) ?? null,
      triggeredBy,
    } as any);

    const ok = summary.status !== "FAILED" && summary.status !== "SKIPPED";
    return NextResponse.json({
      ok,
      summary,
      authenticatedVia: principal.via,
      triggeredBy,
    });
  } catch (e: any) {
    console.error("[api/inserve-customer-import] POST failed:", e);
    return NextResponse.json(
      {
        ok: false,
        error:
          e?.message ??
          "Onverwachte fout tijdens klantimport uit Inserve.",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Alleen POST toegestaan. Authenticeer via sessie (import_from_inserve recht, INTERNAL scope) of via Bearer token (SIMHUIS_SYNC_API_TOKEN).",
    },
    { status: 405 }
  );
}
