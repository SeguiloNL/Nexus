import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import {
  getInserveSettings,
  getSimhuisSettings,
  getNavixySettings,
} from "@/server/services/app-setting.service";

let cachedPkgVersion: string | null = null;
function getPackageVersion(): string {
  if (cachedPkgVersion !== null) return cachedPkgVersion as string;
  try {
    const pkgRaw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    const parsed = JSON.parse(pkgRaw);
    cachedPkgVersion =
      typeof parsed?.version === "string" ? parsed.version : "0.0.0";
  } catch {
    cachedPkgVersion = "0.0.0";
  }
  return cachedPkgVersion ?? "0.0.0";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type IntegrationStatus = "configured" | "missing" | "error";

interface HealthResponse {
  ok: boolean;
  timestamp: string;
  uptimeMs: number;
  version: string;
  services: {
    db: "ok" | "error";
    dbError?: string;
  };
  integrations: {
    inserve: IntegrationStatus;
    simhuis: IntegrationStatus;
    navixy: IntegrationStatus;
    sources: {
      inserve?: "db" | "env" | "none";
      simhuis?: "db" | "env" | "none";
      navixy?: "db" | "env" | "none";
    };
  };
}

const STARTUP_TS_MS = Date.now();

export async function GET() {
  const startedAt = process.hrtime.bigint();

  const response: HealthResponse = {
    ok: false,
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - STARTUP_TS_MS,
    version: getPackageVersion(),
    services: { db: "error" },
    integrations: {
      inserve: "missing",
      simhuis: "missing",
      navixy: "missing",
      sources: {},
    },
  };

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    response.services.db = "ok";
  } catch (e: any) {
    response.services.db = "error";
    response.services.dbError = e?.message ?? "database error";
  }

  try {
    const s = await getInserveSettings();
    if (s) {
      response.integrations.inserve = "configured";
      response.integrations.sources.inserve = (s as any).source ?? "db";
    }
  } catch {
    response.integrations.inserve = "error";
  }

  try {
    const s = await getSimhuisSettings();
    if (s) {
      response.integrations.simhuis = "configured";
      response.integrations.sources.simhuis = (s as any).source ?? "db";
    }
  } catch {
    response.integrations.simhuis = "error";
  }

  try {
    const s = await getNavixySettings();
    if (s) {
      response.integrations.navixy = "configured";
      response.integrations.sources.navixy = (s as any).source ?? "db";
    }
  } catch {
    response.integrations.navixy = "error";
  }

  response.ok =
    response.services.db === "ok" &&
    response.integrations.inserve !== "error" &&
    response.integrations.simhuis !== "error" &&
    response.integrations.navixy !== "error";

  const status =
    response.ok && response.services.db === "ok" ? 200 : 503;

  const endNs = process.hrtime.bigint() - startedAt;
  const responseWithLatency = {
    ...response,
    responseTimeMs: Math.round(Number(endNs / 1000000n)),
  } as HealthResponse & { responseTimeMs: number };

  return NextResponse.json(responseWithLatency, {
    status,
    headers: {
      "Cache-Control":
        "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
