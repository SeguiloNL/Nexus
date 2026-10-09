import 'dotenv/config';
import { InserveClient, getInserveCredentials } from '../src/server/integrations/inserve/client';
import { createPrismaFromEnv } from '../src/lib/prismas';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}
function mask(obj: any, keysToMask = ['apikey','key','token','secret','password','email','phone','street','address','kvk','btw','iban']): any {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(x => mask(x, keysToMask));
  if (typeof obj !== 'object') return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (keysToMask.some(m => lk.includes(m))) { out[k] = '***'; continue; }
    if (v && typeof v === 'object') out[k] = mask(v, keysToMask);
    else if (typeof v === 'string' && v.length > 80) out[k] = v.slice(0,80)+'…';
    else out[k] = v;
  }
  return out;
}
function logShape(label: string, data: any, depth = 3) {
  console.log(`\n=== ${label} ===`);
  if (Array.isArray(data)) {
    console.log(`  Array.length=${data.length}`);
    if (data.length > 0) logShape('first item', data[0], depth-1);
  } else if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    console.log(`  Object keys(${keys.length}): [${keys.join(', ')}]`);
    if (depth > 0) {
      for (const k of keys.slice(0, 25)) {
        const v = data[k];
        if (v == null) { console.log(`  - ${k}: ${String(v)}`); continue; }
        if (Array.isArray(v)) { console.log(`  - ${k}: Array(${v.length})`); if (v.length && depth>1) logShape(`    ${k}[0]`, v[0], depth-2); }
        else if (typeof v === 'object') { console.log(`  - ${k}: Object keys=${Object.keys(v).slice(0,12).join(',')}${Object.keys(v).length>12?'…':''}`); if (depth>1) logShape(`    ${k}`, v, depth-2); }
        else { const s = String(v); console.log(`  - ${k}: ${s.length>120?s.slice(0,120)+'…':s}`); }
      }
    }
  } else {
    console.log('  Scalar:', String(data).slice(0,200));
  }
}

async function tryEndpoint(client: InserveClient, path: string, params?: Record<string, any>): Promise<{ok:boolean; status:number; body?:any; error?:string}> {
  try {
    const body = await client.request<any>(path, { method: 'GET', queryParams: params, timeoutMs: 8000, extraRetries: 0 });
    return { ok: true, status: 200, body };
  } catch (e: any) {
    return { ok: false, status: safe(() => e.status ?? e.response?.status ?? 0, 0), error: safe(() => e.message ?? String(e), 'unknown') };
  }
}

async function main() {
  const prisma = createPrismaFromEnv();
  const creds = await getInserveCredentials(prisma as any).catch(() => null);
  if (!creds) {
    console.log('Geen Inserve credentials gevonden in AppSetting of ENV. Abort discovery.');
    console.log('Configureer INSERVE_SUBDOMAIN + INSERVE_API_KEY in .env, of via admin Instellingen.');
    process.exit(1);
  }
  const client = new InserveClient(creds);
  console.log('Inserve client geinitialiseerd. Subdomain:', creds.subdomain);

  const candidates = [
    '/api/assets',
    '/api/asset',
    '/api/assets-kaarten',
    '/api/asset-cards',
    '/api/assetcards',
    '/api/productassets',
    '/api/product-assets',
    '/api/articles',
    '/api/simcards',
    '/api/sim-cards',
    '/api/asset-categories',
    '/api/assetcategories',
    '/api/assetcategories',
  ];
  const pageParams = [
    undefined,
    { page: 1, per_page: 1 },
    { 'builder[1][limit]': 1, 'builder[2][page]': 1 },
    { 'builder[1][with]': 'customValues,company', 'builder[2][limit]': 1, 'builder[3][page]': 1 },
    { limit: 1, page: 1 },
  ];

  const discoveries: Array<{endpoint:string; params:any; ok:boolean; status:number; error?:string; hasDataArray?:boolean; dataLen?:number; sampleKeys?:string[]}> = [];

  for (const path of candidates) {
    for (let i = 0; i < pageParams.length; i++) {
      const params = pageParams[i];
      const r = await tryEndpoint(client, path, params);
      const entry: any = { endpoint: path, paramsVariant: i, ok: r.ok, status: r.status, error: r.error };
      if (r.ok && r.body) {
        const body = r.body;
        const topKeys = Object.keys(body);
        entry.topKeys = topKeys;
        if (Array.isArray(body)) { entry.hasDataArray = true; entry.dataLen = body.length; if (body[0]) entry.sampleKeys = Object.keys(body[0]).slice(0,20); }
        else if (Array.isArray(body.data)) { entry.hasDataArray = true; entry.dataLen = body.data.length; if (body.data[0]) entry.sampleKeys = Object.keys(body.data[0]).slice(0,20); }
        else if (Array.isArray(body.items)) { entry.hasDataArray = true; entry.dataLen = body.items.length; if (body.items[0]) entry.sampleKeys = Object.keys(body.items[0]).slice(0,20); }
      }
      discoveries.push(entry);
      if (r.ok && (entry.hasDataArray || entry.dataLen != null)) {
        console.log(`\n✓ HIT: ${path} variant=${i} status=${r.status}`);
        logShape('Response shape', mask(r.body), 3);
        break;
      }
      if (r.ok) break;
      if (r.status && r.status !== 404 && r.status !== 401 && r.status !== 403) break;
    }
  }
  console.log('\n=== Samenvatting endpoints ===');
  console.table(discoveries.map(d => ({
    endpoint: d.endpoint,
    variant: (d as any).paramsVariant,
    ok: d.ok,
    status: d.status,
    hasData: !!d.hasDataArray,
    len: d.dataLen ?? '-',
    sample: (d.sampleKeys ?? []).slice(0,6).join(',')
  })));
  console.log('\nVolgende stappen:');
  console.log('  - Plak hierboven de geanonimiseerde response voor een SIMKAART-asset (1 record).');
  console.log('  - Bevestig categorie-veld, bedrijfskoppeling-veld, ICCID-veld.');
  console.log('\nDone.');
  process.exit(0);
}

main().catch(e => { console.error('Discovery failed:', e); process.exit(1); });
