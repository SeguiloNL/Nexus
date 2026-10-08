import { InserveClient, InserveApiError } from "../src/server/integrations/inserve/client";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {}
}

tryLoadDotEnv();

async function main() {
  const subdomain = process.env.INSERVE_SUBDOMAIN;
  const apiKey = process.env.INSERVE_API_KEY;

  if (!subdomain || !apiKey) {
    console.log(RED + "✗ Kan niet verbinden met Inserve:" + RESET);
    console.log("  Environment variabelen ontbreken:");
    if (!subdomain) console.log(YELLOW + "    - INSERVE_SUBDOMAIN (ontbreekt)" + RESET);
    if (!apiKey) console.log(YELLOW + "    - INSERVE_API_KEY (ontbreekt)" + RESET);
    console.log("\n  Zet deze in .env bestand of exporteer ze:");
    console.log('    export INSERVE_SUBDOMAIN="jouw-subdomain"');
    console.log('    export INSERVE_API_KEY="jouw-api-key"');
    console.log('\n  Of kopieer .env.example naar .env en vul de waarden in.');
    process.exit(1);
  }

  let client: InserveClient;
  try {
    client = new InserveClient(subdomain, apiKey);
  } catch (e: any) {
    console.log(RED + "✗ Kan InserveClient niet initialiseren:" + RESET);
    console.log("  ", e?.message ?? String(e));
    process.exit(1);
  }

  try {
    console.log(YELLOW + "ℹ  Testen van Inserve API verbinding..." + RESET);
    console.log(YELLOW + `   Subdomain: ${subdomain}` + RESET);
    console.log(YELLOW + `   API Key:   ${apiKey.slice(0, 4)}****${apiKey.slice(-4)}` + RESET + "\n");

    const me = await client.request<any>("auth/me", { method: "GET" });

    console.log(GREEN + "✓ Verbonden met Inserve!" + RESET);
    if (me) {
      if (me.id !== undefined) console.log(`   User ID:  ${me.id}`);
      if (me.email) console.log(`   Email:    ${me.email}`);
      if (me.name) console.log(`   Naam:     ${me.name}`);
      if (me.first_name || me.last_name) {
        const full = [me.first_name, me.last_name].filter(Boolean).join(" ");
        if (full && !me.name) console.log(`   Naam:     ${full}`);
      }
    }

    try {
      const companies = await client.request<any>("companies", {
        method: "GET",
        query: { limit: "1" } as any,
      });
      const list = (companies as any)?.data ?? (Array.isArray(companies) ? companies : []);
      console.log("\n" + GREEN + "✓ Company sanity check OK" + RESET);
      console.log(
        `   Companies: ${
          (companies as any)?.meta?.total ?? (Array.isArray(list) ? `${list.length} (first page)` : "onbekend")
        }`
      );
      if (Array.isArray(list) && list[0]) {
        console.log(`   Eerste:   ${list[0].name ?? list[0].id ?? "(geen naam)"}`);
      }
    } catch (sanityErr: any) {
      console.log(YELLOW + "⚠  Company listing mislukt (optioneel):" + RESET);
      console.log("   ", sanityErr?.message ?? String(sanityErr));
    }

    try {
      console.log("\n" + YELLOW + "ℹ  Inspectie: custom fields van eerste bedrijf..." + RESET);
      const firstPage = await client.request<any>("companies", {
        method: "GET",
        builder: [
          { with: ["custom_fields", "company_fields", "extra_fields", "fields"] },
          { paginate: { page: 1, per_page: 1 } },
        ],
      });
      const list2 = (firstPage as any)?.data ?? [];
      if (!Array.isArray(list2) || list2.length === 0) {
        console.log(YELLOW + "   Geen bedrijven gevonden; inspection overgeslagen." + RESET);
      } else {
        const c = list2[0];
        console.log(`   Bedrijf ID: ${c.id ?? "?"}`);
        console.log(`   Naam:      ${c.name ?? "?"}`);
        const keys = Object.keys(c);
        const fieldCandidates = ["custom_fields", "company_fields", "extra_fields", "fields"];
        let foundAny: any = null;
        for (const k of fieldCandidates) {
          if (k in c && Array.isArray((c as any)[k])) {
            console.log(GREEN + `   ✓ ${k}: ${(c as any)[k].length} entries` + RESET);
            foundAny = (c as any)[k];
            for (const f of (c as any)[k]) {
              const id = f.id ?? f.field_id ?? "?";
              const name = f.name ?? f.slug ?? f.title ?? f.key ?? "(geen naam)";
              const val = f.value ?? (f.option && (f.option.label ?? f.option.value ?? f.option.id));
              const type = f.type ?? "?";
              console.log(
                "     - [" +
                  id +
                  "] " +
                  name +
                  " (type=" +
                  type +
                  ") => " +
                  JSON.stringify(val ?? null)
              );
            }
          }
        }
        if (!foundAny) {
          console.log(YELLOW + "   Geen vrije-veld relatie direct opgenomen in company. Probeer aparte endpoints:" + RESET);
          const sep = ["custom_fields", "company_fields", "extra_fields", "fields"];
          for (const suffix of ["custom_fields", "fields", "company_fields"]) {
            try {
              const r = await client.request<any>(`companies/${c.id}/${suffix}`, { method: "GET" });
              const arr = Array.isArray(r) ? r : (r?.data ?? null);
              if (Array.isArray(arr) && arr.length > 0) {
                console.log(GREEN + `   ✓ /companies/${c.id}/${suffix}: ${arr.length} velden` + RESET);
                for (const f of arr.slice(0, 5)) {
                  const id = f.id ?? f.field_id ?? "?";
                  const name = f.name ?? f.slug ?? f.title ?? f.key ?? "(geen naam)";
                  const val = f.value ?? (f.option && (f.option.label ?? f.option.value ?? f.option.id));
                  console.log(
                    "     - [" + id + "] " + name + " => " + JSON.stringify(val ?? null)
                  );
                }
                break;
              }
            } catch (e: any) {
              console.log("   /" + suffix + ": " + (e?.message ?? String(e)));
            }
          }
        }
      }
    } catch (inspectErr: any) {
      console.log(YELLOW + "⚠  Inspection mislukt (optioneel):" + RESET + " " + (inspectErr?.message ?? String(inspectErr)));
    }

    process.exit(0);
  } catch (err: any) {
    console.log(RED + "✗ Kan niet verbinden met Inserve:" + RESET);
    if (err instanceof InserveApiError) {
      console.log(`   Status:    ${err.statusCode}`);
      const body = err.responseBody;
      if (body && typeof body === "object") {
        const msg = (body as any).message || (body as any).error;
        if (msg) console.log(`   Boodschap: ${msg}`);
        console.log(`   URL:       ${err.url}`);
      } else if (typeof body === "string") {
        console.log(`   Response:  ${body.slice(0, 200)}`);
      }
    } else if (err instanceof Error) {
      console.log(`   Fout:      ${err.message}`);
      if (err.cause) console.log(`   Oorzaak:   ${String(err.cause)}`);
    } else {
      console.log("   ", String(err));
    }
    console.log("\n  Controleer:");
    console.log("   1. Zijn INSERVE_SUBDOMAIN en INSERVE_API_KEY juist gezet?");
    console.log("   2. Is de API key geldig en niet verlopen?");
    console.log("   3. Heeft de subdomain de API enabled?");
    console.log("   4. Is er netwerk toegang tot *.inserve.nl?");
    process.exit(1);
  }
}

main();
