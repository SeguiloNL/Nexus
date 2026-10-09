import { InserveClient, InserveApiError } from "../src/server/integrations/inserve/client.ts";
import { readFileSync, existsSync } from "node:fs";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";

function tryLoadDotEnv() {
  const envPath = new URL("../.env", import.meta.url);
  if (!existsSync(envPath)) return;
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {}
}

tryLoadDotEnv();

function maskValue(v: any): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return typeof v;
  if (v.length <= 4) return v.replace(/./g, "*");
  return v.slice(0, 1) + "*".repeat(Math.max(1, v.length - 2)) + v.slice(-1);
}

function logShape(
  label: string,
  obj: any,
  depth: number = 0,
  seen: WeakMap<object, boolean> = new WeakMap()
) {
  const pad = "  ".repeat(depth);
  if (obj === null || obj === undefined) {
    console.log(`${pad}${CYAN}${label}${RESET}: ${obj === null ? "null" : "undefined"}`);
    return;
  }
  if (Array.isArray(obj)) {
    console.log(`${pad}${CYAN}${label}${RESET}: Array[${obj.length}]`);
    if (obj.length > 0) {
      const sample = obj[0];
      if (typeof sample === "object" && sample !== null) {
        if (seen.has(sample)) {
          console.log(`${pad}  (recursief, overslaan)`);
        } else {
          seen.set(sample, true);
          logShape("  [0] (sample)", sample, depth + 1, seen);
        }
      } else {
        console.log(`${pad}  [0] (sample scalar): ${typeof sample} = ${maskValue(sample)}`);
      }
    }
    return;
  }
  if (typeof obj !== "object") {
    console.log(`${pad}${CYAN}${label}${RESET}: ${typeof obj} = ${maskValue(obj)}`);
    return;
  }
  if (seen.has(obj)) {
    console.log(`${pad}${CYAN}${label}${RESET}: (reeds gezien, overslaan)`);
    return;
  }
  seen.set(obj, true);
  const keys = Object.keys(obj);
  console.log(`${pad}${CYAN}${label}${RESET}: Object{${keys.length}}`);
  for (const k of keys) {
    const v = (obj as any)[k];
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    if (t === "object" && v !== null && !Array.isArray(v)) {
      logShape(k, v, depth + 1, seen);
    } else if (t === "array") {
      logShape(k, v, depth + 1, seen);
    } else {
      console.log(
        `${pad}  ${GREEN}${k}${RESET}: ${t} = ${maskValue(v)}`
      );
    }
  }
}

async function main() {
  const subdomain = process.env.INSERVE_SUBDOMAIN;
  const apiKey = process.env.INSERVE_API_KEY;

  if (!subdomain || !apiKey) {
    console.log(RED + "✗ Environment variabelen ontbreken:" + RESET);
    if (!subdomain) console.log(YELLOW + "  - INSERVE_SUBDOMAIN (ontbreekt)" + RESET);
    if (!apiKey) console.log(YELLOW + "  - INSERVE_API_KEY (ontbreekt)" + RESET);
    process.exit(1);
  }

  const client = new InserveClient(subdomain, apiKey);

  console.log(YELLOW + `ℹ  Subdomain: ${subdomain}` + RESET);
  console.log(YELLOW + `   API Key:  ${apiKey.slice(0, 4)}****${apiKey.slice(-4)}` + RESET + "\n");

  try {
    console.log(
      YELLOW +
        "ℹ  Read-only inspectie van /clients (limit=3, page=1, with=company, custom_values)" +
        RESET +
        "\n"
    );

    const response = await client.request<any>("clients", {
      method: "GET",
      builder: [
        { with: ["company", "custom_values", "custom_fields"] },
        { limit: 3 },
        { page: 1 },
      ],
    });

    console.log(GREEN + "✓ Response ontvangen" + RESET);
    console.log(
      "  Type top-level: " +
        (Array.isArray(response) ? "array" : typeof response) +
        (typeof response === "object" && response !== null
          ? `, keys: [${Object.keys(response).join(", ")}]`
          : "") +
        "\n"
    );

    const list: any[] = Array.isArray(response)
      ? response
      : (response as any)?.data ?? ((response as any)?.clients as any[]) ?? [];
    const meta = (response as any)?.meta ?? null;

    console.log(CYAN + "── Meta ──" + RESET);
    if (meta) {
      console.log(JSON.stringify(meta, null, 2) + "\n");
    } else {
      console.log(YELLOW + "  (geen meta-veld)" + RESET + "\n");
    }

    if (!Array.isArray(list) || list.length === 0) {
      console.log(YELLOW + "⚠  Geen client-records teruggekregen." + RESET);
      console.log(
        "  Probeer alternatieve flat-builder params: builder[1][limit]=3, builder[2][page]=1\n"
      );
      try {
        const r2 = await client.request<any>("clients", {
          method: "GET",
          builderParamsStyle: true,
          builder: [{ limit: 3 }, { page: 1 }, { with: ["company"] }],
        } as any);
        const list2 = Array.isArray(r2) ? r2 : (r2 as any)?.data ?? [];
        console.log(
          GREEN + `  Alternatief: ${list2.length} records` + RESET + (list2.length ? ", shape volgt:\n" : "\n")
        );
        if (list2.length) logShape("  [0] (alternatief)", list2[0], 1);
      } catch (e2: any) {
        console.log(RED + "  Alternatieve call faalde: " + (e2?.message ?? String(e2)) + RESET);
      }
      process.exit(list.length ? 0 : 1);
    }

    console.log(CYAN + `── Shape van eerste ${Math.min(3, list.length)} client(s) (WAARDEN GEMASKEERD) ──` + RESET + "\n");
    for (let i = 0; i < Math.min(3, list.length); i++) {
      logShape(`Client #${i + 1} (id=${(list[i] as any).id ?? "?"})`, list[i]);
      console.log("");
    }

    const c0 = list[0] ?? {};
    const keys0 = Object.keys(c0).map((k) => k.toLowerCase());

    console.log(CYAN + "── Detectie van relevante velden ──" + RESET);
    const detect = (needles: string[]): string | null => {
      for (const n of needles) {
        const found = Object.keys(c0).find((k) => k.toLowerCase() === n.toLowerCase());
        if (found) return found;
      }
      return null;
    };
    const detectNested = (path: string[]): boolean => {
      let cur: any = c0;
      for (const p of path) {
        if (!cur || typeof cur !== "object") return false;
        const k = Object.keys(cur).find((kk) => kk.toLowerCase() === p.toLowerCase());
        if (!k) return false;
        cur = cur[k];
      }
      return true;
    };

    const checks = [
      ["id (PK)", ["id"]],
      ["company_id (FK)", ["company_id", "companyId"]],
      ["first_name", ["first_name", "firstName", "voornaam", "given_name"]],
      ["last_name", ["last_name", "lastName", "achternaam", "family_name", "surname"]],
      ["email", ["email", "e-mail", "email_address"]],
      ["telefoon vast", ["telephone", "phone", "telephone_work", "landline"]],
      ["telefoon mobiel", ["telephone_cell", "mobile", "cellphone", "mobile_phone", "gsm", "telephone_mobile"]],
      ["functie", ["function", "title", "job_title", "functionTitle", "role", "position"]],
    ] as const;
    for (const [label, variants] of checks) {
      const k = detect(variants as any);
      console.log(
        `  ${label.padEnd(22, " ")}: ` +
          (k ? GREEN + `JA (key="${k}")` + RESET : YELLOW + `NEE (niet direct in top-level)` + RESET)
      );
    }
    console.log(
      `  company (nested object) : ` +
        (detectNested(["company"]) ? GREEN + `JA` + RESET : YELLOW + `NEE` + RESET)
    );
    console.log(
      `  companies (array)       : ` +
        (Array.isArray((c0 as any).companies)
          ? GREEN + `JA (lengte=${(c0 as any).companies.length}) → M:N relatie!` + RESET
          : YELLOW + `NEE (waarschijnlijk N:1 via company_id)` + RESET)
    );
    console.log(
      `  custom_values (array)   : ` +
        (Array.isArray((c0 as any).custom_values)
          ? GREEN + `JA (lengte=${(c0 as any).custom_values.length})` + RESET
          : YELLOW + `NEE` + RESET)
    );
    console.log(
      `  roles (array)           : ` +
        (Array.isArray((c0 as any).roles)
          ? GREEN + `JA (lengte=${(c0 as any).roles.length})` + RESET
          : YELLOW + `NEE` + RESET)
    );

    console.log("\n" + CYAN + "── Detectie custom_values/velden op client #1 ──" + RESET);
    const cv = (c0 as any).custom_values ?? (c0 as any).customFields ?? null;
    if (Array.isArray(cv)) {
      console.log(`  Aantal custom_values: ${cv.length}`);
      for (const v of cv.slice(0, 10)) {
        const id = v.id ?? v.field_id ?? "?";
        const name =
          (v.custom_field_object &&
            (v.custom_field_object.name ?? v.custom_field_object.title ?? v.custom_field_object.slug)) ??
          v.name ??
          v.title ??
          v.key ??
          "?";
        const value =
          v.value ?? (v.option ? v.option.label ?? v.option.name ?? v.option.value ?? v.option.id : null);
        console.log(
          `    [${id}] ${GREEN}${name}${RESET}: ` +
            (typeof value === "object" && value !== null ? JSON.stringify(value) : maskValue(value))
        );
      }
    } else {
      console.log(YELLOW + "  Geen custom_values-array op client top-level." + RESET);
    }

    console.log(
      "\n" +
        GREEN +
        "Kopieer bovenstaand overzicht (keys!) naar inserve/types.ts commentaar. Neem GEEN WAARDEN over." +
        RESET
    );
    process.exit(0);
  } catch (err: any) {
    console.log(RED + "✗ Call naar /clients mislukt:" + RESET);
    if (err instanceof InserveApiError) {
      console.log(`  Status:    ${err.statusCode}`);
      console.log(`  URL:       ${err.url}`);
      const body = err.responseBody;
      if (body && typeof body === "object") {
        const msg = (body as any).message ?? (body as any).error;
        if (msg) console.log(`  Boodschap: ${msg}`);
        console.log(
          `  Body preview: ${JSON.stringify(body, null, 2).slice(0, 2000)}`
        );
      } else if (typeof body === "string") {
        console.log(`  Response:  ${body.slice(0, 2000)}`);
      }
    } else if (err instanceof Error) {
      console.log(`  Fout:  ${err.message}`);
      if (err.cause) console.log(`  Cause: ${String(err.cause)}`);
    } else {
      console.log(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
