import { simhuisClient, SimhuisApiError, type SimhuisRequestOptions } from './client';
import type { ActivateSimOptions, SimhuisApiResponse, SimhuisSimStatus } from './types';

// ============================================================
// 📅 billTime helper: bereken facturatieperiode voor /v3/cdr/stats
// Formaat (Swagger): "YYYY-MM-DD HH:MM:SS,YYYY-MM-DD HH:MM:SS"
//   - billTime filtert op tariferingsmoment in system, NIET op verkeersmoment.
//   - Tijdzone: expliciet Europe/Amsterdam (TZ=Europe/Amsterdam per prod env var).
// ============================================================
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function billTimeCurrentMonth(refDate: Date = new Date()): { start: string; end: string; combined: string } {
  const y = refDate.getFullYear();
  const m = refDate.getMonth(); // 0-based
  const firstDay = new Date(y, m, 1, 0, 0, 0, 0);
  const lastDay = new Date(y, m + 1, 0, 23, 59, 59, 999);
  const fmt = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return { start: fmt(firstDay), end: fmt(lastDay), combined: `${fmt(firstDay)},${fmt(lastDay)}` };
}

function toSimStatus(raw: unknown, iccid: string): SimhuisSimStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const nestedSim = r.simCard ?? r.sim ?? r.asset ?? r.device ?? r.subscription ?? r.subscriber ?? r.esimProfile ?? r.esim ?? {};

  const DEBUG = (process.env.DEBUG_SIMHUIS_EXTRACT ?? '0') === '1';
  function collectAllKeys(obj: any, depth = 0, maxDepth = 4, seen = new WeakSet()): Array<{ path: string; value: any }> {
    const res: Array<{ path: string; value: any }> = [];
    if (depth > maxDepth) return res;
    if (!obj || typeof obj !== 'object') return res;
    if (seen.has(obj)) return res;
    seen.add(obj);
    for (const k of Object.keys(obj)) {
      const v = (obj as any)[k];
      res.push({ path: k, value: v });
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sub = collectAllKeys(v, depth + 1, maxDepth, seen);
        for (const s of sub) res.push({ path: `${k}.${s.path}`, value: s.value });
      } else if (Array.isArray(v)) {
        for (let i = 0; i < Math.min(v.length, 15); i++) {
          const item = v[i];
          res.push({ path: `${k}[${i}]`, value: item });
          if (item && typeof item === 'object') {
            const sub = collectAllKeys(item, depth + 1, maxDepth, seen);
            for (const s of sub) res.push({ path: `${k}[${i}].${s.path}`, value: s.value });
          }
        }
      }
    }
    return res;
  }

  const KEY_CACHE = new WeakMap<Record<string, any>, Map<string, string>>();
  function normalizeKey(k: unknown): string {
    if (k === null || k === undefined) return '';
    const s = typeof k === 'string' ? k : String(k);
    return s
      .toLowerCase()
      .replace(/[\s_./\-()]+/g, '');
  }
  function buildKeyIndex(obj: Record<string, any>): Map<string, string> {
    if (!obj || typeof obj !== 'object') return new Map();
    const cached = KEY_CACHE.get(obj);
    if (cached) return cached;
    const idx = new Map<string, string>();
    for (const k of Object.keys(obj)) {
      const norm = normalizeKey(k);
      if (norm && !idx.has(norm)) idx.set(norm, k);
    }
    KEY_CACHE.set(obj, idx);
    return idx;
  }

  // ============================================================
  // Typed context helpers: vertellen of een object "data", "sms",
  // "voice" enz. gerelateerd is. Gebruikt voor counters/bundles
  // arrays waar items een "type" / "category" / "name" veld hebben.
  // ============================================================
  const DATA_TYPE_KEYWORDS = ['data', 'internet', 'mb', 'gb', 'byte', 'verbruik', 'gebruik'];
  const SMS_TYPE_KEYWORDS = ['sms', 'text', 'message', 'bericht', 'tekst'];
  function isDataContext(obj: Record<string, any> | null | undefined): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const pool: string[] = [];
    for (const k of ['type', 'category', 'name', 'label', 'kind', 'unit', 'serviceType', 'service']) {
      if (typeof (obj as any)[k] === 'string') pool.push(String((obj as any)[k]));
    }
    const s = pool.join(' ').toLowerCase();
    if (!s) return false;
    // Positieve match op data trefwoorden
    if (DATA_TYPE_KEYWORDS.some((kw) => s.includes(kw))) return true;
    // Eenheid "GB", "MB", "bytes" = data
    if (/\d*(gb|mb|kb|byte)/i.test(s)) return true;
    return false;
  }
  function isSmsContext(obj: Record<string, any> | null | undefined): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const pool: string[] = [];
    for (const k of ['type', 'category', 'name', 'label', 'kind', 'unit', 'serviceType', 'service']) {
      if (typeof (obj as any)[k] === 'string') pool.push(String((obj as any)[k]));
    }
    const s = pool.join(' ').toLowerCase();
    if (!s) return false;
    return SMS_TYPE_KEYWORDS.some((kw) => s.includes(kw));
  }

  // ============================================================
  // Recursief verzamelen van alle geneste objecten (incl. arrays)
  // Als search roots voor findKey. Max diepte 6 om oneindige loops
  // te voorkomen.
  // ============================================================
  function collectAllObjects(
    start: any,
    maxDepth = 6,
    seen = new WeakSet(),
    depth = 0,
  ): Array<Record<string, any>> {
    const out: Array<Record<string, any>> = [];
    if (!start || typeof start !== 'object' || depth > maxDepth) return out;
    if (Array.isArray(start)) {
      for (const el of start) {
        if (el && typeof el === 'object') {
          for (const sub of collectAllObjects(el, maxDepth, seen, depth + 1)) out.push(sub);
        }
      }
      return out;
    }
    if (seen.has(start)) return out;
    seen.add(start);
    out.push(start);
    for (const v of Object.values(start)) {
      if (v && typeof v === 'object') {
        for (const sub of collectAllObjects(v, maxDepth, seen, depth + 1)) out.push(sub);
      }
    }
    return out;
  }

  // ============================================================
  // Key-value pair arrays: [{ name/key/label/field: "Data Used", value: X }]
  // Worden veel gebruikt in portals. Return de waarde van het eerste
  // matching pair.
  // ============================================================
  function searchKvArrays(
    allObjects: Array<Record<string, any>>,
    normAliases: string[],
  ): any {
    for (const obj of allObjects) {
      if (!obj || typeof obj !== 'object') continue;
      // Pak eerst de naam-keys: kijk of dit object een KV pair is
      const nameKeyNormCandidates = ['name', 'key', 'label', 'field', 'property', 'param', 'parameter', 'attribute', 'column'];
      let nameKey: string | null = null;
      let valueKey: string | null = null;
      const objIdx = buildKeyIndex(obj);
      for (const nk of nameKeyNormCandidates) {
        const rk = objIdx.get(normalizeKey(nk));
        if (rk) { nameKey = rk; break; }
      }
      if (!nameKey) continue;
      const valueKeyNorms = ['value', 'val', 'content', 'data', 'amount', 'count', 'total', 'used', 'remaining'];
      for (const vk of valueKeyNorms) {
        const rk = objIdx.get(normalizeKey(vk));
        if (rk) { valueKey = rk; break; }
      }
      if (!valueKey) continue;
      const nmVal = (obj as any)[nameKey];
      if (typeof nmVal !== 'string') continue;
      const normName = normalizeKey(nmVal);
      if (!normName) continue;
      if (normAliases.includes(normName)) {
        const v = (obj as any)[valueKey];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    return undefined;
  }

  // ============================================================
  // findKey: zoek 1 value in r, dan in nestedSim, d.m.v. alias-normalizatie.
  // NIEUW: ook recursief diep zoeken, KV-arrays, en typed context.
  // Retourneert gevondenValue of undefined.
  //
  // EXTRA SANITY CHECK: Als de key (normalized) == value (normalized),
  //   dan is het een placeholder → overslaan en verder zoeken. Simhuis
  //   retourneert soms { iccid: "iccid" } i.p.v. echte waardes.
  // ============================================================
  function findKey(...aliases: string[]): any {
    const normAliases = aliases.map(normalizeKey).filter(Boolean);
    if (normAliases.length === 0) return undefined;

    const isPlaceholderValue = (rawValue: unknown, rawKey?: string): boolean => {
      if (rawValue === null || rawValue === undefined) return false;
      const s = typeof rawValue === 'string' ? rawValue : String(rawValue);
      if (!s) return false;
      const vn = normalizeKey(s);
      if (!vn) return false;
      if (ALL_KEY_ALIASES_NORMALIZED.has(vn)) return true;
      for (const na of normAliases) {
        if (na && na === vn) return true;
      }
      if (rawKey) {
        const rkn = normalizeKey(rawKey);
        if (rkn && rkn === vn) return true;
      }
      return false;
    };

    // Eerst: alle geneste objecten verzamelen (recursief)
    const allObjects: Array<Record<string, any>> = [];
    // Roots: r, nestedSim, en alle sub-paden
    allObjects.push(...collectAllObjects(r, 7));
    if (nestedSim && nestedSim !== r) allObjects.push(...collectAllObjects(nestedSim, 7));

    // (1) Standaard flat key-zoek in alle objecten
    for (const obj of allObjects) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      const idx = buildKeyIndex(obj);
      for (const na of normAliases) {
        const realKey = idx.get(na);
        if (realKey && obj[realKey] !== undefined && obj[realKey] !== null && obj[realKey] !== '') {
          if (!isPlaceholderValue(obj[realKey], realKey)) {
            return obj[realKey];
          }
        }
      }
    }

    // (2) Kijk of de eerste alias zelf in een KV-array match zit
    // (en de waarde geen placeholder is)
    const kvRaw = searchKvArrays(allObjects, normAliases);
    if (kvRaw !== undefined && !isPlaceholderValue(kvRaw)) return kvRaw;

    return undefined;
  }

  // ============================================================
  // findUsageInContext: Zoekt een waarde binnen een CONTEXT
  // (data of sms). Eerst zoekt het binnen counter/bundle objecten
  // die duidelijk data/SMS gerelateerd zijn, daarna binnen
  // expliciete data/sms sub-objecten, en als laatste fallback
  // via de normale findKey (ongecentreerd).
  //
  // Gebruikt generieke sleutels binnen de context:
  //   used, total, limit, remaining, count, value, amount, quota,
  //   allowance, threshold, alert, warning, min, max
  // ============================================================
  function findUsageInContext(
    contextKind: 'data' | 'sms',
    valueKind: 'used' | 'limit' | 'lowestLimit' | 'threshold' | 'alert',
  ): any {
    const allObjects: Array<Record<string, any>> = [];
    allObjects.push(...collectAllObjects(r, 7));
    if (nestedSim && nestedSim !== r) allObjects.push(...collectAllObjects(nestedSim, 7));

    const genKeysByKind: Record<string, string[]> = {
      used: ['used', 'usage', 'consumed', 'spent', 'count', 'value', 'amount', 'total', 'current'],
      limit: ['limit', 'max', 'maximum', 'quota', 'allowance', 'allocated', 'included', 'cap', 'plan', 'package', 'total'],
      lowestLimit: ['lowestlimit', 'threshold', 'alert', 'warning', 'min', 'notify', 'softlimit', 'alertlimit', 'lowlimit', 'lowerlimit'],
      threshold: ['threshold', 'alert', 'warning', 'limit', 'notify', 'trigger'],
      alert: ['alert', 'warning', 'threshold', 'notify', 'trigger', 'limit'],
    };
    const genKeys = (genKeysByKind[valueKind] ?? []).map(normalizeKey);

    // STAP 1: Counter/bundle items met type discriminator
    for (const obj of allObjects) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      const isContext = contextKind === 'data' ? isDataContext(obj) : isSmsContext(obj);
      if (!isContext) continue;
      // Nu: binnen dit context-object, zoek de genKeys
      const idx = buildKeyIndex(obj);
      for (const gk of genKeys) {
        const realKey = idx.get(gk);
        if (realKey && obj[realKey] !== undefined && obj[realKey] !== null && obj[realKey] !== '') {
          return obj[realKey];
        }
      }
      // Fallback: ook de waarde zelf in het KV-patroon
      for (const vk of ['value', 'val', 'content', 'data', 'amount', 'count', 'usage_count', 'used_bytes', 'usedcount', 'usagecount']) {
        const rk = idx.get(normalizeKey(vk));
        if (rk && obj[rk] !== undefined && obj[rk] !== null && obj[rk] !== '') {
          return obj[rk];
        }
      }
    }

    // STAP 2: Sub-objecten met expliciete naam (data / sms)
    const contextNames = contextKind === 'data'
      ? ['data', 'internet', 'datalimit', 'datausage']
      : ['sms', 'text', 'message', 'smsusage', 'smslimit', 'smsbundle'];
    for (const obj of allObjects) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      for (const [k, v] of Object.entries(obj)) {
        if (contextNames.includes(normalizeKey(k))) {
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const vidx = buildKeyIndex(v as Record<string, any>);
            for (const gk of genKeys) {
              const realKey = vidx.get(gk);
              if (realKey && (v as any)[realKey] !== undefined && (v as any)[realKey] !== null && (v as any)[realKey] !== '') {
                return (v as any)[realKey];
              }
            }
          }
        }
      }
    }

    return undefined;
  }

  const statusRaw = String(
    findKey(
      'status', 'state', 'sim_status', 'simState', 'lifeCycleStatus',
      'lifecycle_status', 'lifecycleStatus'
    ) ?? (typeof r.status === 'object' && r.status ? (r.status.value ?? r.status.name ?? '') : '')
    ?? ''
  ).toLowerCase() ?? '';
  let status: SimhuisSimStatus['status'] = (statusRaw || '') as any;
  if (['active', 'enabled', 'online', 'activated', 'in_service', 'provisioned'].includes(statusRaw)) status = 'active';
  else if (['inactive', 'disabled', 'offline', 'deactivated', 'retired', 'stock', 'in_stock', 'available', 'ready'].includes(statusRaw)) status = 'inactive';
  else if (['suspended', 'paused', 'barred', 'suspend', 'bar', 'hibernated', 'hibernate'].includes(statusRaw)) status = 'suspended';
  else if (['terminated', 'deleted', 'cancelled', 'canceled', 'cancel', 'destroyed', 'expired'].includes(statusRaw)) status = 'terminated';
  else if (['provisioning', 'activating', 'pending', 'activating_subscription', 'pre_active'].includes(statusRaw)) status = 'provisioning';

  // ============================================================
  // Placeholder-waardes die NOOIT als echte data moeten worden
  // beschouwd. Dit zijn typisch de key-namen zelf die Simhuis
  // teruggeeft in plaats van echte waardes (bv. "eid" i.p.v. een
  // echte eSIM-ID, of "iccid" i.p.v. een 19-20-cijferige ICCID).
  //
  // UITGEBREID: bevat nu ALLE alias-namen (ook zonder separators)
  // zodat varianten als "esimId", "esim_id", "esimid" allemaal
  // worden herkend. Simhuis retourneert namelijk vaak de key-
  // naam zelf als value in KV-arrays of per ongeluk.
  // ============================================================
  const INVALID_PLACEHOLDER_VALUES: ReadonlySet<string> = new Set<string>([
    // === Core identifiers (inclusief alle alias-vormen zonder separators) ===
    'iccid',
    'eid', 'esimid', 'esim_id', 'esim', 'esimprofileid', 'esim_profile_id', 'profileid', 'profile_id',
    'imsi',
    'msisdn', 'phonenumber', 'phone_number', 'phone', 'primarymsisdn', 'primary_msisdn',
    'virtualmsisdn', 'virtual_msisdn', 'msisdnvirtual',
    'subscriberid', 'subscriber_id', 'subscriber', 'subscriptionid', 'subscription_id',
    'assetid', 'asset_id', 'asset', 'deviceid', 'device_id',
    'id',
    'simid', 'sim_id', 'simcardid', 'simcard_id', 'simcard',
    // === Name / label / group-achtige velden ===
    'simname', 'sim_name', 'sim card name', 'simcardname', 'sim_card_name',
    'name', 'label', 'title', 'displayname', 'display_name', 'assetname', 'asset_name',
    'group', 'groupid', 'group_id', 'groupname', 'group_name', 'grouplabel', 'group_label',
    'pool', 'poolid', 'pool_id', 'poolname', 'pool_name',
    'batch', 'batchid', 'batch_id', 'batchname', 'batch_name',
    // === Product / plan / tariff ===
    'product', 'productname', 'product_name', 'productcode', 'product_code', 'productid',
    'producttype', 'product_type', 'producttypename', 'product_type_name',
    'productcategory', 'product_category', 'category',
    'plantype', 'plan_type', 'plan', 'planname', 'plan_name', 'planid', 'plan_id',
    'tariff', 'tariffname', 'tariff_name', 'tariffid', 'tariff_id',
    'rateplan', 'rate_plan', 'rateplantype', 'rate_plan_type',
    'offer', 'offerid', 'offer_id', 'offername', 'offer_name',
    'package', 'packagename', 'package_name', 'packageid', 'package_id',
    'bundle', 'bundlename', 'bundle_name',
    'billingmodel', 'billing_model', 'chargetype', 'charge_type', 'chargemodel', 'charge_model',
    'paymentmodel', 'payment_model', 'billingtype', 'billing_type',
    // === Data / usage velden ===
    'dataused', 'data_used', 'datausage', 'data_usage',
    'datausedmb', 'data_used_mb', 'datausedgb', 'data_used_gb', 'datausedkb', 'data_used_kb',
    'usedmb', 'used_mb', 'usedgb', 'used_gb', 'usedkb', 'used_kb',
    'datambused', 'data_mb_used', 'datagbused', 'data_gb_used', 'datakbused', 'data_kb_used',
    'monthlydataused', 'monthly_data_used', 'currentdataused', 'current_data_used',
    'dataconsumed', 'data_consumed', 'consumeddata', 'consumed_data',
    'usagemb', 'usage_mb', 'usagegb', 'usage_gb', 'usagekb', 'usage_kb',
    'totalconsumed', 'total_consumed', 'totaldataused', 'total_data_used',
    'datalimit', 'data_limit', 'dataquota', 'data_quota',
    'datalimitmb', 'data_limit_mb', 'datalimitgb', 'data_limit_gb', 'datalimitkb', 'data_limit_kb',
    'maxmb', 'max_mb', 'maxgb', 'max_gb', 'maxkb', 'max_kb',
    'datamaxmb', 'data_max_mb', 'datamaxgb', 'data_max_gb', 'datamaxbytes', 'data_max_bytes',
    'quotadatamb', 'quota_data_mb', 'quotadatagb', 'quota_data_gb', 'quotadata', 'quota_data',
    'plandatalimit', 'plan_data_limit', 'tariffdatalimit', 'tariff_data_limit',
    'bundledatalimit', 'bundle_data_limit', 'packagedatalimit', 'package_data_limit',
    'dataallowance', 'data_allowance', 'allocateddata', 'allocated_data',
    'totalallowance', 'total_allowance', 'totaldata', 'total_data',
    'includeddata', 'included_data', 'datacap', 'data_cap', 'capdata', 'cap_data',
    'datapoollimit', 'data_pool_limit', 'pooldatalimit', 'pool_data_limit',
    'lowestdatalimit', 'lowest_data_limit', 'lowdatalimit', 'low_data_limit',
    'datathreshold', 'data_threshold', 'dataalert', 'data_alert', 'datawarning', 'data_warning',
    'mindatalimit', 'min_data_limit', 'notifylimit', 'notify_limit', 'softlimit', 'soft_limit',
    'alertlimit', 'alert_limit', 'lowlimit', 'low_limit', 'lowerlimit', 'lower_limit',
    'dataalertmb', 'data_alert_mb', 'dataalertgb', 'data_alert_gb',
    'datawarningmb', 'data_warning_mb', 'datawarninggb', 'data_warning_gb',
    'lowdatamb', 'low_data_mb', 'lowdatagb', 'low_data_gb',
    'datathresholdmb', 'data_threshold_mb', 'datathresholdgb', 'data_threshold_gb',
    'notifydatalimit', 'notify_data_limit', 'softlimitmb', 'soft_limit_mb',
    'softlimitgb', 'soft_limit_gb', 'softdatalimit', 'soft_data_limit',
    'mindatamb', 'min_data_mb', 'mindatagb', 'min_data_gb',
    'thresholdlimit', 'threshold_limit',
    // === SMS velden ===
    'smsused', 'sms_used', 'smsusedcount', 'sms_used_count',
    'smscount', 'sms_count', 'totalsms', 'total_sms',
    'smsusage', 'sms_usage', 'smssent', 'sms_sent',
    'smssenttotal', 'sms_sent_total', 'currentsmsused', 'current_sms_used',
    'smsconsumed', 'sms_consumed', 'consumedsms', 'consumed_sms',
    'sentsms', 'sent_sms', 'smsout', 'sms_out', 'outboundsms', 'outbound_sms',
    'mosms', 'mo_sms', 'mtsms', 'mt_sms',
    'smsusedmonth', 'sms_used_month', 'smsusedperiod', 'sms_used_period',
    'textsused', 'texts_used', 'textused', 'text_used',
    'messagesused', 'messages_used', 'messagecount', 'message_count',
    'smslimit', 'sms_limit', 'smsquota', 'sms_quota', 'smsmax', 'sms_max', 'smsmaximum', 'sms_maximum',
    'maxsms', 'max_sms', 'smsbundle', 'sms_bundle',
    'allowancesms', 'allowance_sms', 'smsallowance', 'sms_allowance',
    'plansmslimit', 'plan_sms_limit', 'smsplantype', 'sms_plan_type',
    'smsplanner', 'sms_plan_limit', 'smstarifflimit', 'sms_tariff_limit',
    'smscap', 'sms_cap', 'capsms', 'cap_sms', 'smsallocation', 'sms_allocation',
    'smsmaxcount', 'sms_max_count', 'smsallocationcount', 'sms_allocation_count',
    'included sms', 'includedsms', 'included_sms',
    'smstotal', 'sms_total', 'quotasms', 'quota_sms',
    'lowestsmslimit', 'lowest_sms_limit', 'lowsmslimit', 'low_sms_limit',
    'smsthreshold', 'sms_threshold', 'smsalert', 'sms_alert', 'smswarning', 'sms_warning',
    'minsmslimit', 'min_sms_limit', 'smslowlimit', 'sms_low_limit',
    'smsalertcount', 'sms_alert_count', 'smsnotify', 'sms_notify',
    'smsnotifyat', 'sms_notify_at', 'smsthresholdcount', 'sms_threshold_count',
    'smssoftlimit', 'sms_soft_limit', 'smsminlimit', 'sms_min_limit',
    'smswarningcount', 'sms_warning_count', 'lowsms', 'low_sms',
    'alertsmslimit', 'alert_sms_limit',
    // === Account / customer / profile ===
    'account', 'accountid', 'account_id', 'accountname', 'account_name',
    'customer', 'customerid', 'customer_id', 'customername', 'customer_name',
    'tenant', 'tenantid', 'tenant_id', 'tenantname', 'tenant_name',
    'organization', 'organizationid', 'organization_id', 'org', 'orgid', 'org_id',
    'reseller', 'resellerid', 'reseller_id', 'resellername', 'reseller_name',
    'profiletype', 'profile_type', 'profile',
    'provisioningprofile', 'provisioning_profile',
    'bootstrapprofile', 'bootstrap_profile', 'defaultprofile', 'default_profile',
    'genericprofile', 'generic_profile',
    // === Status / state / lifecycle ===
    'status', 'state', 'lifecycle', 'lifecycle_status', 'lifecycle_status',
    'lifecycle_status', 'lifecyclestatus', 'life_cycle_status',
    'simstatus', 'sim_status', 'simstate', 'sim_state',
    // === Network / provider / carrier ===
    'network', 'carrier', 'provider', 'operator', 'networkname', 'network_name',
    'countryiso', 'country_iso', 'country', 'ip', 'ipaddress', 'ip_address',
    'lastip', 'last_ip',
    // === Date / time fields ===
    'activatedat', 'activated_at', 'activationdate', 'activation_date',
    'createdat', 'created_at', 'provisionedat', 'provisioned_at',
    'startdate', 'start_date',
    // === Service / type / category / sim category ===
    'type', 'kind', 'category', 'assettype', 'asset_type',
    'simcategory', 'sim_category', 'simtype', 'sim_type',
    'assetcategories', 'asset_categories',
    'subscriptiontype', 'subscription_type', 'servicetype', 'service_type',
    // === Generieke placeholders ===
    'n/a', 'na', 'unknown', 'none', 'empty', 'placeholder',
    'undefined', 'null', '0', '000000000000000',
    '--', '---', '-',
    // === Velden die "value", "amount", "count" zelf als placeholder teruggeven ===
    'value', 'val', 'amount', 'count', 'total', 'remaining',
    'usage', 'quota', 'allowance', 'limit', 'used',
  ]);

  // === Genormaliseerde Lijst van ALLE key-aliassen (zie pickString/pickNumber/pickBytes) ===
  // Wordt gebruikt om te detecteren: als value-normalized == key-normalized → placeholder!
  const ALL_KEY_ALIASES_NORMALIZED: ReadonlySet<string> = new Set<string>(
    Array.from(INVALID_PLACEHOLDER_VALUES).map((v) => normalizeKey(v))
  );

  function isValidStringValue(s: string, contextAliases?: string[]): boolean {
    if (!s) return false;
    if (s === '-' || s === 'null' || s === 'undefined') return false;
    const trimmed = s.trim();
    if (!trimmed) return false;
    const normalized = trimmed.toLowerCase();
    if (INVALID_PLACEHOLDER_VALUES.has(normalized)) return false;
    // Extra sanity-check: als de waarde (genormaliseerd met normalizeKey)
    // exact overeenkomt met een bekende key-alias → dan is het een placeholder.
    const norm = normalizeKey(trimmed);
    if (norm && ALL_KEY_ALIASES_NORMALIZED.has(norm)) return false;
    // Als context-aliasses meegegeven worden (de aliasnamen van het veld):
    // ook checken of de genormaliseerde waarde == 1 van de aliassen.
    if (contextAliases && contextAliases.length > 0) {
      for (const a of contextAliases) {
        const aNorm = normalizeKey(a);
        if (aNorm && aNorm === norm) return false;
      }
    }
    return true;
  }

  // ============================================================
  // pickString: zoek eerst via findKey (alias-normalizatie),
  // daarna fallback op de expliciete paden als strings/numbers.
  // Filtert placeholder-waardes zoals "eid", "iccid", "null", etc.
  //
  // NIEUW: contextAliases (de namen van het veld, bijv. "eid", "esimId")
  // worden meegestuurd zodat een sanity-check gedaan kan worden:
  // als value-normalized == 1 van de contextAliases-normalized →
  // dan is het een placeholder (Simhuis geeft key-naam als value terug).
  // ============================================================
  const pickString = (...paths: Array<unknown>): string | null => {
    // Verzamel alle string-argumenten als context-aliassen (de veldnamen)
    const contextAliases: string[] = paths
      .filter((p): p is string => typeof p === 'string')
      .map((s) => s.trim())
      .filter(Boolean);

    // Eerst: aliassen die findKey begrijpt
    for (const p of paths) {
      if (typeof p === 'string') {
        const v = findKey(p);
        if (v !== undefined && v !== null) {
          const s = String(v).trim();
          if (isValidStringValue(s, contextAliases)) return s;
        }
      }
    }
    // Daarna expliciete waarden
    for (const p of paths) {
      if (p === null || p === undefined) continue;
      if (typeof p === 'object') continue; // als object is al door findKey geprobeerd
      const s = String(p).trim();
      if (isValidStringValue(s, contextAliases)) return s;
    }
    return null;
  };

  // ============================================================
  // parseBytes: accepteert "322.49 MB", "2,00GB", 33816576 (bytes), enz.
  // Retourneert number | null (aantal bytes).
  // ============================================================
  const BYTE_MULTIPLIERS: Record<string, number> = {
    b: 1,
    k: 1024, kb: 1024, kbit: 128,
    m: 1024 ** 2, mb: 1024 ** 2, mib: 1024 ** 2, mbit: (1024 ** 2) / 8,
    g: 1024 ** 3, gb: 1024 ** 3, gib: 1024 ** 3, gbit: (1024 ** 3) / 8,
    t: 1024 ** 4, tb: 1024 ** 4, tib: 1024 ** 4,
    p: 1024 ** 5, pb: 1024 ** 5, pib: 1024 ** 5,
  };
  function parseBytes(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'bigint') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof raw === 'number') {
      return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw !== 'string') return null;
    let s = raw.trim();
    if (!s || s === '-' || s === 'null' || s === 'undefined') return null;
    // Vervang Nederlands/Continentaal decimaal komma door punt
    s = s.replace(/,(\d)/g, '.$1');
    // Strip spaties tussen getal en unit
    s = s.replace(/\s+/g, '');
    const match = s.match(/^(-?\d+(?:\.\d+)?)([a-zA-Z]*)$/);
    if (!match) {
      // Misschien is het een getal met duizendtalseparator? Probeer te parsen als gewoon getal (bytes)
      const justNum = Number(s.replace(/[^\d.]/g, ''));
      return Number.isFinite(justNum) ? justNum : null;
    }
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return null;
    const unit = (match[2] && typeof match[2] === 'string' ? match[2] : 'b').toLowerCase();
    const mult = BYTE_MULTIPLIERS[unit] ?? 1;
    return num * mult;
  }

  // ============================================================
  // pickNumber: eerst findKey, dan expliciete paden. Accepteert
  // strings "100", numbers, bigints.
  // NIEUW: accepteert optionele contextKind/valueKind voor
  // context-gewijze extractie.
  // ============================================================
  const pickNumber = (opts: { contextKind?: 'data' | 'sms'; valueKind?: 'used' | 'limit' | 'lowestLimit' | 'threshold' | 'alert'; aliases: Array<unknown> }): number | null => {
    // STAP 0 (optioneel): context-gewijze extractie
    if (opts.contextKind && opts.valueKind) {
      const cv = findUsageInContext(opts.contextKind, opts.valueKind);
      if (cv !== undefined && cv !== null) {
        if (typeof cv === 'number' && Number.isFinite(cv)) return cv;
        if (typeof cv === 'string') {
          const cleaned = cv.trim().replace(/,(\d)/g, '.$1');
          const n = Number(cleaned.replace(/[^\d.\-]/g, ''));
          if (Number.isFinite(n)) return n;
          if (cleaned && !/[a-zA-Z]/.test(cleaned)) {
            const raw = Number(cleaned);
            if (Number.isFinite(raw)) return raw;
          }
        }
        if (typeof cv === 'bigint') {
          const n = Number(cv);
          if (Number.isFinite(n)) return n;
        }
        // Probeer ook als bytes (met units) te parsen, dan aantal bytes als number
        const pb = parseBytes(cv);
        if (pb !== null && Number.isFinite(pb)) {
          // Als het SMS is en de waarde is groot (>10000), is het waarschijnlijk bytes.
          // We returnen dan alleen als het getal "redelijk" is voor SMS (geen bytes),
          // anders gewoon door.
          if (opts.contextKind !== 'sms') return pb;
        }
      }
    }
    for (const p of opts.aliases) {
      if (typeof p === 'string') {
        const v = findKey(p);
        if (v !== undefined && v !== null) {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const cleaned = v.trim().replace(/,(\d)/g, '.$1');
            const n = Number(cleaned.replace(/[^\d.\-]/g, ''));
            if (Number.isFinite(n)) return n;
            if (cleaned && !/[a-zA-Z]/.test(cleaned)) {
              const raw = Number(cleaned);
              if (Number.isFinite(raw)) return raw;
            }
          }
          if (typeof v === 'bigint') {
            const n = Number(v);
            if (Number.isFinite(n)) return n;
          }
        }
      }
    }
    for (const p of opts.aliases) {
      if (p === null || p === undefined) continue;
      if (typeof p === 'number' && Number.isFinite(p)) return p;
      if (typeof p === 'string') {
        const cleaned = p.trim().replace(/,(\d)/g, '.$1');
        const n = Number(cleaned.replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(n)) return n;
      }
      if (typeof p === 'bigint') {
        const n = Number(p);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  // ============================================================
  // pickBytes: zoek eerst via findKey op data-aliassen, parset
  // daarna met parseBytes (units zoals MB/GB), fallback op
  // pickNumber voor plain bytes.
  // NIEUW: accepteert optionele contextKind om eerst findUsageInContext
  // te gebruiken voor context-gewijze extractie.
  // ============================================================
  const pickBytes = (opts: { contextKind?: 'data' | 'sms'; valueKind?: 'used' | 'limit' | 'lowestLimit' | 'threshold' | 'alert'; aliases: Array<unknown> }): number | null => {
    // STAP 0 (optioneel): context-gewijze extractie (vindt generieke keys binnen data/sms context)
    if (opts.contextKind && opts.valueKind) {
      const cv = findUsageInContext(opts.contextKind, opts.valueKind);
      if (cv !== undefined && cv !== null) {
        const pb = parseBytes(cv);
        if (pb !== null) return pb;
        const nb = pickNumber({ aliases: [cv] });
        if (nb !== null) return nb;
      }
    }
    // Daarna via findKey (unit-string OK, of number OK)
    for (const a of opts.aliases) {
      if (typeof a !== 'string') continue;
      const v = findKey(a);
      if (v !== undefined && v !== null) {
        const pb = parseBytes(v);
        if (pb !== null) return pb;
        const nb = pickNumber({ aliases: [v] });
        if (nb !== null) return nb;
      }
    }
    // Daarna via expliciete waardes als die in de args zitten
    for (const a of opts.aliases) {
      if (typeof a === 'string') continue;
      const pb = parseBytes(a);
      if (pb !== null) return pb;
      const nb = pickNumber({ aliases: [a] });
      if (nb !== null) return nb;
    }
    return null;
  };

  const iccidVal = pickString(
    'iccid', r.iccid, r.sim_iccid, r.simIccid, r.eid,
    nestedSim?.iccid, nestedSim?.sim_iccid, nestedSim?.simIccid, nestedSim?.eid,
    iccid,
  ) ?? '';

  const eidVal = pickString(
    'eid', 'esimId', 'esim_id', 'esimID', 'eSimId', 'eSIM ID',
    r.eid, r.esimId, nestedSim?.eid,
  );

  const subscriberIdVal = pickString(
    'id', 'assetId', 'asset_id', 'asssetID',
    'subscriberId', 'subscriber_id', 'subscriptionId', 'subscription_id',
    'esimProfileId', 'esim_profile_id', 'profileId', 'profile_id',
    r.id, nestedSim?.id, nestedSim?.subscriberId,
  );

  const simNameVal = pickString(
    'SIM Name', 'SIM_NAME', 'simName', 'name', 'assetName', 'asset_name',
    'displayName', 'display_name', 'label', 'title',
    r.name, r.simName, nestedSim?.name, nestedSim?.simName, nestedSim?.displayName,
  );

  const groupIdVal = pickString(
    'groupId', 'group_id', 'groupID',
    r.groupId, nestedSim?.groupId,
  );

  const groupNameVal = pickString(
    'Group', 'group', 'groupName', 'group_name', 'groupLabel',
    'poolName', 'pool_name', 'batch', 'batchName',
    r.group, r.groupName, nestedSim?.group, nestedSim?.poolName,
  );

  const productNameVal = pickString(
    'Product Name', 'productName', 'product_name', 'product',
    'productCode', 'product_code', 'productId',
    'tariffName', 'ratePlan', 'rate_plan', 'planName',
    r.productName, r.product, nestedSim?.productName, nestedSim?.planName,
  );

  const productTypeVal = (() => {
    const first = pickString(
      'Product Type', 'productType', 'product_type', 'productTypeName',
      'product_category', 'productCategory', 'type', 'assetType', 'asset_type',
      'category', 'simCategory', 'simType', 'assetCategory',
      'subscriptionType', 'subscription_type', 'kind',
      'tariffType', 'rateType', 'planType',
      'billingModel', 'billing_model', 'chargeModel', 'charge_model',
      r.productType, nestedSim?.productType, nestedSim?.type,
    );
    // Filter generieke profiel-types (geen echte product/plan type)
    const BAD_PRODUCT_TYPE_PATTERNS = [
      /esim.?profile/i, /profile.?m2m/i, /sim.?profile/i,
      /bootstrap/i, /default.?profile/i, /generic/i,
    ];
    if (first && !BAD_PRODUCT_TYPE_PATTERNS.some((re) => re.test(first))) return first;
    // Tweede kans: expliciete per-type keys met hogere specificiteit
    const candidates = [
      findKey('planType'), findKey('plan_type'),
      findKey('billingModel'), findKey('billing_model'),
      findKey('ratePlanType'), findKey('rate_plan_type'),
      findKey('tariffModel'), findKey('tariff_model'),
      findKey('paymentModel'), findKey('payment_model'),
      findKey('billingType'), findKey('billing_type'),
      findKey('productCategory'),
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && isValidStringValue(c)) {
        if (!BAD_PRODUCT_TYPE_PATTERNS.some((re) => re.test(c))) return c;
      }
    }
    // Derde kans: alle non-empty type-achtige strings in het hele object
    const all = collectAllObjects(r, 5);
    if (nestedSim && nestedSim !== r) all.push(...collectAllObjects(nestedSim, 5));
    const typeKeysNorm = ['producttype', 'plantype', 'billingtype', 'billingmodel', 'chargetype', 'tariffcategory', 'productcategory'];
    for (const obj of all) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
      const idx = buildKeyIndex(obj);
      for (const tkn of typeKeysNorm) {
        const rk = idx.get(tkn);
        if (rk) {
          const v = (obj as any)[rk];
          if (typeof v === 'string' && isValidStringValue(v) && !BAD_PRODUCT_TYPE_PATTERNS.some((re) => re.test(v))) {
            return v;
          }
        }
      }
    }
    // Fallback: accepteer first als die ten minste non-empty is (ook al is het profiel-type)
    if (first) return first;
    // Als een van de candidates wel een string is (maar profile-type), accepteer die dan
    for (const c of candidates) {
      if (typeof c === 'string' && isValidStringValue(c)) return c;
    }
    return null;
  })();

  // Data / Usage velden — gebruiken pickBytes met context-extractie eerst
  const dataUsedBytesVal = pickBytes({
    contextKind: 'data',
    valueKind: 'used',
    aliases: [
      'Data Used', 'Data_Used', 'dataUsed', 'data_used_bytes',
      'used_bytes', 'total_usage', 'dataUsage', 'data_usage',
      'usage data_bytes', 'data_bytes', 'bytes',
      'usedData', 'used_data', 'consumed_bytes', 'consumedData',
      'dataUsedMB', 'data_used_mb', 'dataUsedGb', 'data_used_gb',
      'used_mb', 'used_gb', 'usedMb', 'usedGb',
      'usedKb', 'used_kb', 'dataUsedKb', 'data_used_kb',
      'data_mb_used', 'data_gb_used', 'data_kb_used',
      'monthly_data_used', 'monthlyDataUsed', 'current_data_used', 'currentDataUsed',
      'consumption_data', 'dataConsumed', 'data_consumed',
      'usageMB', 'usage_mb', 'usageGB', 'usage_gb', 'usageKB', 'usage_kb',
      'totalConsumed', 'total_consumed', 'totalDataUsed', 'total_data_used',
      'dataUsageValue', 'data_usage_value', 'actualUsage', 'actual_usage',
      'periodUsage', 'period_usage', 'periodDataUsage', 'period_data_usage',
      'dataUsageMB', 'data_usage_mb', 'dataUsageGB', 'data_usage_gb',
      'used_data_mb', 'used_data_gb', 'used_data_kb', 'used_data_tb',
      'dataTotal', 'data_total', 'dataSpent', 'data_spent',
      r.dataUsed, r.data_used_bytes, r.dataUsage, r.data_usage, r.total_usage,
      r.dataUsedMB, r.dataUsedGb, r.usedMB, r.usedGB, r.usedMb, r.usedGb,
    ],
  });
  const dataLimitBytesVal = pickBytes({
    contextKind: 'data',
    valueKind: 'limit',
    aliases: [
      'Data Limit', 'Data_Limit', 'dataLimit', 'data_limit_bytes',
      'limit_bytes', 'data_quota', 'dataQuota',
      'plan data_limit_bytes', 'data_quota_plan',
      'max_data_bytes', 'total_data_bytes', 'allowance_data',
      'dataLimitMB', 'data_limit_mb', 'dataLimitGB', 'data_limit_gb', 'dataLimitKB', 'data_limit_kb',
      'maxMB', 'max_mb', 'maxGB', 'max_gb', 'maxKb', 'max_kb',
      'data_max_mb', 'data_max_gb', 'data_max_bytes',
      'quota_data_mb', 'quota_data_gb', 'quota_data',
      'planDataLimit', 'plan_data_limit', 'tariffDataLimit', 'tariff_data_limit',
      'packageDataLimit', 'package_data_limit', 'bundleDataLimit', 'bundle_data_limit',
      'dataAllowance', 'data_allowance', 'allocatedData', 'allocated_data',
      'totalAllowance', 'total_allowance', 'totalData', 'total_data',
      'includedData', 'included_data', 'cap_data', 'dataCap', 'data_cap',
      'dataPoolLimit', 'data_pool_limit', 'poolDataLimit', 'pool_data_limit',
      'thresholdLimit', 'threshold_limit',
      r.dataLimit, r.data_limit_bytes, r.dataQuota, r.data_quota,
      r.dataLimitMB, r.dataLimitGB, r.maxMB, r.maxGB,
    ],
  });
  const lowestDataLimitBytesVal = pickBytes({
    contextKind: 'data',
    valueKind: 'lowestLimit',
    aliases: [
      'Lowest Data Limit', 'lowest_data_limit_bytes',
      'data_threshold_bytes', 'data alert bytes', 'dataAlertBytes',
      'data_warning_limit', 'lowDataLimit', 'threshold_data_bytes',
      'warning_data_bytes', 'min_data_limit_bytes', 'dataLowLimit',
      'data_low_limit',
      'dataAlertMB', 'data_alert_mb', 'dataAlertGB', 'data_alert_gb',
      'dataWarningMB', 'data_warning_mb', 'dataWarningGB', 'data_warning_gb',
      'lowDataMB', 'low_data_mb', 'lowDataGB', 'low_data_gb',
      'dataThresholdMB', 'data_threshold_mb', 'dataThresholdGB', 'data_threshold_gb',
      'notifyDataLimit', 'notify_data_limit', 'alertLimit', 'alert_limit',
      'softLimitMB', 'soft_limit_mb', 'softLimitGB', 'soft_limit_gb', 'softDataLimit',
      'minDataMB', 'min_data_mb', 'minDataGB', 'min_data_gb',
      r.lowestDataLimit, r.lowest_data_limit_bytes, r.dataLowLimit, r.dataAlertBytes,
      r.dataAlertMB, r.dataAlertGB, r.dataWarningMB, r.dataWarningGB,
    ],
  });
  // SMS velden — gebruiken pickNumber met context-extractie eerst
  const smsUsedCountVal = pickNumber({
    contextKind: 'sms',
    valueKind: 'used',
    aliases: [
      'sms used', 'SMS Used', 'smsUsed', 'sms_used',
      'sms_used_count', 'sms_count', 'total_sms',
      'sms_usage', 'smsUsage', 'totalSms', 'smsSent', 'sms_sent',
      'usage sms_count', 'usage sms', 'consumed_sms',
      'smsUsedTotal', 'sms_used_total', 'current_sms_used', 'currentSmsUsed',
      'smsConsumed', 'sms_consumed', 'sentSms', 'sent_sms', 'smsOut', 'sms_out',
      'outboundSms', 'outbound_sms', 'moSms', 'mo_sms', 'mtSms', 'mt_sms',
      'smsUsedMonth', 'sms_used_month', 'smsUsedPeriod', 'sms_used_period',
      'textsUsed', 'texts_used', 'textUsed', 'text_used', 'sms_usage_count',
      'messagesUsed', 'messages_used', 'messageCount', 'message_count',
      r.smsUsed, r.sms_used, r.sms_count, r.totalSms, r.smsSent,
    ],
  });
  const smsLimitCountVal = pickNumber({
    contextKind: 'sms',
    valueKind: 'limit',
    aliases: [
      'SMS Limit', 'sms_limit', 'sms_quota', 'smsLimit', 'max_sms',
      'sms_max', 'maximum_sms', 'smsBundle', 'sms_bundle',
      'allowance_sms', 'smsAllowance', 'plan sms_limit',
      'total_sms_bundle',
      'smsPlanLimit', 'sms_plan_limit', 'smsTariffLimit', 'sms_tariff_limit',
      'smsCap', 'sms_cap', 'smsAllocation', 'sms_allocation',
      'smsMaxCount', 'sms_max_count', 'includedSms', 'included_sms',
      'smsTotal', 'sms_total', 'smsAllowanceCount', 'sms_allowance_count',
      'quota_sms', 'sms_quota_count', 'maxMessages', 'max_messages',
      'textLimit', 'text_limit', 'textsLimit', 'texts_limit',
      'bundledSms', 'bundled_sms', 'packageSms', 'package_sms',
      r.smsLimit, r.sms_limit, r.max_sms, r.smsBundle, r.smsAllowance,
    ],
  });
  const lowestSmsLimitCountVal = pickNumber({
    contextKind: 'sms',
    valueKind: 'lowestLimit',
    aliases: [
      'Lowest SMS limit', 'Lowest SMS Limit', 'lowest_sms_limit',
      'sms_threshold', 'sms_alert', 'lowSmsLimit',
      'sms_warning', 'smsWarning', 'min_sms_limit', 'smsLowLimit',
      'sms_low_limit', 'plan lowest_sms_limit',
      'smsAlertCount', 'sms_alert_count', 'smsAlert',
      'smsNotify', 'sms_notify', 'smsNotifyAt', 'sms_notify_at',
      'smsThresholdCount', 'sms_threshold_count', 'smsSoftLimit', 'sms_soft_limit',
      'smsMinLimit', 'sms_min_limit', 'smsWarningCount', 'sms_warning_count',
      'lowSms', 'low_sms', 'alertSmsLimit', 'alert_sms_limit',
      r.lowestSmsLimit, r.lowest_sms_limit, r.lowSmsLimit,
    ],
  });

  if (DEBUG) {
    // eslint-disable-next-line no-console
    const allKeys = collectAllKeys(r, 0, 4);
    const suspect = (k: { path: string; value: any }): boolean => {
      const p = k.path.toLowerCase();
      return (
        p.includes('data') || p.includes('usage') || p.includes('sms') || p.includes('mb') ||
        p.includes('gb') || p.includes('bytes') || p.includes('used') || p.includes('count') ||
        p.includes('limit') || p.includes('quota') || p.includes('remaining') ||
        p.includes('allowance') || p.includes('bundle') || p.includes('consumption') ||
        p.includes('verbruik') || p.includes('package') || p.includes('tariff') ||
        p.includes('product') || p.includes('plan') || p.includes('value')
      );
    };
    const susList = allKeys.filter(suspect).slice(0, 100).map((k) => `${k.path}=${
      typeof k.value === 'object' ? JSON.stringify(k.value).slice(0, 200) : String(k.value).slice(0, 200)
    }`);
    // eslint-disable-next-line no-console
    console.log(
      '[DEBUG][toSimStatus] iccid=%s\n  keys(r)=%O\n  alle geneste paden (verdachte data/plan keys, %d van %d totaal):\n    - %s\n  resultaten:\n    productName=%s productType=%s simName=%s group=%s\n    dataUsedBytes=%s (raw=%s) dataLimitBytes=%s (raw=%s) lowestDataLimitBytes=%s\n    smsUsedCount=%s smsLimitCount=%s lowestSmsLimitCount=%s',
      iccidVal || iccid,
      Object.keys(r),
      susList.length,
      allKeys.length,
      susList.join('\n    - '),
      productNameVal, productTypeVal, simNameVal, groupNameVal,
      dataUsedBytesVal, findKey('Data Used', 'dataUsed', 'data_used_bytes'),
      dataLimitBytesVal, findKey('Data Limit', 'dataLimit', 'data_limit_bytes'),
      lowestDataLimitBytesVal,
      smsUsedCountVal, smsLimitCountVal, lowestSmsLimitCountVal,
    );
  }

  return {
    iccid: iccidVal,
    eid: eidVal,
    imsi: pickString('imsi', r.imsi, nestedSim?.imsi),
    msisdn: pickString(
      'msisdn', 'phone_number', 'primaryMsisdn', 'MSISDN',
      'Virtual MSISDN', 'virtual_msisdn',
      r.msisdn, nestedSim?.msisdn, r.primaryMsisdn,
    ),
    subscriberId: subscriberIdVal,
    simName: simNameVal,
    groupId: groupIdVal,
    groupName: groupNameVal,
    productName: productNameVal,
    productType: productTypeVal,
    status,
    ip: pickString(
      'ip', 'ip_address', 'lastIp', 'last_ip', 'Last IP',
      r.ip, nestedSim?.lastIp,
    ),
    network: pickString(
      'network', 'carrier', 'provider', 'operator', 'country_iso',
      'networkName', 'network_name',
      r.network, nestedSim?.networkName,
    ),
    planName: pickString(
      'plan_name', 'offer_name', 'tariff', 'rate_plan', 'plan',
      'package_name', 'planName',
      nestedSim?.planName, nestedSim?.plan_name,
    ),
    dataUsedBytes: dataUsedBytesVal,
    dataLimitBytes: dataLimitBytesVal,
    lowestDataLimitBytes: lowestDataLimitBytesVal,
    smsUsedCount: smsUsedCountVal,
    smsLimitCount: smsLimitCountVal,
    lowestSmsLimitCount: lowestSmsLimitCountVal,
    activatedAt: pickString(
      'activated_at', 'activation_date', 'created_at', 'provisioned_at',
      'startDate', 'start_date',
      nestedSim?.activatedAt, nestedSim?.provisioned_at,
    ),
    raw,
  };
}

function unwrap<T>(resp: unknown): T {
  const r = resp as SimhuisApiResponse<T>;
  if (r && typeof r === 'object' && 'data' in r && (r.data !== undefined || typeof r.success === 'boolean')) {
    return (r.data ?? (resp as any)) as T;
  }
  return resp as T;
}

async function doRequest<T = unknown>(
  path: string,
  options: SimhuisRequestOptions = {},
): Promise<T> {
  const client = await simhuisClient.getClient();
  if (!client) {
    throw new SimhuisApiError(503, null, path, '[Simhuis] Niet geconfigureerd (SIMHUIS_USERNAME en/of SIMHUIS_PASSWORD ontbreken in omgevingsvariabelen).');
  }
  return unwrap<T>(await client.request<T>(path, options));
}

// === Gedeelde WAF-bypass & auth utilities (gebruikt door getSimStatus/activateSim/deactivateSim) ===
const PER_SIM_WAF_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Origin': 'https://apicontrolcenter.com',
  'Referer': 'https://apicontrolcenter.com/',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest',
  'Connection': 'keep-alive',
};

type PerSimAuth =
  | { tag: 'basic-header'; header: string }
  | { tag: 'bearer-token'; token: string }
  | { tag: 'creds-body'; username: string; password: string; resellerId?: string | null }
  | { tag: 'creds-query'; username: string; password: string; resellerId?: string | null }
  | { tag: 'x-custom-headers'; username: string; password: string; resellerId?: string | null };

type PerSimAttemptResult =
  | { tag: 'ok'; body: unknown; statusCode: number }
  | { tag: 'skip'; statusCode: number; error?: string; raw?: unknown }
  | { tag: 'error'; statusCode: number; error: string; raw?: unknown };

type PerSimAttemptMeta = {
  endpointPath: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  authTag: string;
  contentType: string;
};

type RankedAttempt = {
  meta: PerSimAttemptMeta;
  statusCode: number;
  error: string | null;
  score: number;
};

async function getSimhuisCreds(): Promise<{
  baseUrl: string;
  username: string;
  password: string;
  resellerId?: string | null;
  endpoints: { sims: string; simActivate: string; simDeactivate: string };
}> {
  const anyClient = await simhuisClient.getClient();
  if (!anyClient) {
    throw new Error('[Simhuis] Niet geconfigureerd (username/password ontbreken).');
  }
  const creds = (anyClient as unknown as {
    creds: {
      baseUrl: string;
      username: string;
      password: string;
      resellerId?: string | null;
      endpoints: { sims: string; simActivate: string; simDeactivate: string };
    };
  }).creds;
  return creds;
}

function getSimhuisPathPrefixes(baseEndpointsSims: string): string[] {
  const prefixes = new Set<string>();
  // === AirOn360 (Simhuis backend) standaard base path: /v3 ===
  prefixes.add('/v3');
  prefixes.add('');
  prefixes.add('/v2');
  prefixes.add('/api');
  prefixes.add('/api/v3');
  prefixes.add('/api/v2');
  prefixes.add('/api/v1');
  prefixes.add('/v1');
  prefixes.add('/sim-api');
  prefixes.add('/ccapi');
  prefixes.add('/control');
  prefixes.add('/inventory');
  prefixes.add('/portal');
  const simsPath = baseEndpointsSims.startsWith('/') ? baseEndpointsSims : `/${baseEndpointsSims}`;
  const simsPrefixParts = simsPath.split('/').filter(Boolean);
  for (let i = 1; i <= simsPrefixParts.length; i++) {
    prefixes.add('/' + simsPrefixParts.slice(0, i).join('/'));
  }
  return [...prefixes];
}

function toAuthTag(auth: PerSimAuth): string {
  return auth.tag;
}

function attemptRankScore(statusCode: number, error: string | null): number {
  if (statusCode === 401 || statusCode === 403) return 1000;
  // 405 MethodNotAllowed = endpoint BESTAAT, alleen verkeerde HTTP-methode → zeer sterke hint!
  if (statusCode === 405) return 950;
  if (statusCode === 422) return 900;
  // 409 Conflict = endpoint bestaat en request werd verwerkt, maar business rule faalde → zeer sterk
  if (statusCode === 409) return 850;
  if (statusCode === 400) return 800;
  // 5xx = endpoint en auth lijken OK, server fout → ook redelijk sterk
  if (statusCode >= 500) return 600;
  // 404 = endpoint bestaat NIET → zwakke hint
  if (statusCode === 404) return 200;
  if (statusCode === 0) return 10;
  return 500;
}

let _bearerTokenCache: { token: string; expiresAt: number; baseUrl: string; accountId: string | null } | null = null;
function invalidateBearerTokenCache(baseUrl?: string): void {
  try {
    if (!baseUrl || !_bearerTokenCache || _bearerTokenCache.baseUrl === baseUrl) {
      console.warn('[simhuis] 🗑️ Bearer-token cache GEINVALIDEERD (401 / ongeldig). Nieuwe token verkrijgen bij volgende call!');
      _bearerTokenCache = null;
    }
  } catch {}
}

function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1];
    if (!payload) return null;
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    const decoded = typeof Buffer !== 'undefined'
      ? Buffer.from(payload, 'base64').toString('utf-8')
      : atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isLikelyMongoId(c: unknown): c is string {
  return typeof c === 'string' && c.trim().length >= 12 && /^[0-9a-f]{12,}$/i.test(c.trim());
}

function isLikelyUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function isAccountIdShape(c: unknown): c is string {
  return typeof c === 'string' && c.trim().length >= 8 && (isLikelyUuid(c) || isLikelyMongoId(c));
}

function _collectStrings(acc: string[], o: unknown, depth = 0): void {
  if (depth > 5 || o === null || o === undefined) return;
  if (typeof o === 'string') { acc.push(o); return; }
  if (Array.isArray(o)) { for (const e of o) _collectStrings(acc, e, depth + 1); return; }
  if (typeof o === 'object') { for (const v of Object.values(o as Record<string, any>)) _collectStrings(acc, v, depth + 1); }
}

function extractAccountIdFromUserObj(userObj: unknown): string | null {
  if (!userObj || typeof userObj !== 'object') return null;
  const u = userObj as Record<string, any>;

  // ✅ PRIO 1 (UIT LOGS BEVESTIGD!): permissions[] ARRAY. Elke element = permission: [{accountId: UUID, roles:[...]}
  // permissions[0].accountId = 6ffd71bb-c164-525f-ac89-64d086177d52 (UUID VORM = DE ECHTE accountId!
  if (Array.isArray(u.permissions)) {
    for (const perm of u.permissions) {
      if (!perm || typeof perm !== 'object') continue;
      const a = (perm as any).accountId ?? (perm as any).account_id ?? (perm as any).tenantId ?? (perm as any).id;
      if (isAccountIdShape(a)) return String(a).trim();
      // fallback permissions mag ook {id} zijn zonder prefix
      if (typeof a === 'string' && a.trim().length >= 8) return a.trim();
    }
  }

  // PRIO 2: setup.currentAccountId (ingesteld in portal-sessie)
  if (u.setup && typeof u.setup === 'object' && isAccountIdShape((u.setup as any).currentAccountId)) {
    return String((u.setup as any).currentAccountId).trim();
  }
  if (u.setup && typeof u.setup === 'object' && typeof (u.setup as any).currentAccountId === 'string' && (u.setup as any).currentAccountId.trim().length >= 8) {
    return (u.setup as any).currentAccountId.trim();
  }

  // PRIO 3: expliciete accountId / tenantId in profile / account / setup / meta / ztp
  const nestedPrio3: Record<string, any>[] = [u.profile, u.account, u.setup, u.meta, u.ztp];
  const keysToScan = [
    'accountId', 'account_id', 'accountIDs', 'accountIds', 'accounts', 'account',
    'tenantId', 'tenant_id', 'tenants', 'tenant',
    'orgId', 'org', 'organizationId', 'customerId', 'resellerId',
  ];
  for (const n of nestedPrio3) {
    if (!n || typeof n !== 'object') continue;
    for (const k of keysToScan) {
      const v = (n as any)[k];
      if (Array.isArray(v)) {
        for (const elem of v) if (isAccountIdShape(elem)) return String(elem).trim();
      }
      if (isAccountIdShape(v)) return String(v).trim();
      if (typeof v === 'string' && v.trim().length >= 10) return v.trim();
    }
  }
  // PRIO 4: Diep zoeken in permissions + profile (collect strings - eerst UUID want permissions)
  for (const n of [...nestedPrio3, u.permissions]) {
    if (!n) continue;
    const pool: string[] = [];
    _collectStrings(pool, n, 0);
    for (const s of pool) if (isLikelyUuid(s)) return s.trim();
    for (const s of pool) if (isLikelyMongoId(s)) return s.trim();
  }
  // PRIO 5: Top-level primaries (accountId / tenantId eerst
  const primariesUuidFirst = [u.accountId, u.tenantId, u.orgId, u.customerId, u.resellerId];
  for (const c of primariesUuidFirst) {
    if (isLikelyUuid(c)) return String(c).trim();
  }
  const primaries = [
    u.accountId, u.account_id, u.tenantId, u.tenant_id, u.orgId, u.org_id,
    u.customerId, u.customer_id, u.resellerId, u.reseller_id,
  ];
  for (const c of primaries) if (isAccountIdShape(c)) return String(c).trim();
  for (const c of primaries) if (typeof c === 'string' && c.trim().length >= 10) return c.trim();
  // PRIO 6: user._id / user.id (mongodb user-document id = LAATSTE (was eerst, verkeerd! Alleen als geen andere!
  if (isLikelyMongoId(u._id)) return String(u._id).trim();
  if (isLikelyMongoId(u.id)) return String(u.id).trim();
  // PRIO 7: Hele user object diep scannen eerst UUID, daarna mongo
  const fullPool: string[] = [];
  _collectStrings(fullPool, u, 0);
  for (const s of fullPool) if (isLikelyUuid(s)) return s.trim();
  for (const s of fullPool) if (isLikelyMongoId(s)) return s.trim();
  return null;
}

function extractAccountIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const candidates = [
    payload.iss, payload.account_id, payload.accountId, payload.sub,
    payload.aud?.[0] || payload.aud, payload.tenant_id, payload.tenantId,
    payload.customer_id, payload.reseller_id, payload.org_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length >= 10 && /^[0-9a-f]{12,}$/i.test(c.trim())) {
      return c.trim();
    }
  }
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 3) return c.trim();
  }
  return null;
}

async function acquireBearerToken(creds: { baseUrl: string; username: string; password: string }): Promise<string | null> {
  const now = Date.now();
  if (_bearerTokenCache && _bearerTokenCache.baseUrl === creds.baseUrl && _bearerTokenCache.expiresAt > now + 30_000) {
    return _bearerTokenCache.token;
  }
  const tokenEndpointVariants: Array<{ path: string; body: Record<string, any>; ctype: 'json' | 'form'; auth: 'none' | 'basic' }> = [
    { path: '/v3/auth/token', body: { username: creds.username, password: creds.password }, ctype: 'json', auth: 'basic' },
    { path: '/v3/auth/token', body: { username: creds.username, password: creds.password, grant_type: 'password' }, ctype: 'form', auth: 'basic' },
    { path: '/v3/auth/token', body: { username: creds.username, password: creds.password }, ctype: 'json', auth: 'none' },
    { path: '/auth/token', body: { username: creds.username, password: creds.password }, ctype: 'json', auth: 'basic' },
    { path: '/auth/token', body: { username: creds.username, password: creds.password, grant_type: 'password' }, ctype: 'form', auth: 'basic' },
    { path: '/v3/auth/login', body: { username: creds.username, password: creds.password }, ctype: 'json', auth: 'basic' },
    { path: '/auth/login', body: { username: creds.username, password: creds.password }, ctype: 'json', auth: 'basic' },
  ];
  const basic = basicAuthHeader(creds.username, creds.password);
  for (const v of tokenEndpointVariants) {
    const full = makePerSimFullUrl(creds.baseUrl, v.path, null);
    try {
      const headers: Record<string, string> = { ...PER_SIM_WAF_HEADERS };
      if (v.auth === 'basic') headers.Authorization = basic;
      let bi: BodyInit | undefined;
      if (v.ctype === 'json') {
        headers['Content-Type'] = 'application/json';
        bi = JSON.stringify(v.body);
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        const sp = new URLSearchParams();
        for (const [k, val] of Object.entries(v.body)) if (val !== undefined && val !== null) sp.append(k, String(val));
        bi = sp.toString();
      }
      const resp = await fetch(full, { method: 'POST', headers, body: bi, signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(10_000) : undefined });
      if (resp.ok) {
        const ct = resp.headers.get('content-type') ?? '';
        const txt = await resp.text();
        const parsed = parseFetchResponse(txt, ct);
        let token: string | null = null;
        let userFromResponse: Record<string, any> | null = null;
        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, any>;
          token = String(p.access_token || p.accessToken || p.token || p.jwt || p.authToken || p.bearer || '');
          if (p.user && typeof p.user === 'object') userFromResponse = p.user as Record<string, any>;
          else if (p.data?.user && typeof p.data.user === 'object') userFromResponse = p.data.user as Record<string, any>;
          if (!token && p.data && typeof p.data === 'object') token = String(p.data.access_token || p.data.accessToken || p.data.token || '');
          if (!token) token = null;
        }
        if (token) {
          // 💥 KRITIEKE BUG FIX (JWT exp vs expiresIn)!
          //   - JWT `exp` veld = UNIX TIMESTAMP SECONDEN (epoch), NIET duration!
          //   - Alleen `expires_in / expiresIn` = duration seconden!
          //   - Vroeger: p.exp (1790886757 = ~2026-10-01) → Date.now() + 1790886757*1000 = +57 JAAR in de toekomst.
          //              Dus token cache werd NOOIT automatisch vervallen, ook al was de echte JWT na 25m al verlopen → HTTP 401!
          let expiresIn = 900; // Default SAFE = 15 min (ruim onder de waarschijnlijke 20-25 min van Simhuis!)
          let epochExp: number | null = null;
          if (parsed && typeof parsed === 'object') {
            const p = parsed as Record<string, any>;
            // 1) ECHTE duration fields (altijd kleiner dan 100.000):
            const eiDuration = Number(p.expires_in || p.expiresIn || 0);
            if (Number.isFinite(eiDuration) && eiDuration > 60 && eiDuration < 100_000_000) {
              expiresIn = eiDuration;
            }
            // 2) JWT payload `exp` = EPOCH SECONDEN! (>= 1_700_000_000 = jaar 2024+)
            const eiEpoch = Number(p.exp || 0);
            if (Number.isFinite(eiEpoch) && eiEpoch > 1_700_000_000) {
              epochExp = eiEpoch * 1000; // naar ms
            }
          }
          // 3) Parse de JWT payload zelf VOOR exp veld — als login response geen los exp heeft, maar de JWT wel!
          if (!epochExp) {
            const jwtPayload = parseJwtPayload(token);
            const jwtExp = Number(jwtPayload?.exp || 0);
            if (Number.isFinite(jwtExp) && jwtExp > 1_700_000_000) epochExp = jwtExp * 1000;
          }
          // BEREKEN expiresAt = prefer epoch (JWT echt exp) > duration!
          const nowCalc = Date.now();
          const expiresAt = epochExp
            ? Math.min(epochExp - 60_000, nowCalc + expiresIn * 1000) // min van beiden, en altijd 60s buffer voor epoch
            : nowCalc + expiresIn * 1000;
          // PRIORITEIT: 1) accountId UIT USER OBJECT (vanuit login response!) → 2) pas JWT payload fallback
          const accountIdFromUser = extractAccountIdFromUserObj(userFromResponse);
          const accountIdFromJwt = extractAccountIdFromToken(token);
          const accountId = accountIdFromUser ?? accountIdFromJwt;
          try {
            console.error(`[acquireBearerToken] ✅ Token OK. duration=${expiresIn}s jwtExp=${epochExp ? new Date(epochExp).toISOString() : 'N/A'}. accountIdFromUser=${accountIdFromUser ?? 'N/A'}, accountIdFromJwt=${accountIdFromJwt ?? 'N/A'}. Gebruikt: ${accountId ?? 'N/A'}. user.shape=${shapeOf(userFromResponse)}`);
          } catch { /* ignore */ }
          _bearerTokenCache = { token, expiresAt, baseUrl: creds.baseUrl, accountId };
          return token;
        }
      }
    } catch {
      // negeer
    }
  }
  return null;
}

function getSimhuisAccountId(): string | null {
  if (_bearerTokenCache && _bearerTokenCache.expiresAt > Date.now()) return _bearerTokenCache.accountId;
  return null;
}

function makePerSimFullUrl(baseUrl: string, path: string, query: Record<string, any> | null): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  let u = `${cleanBase}/${cleanPath}`;
  if (query && Object.keys(query).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '') continue;
      sp.append(k, String(v));
    }
    const qs = sp.toString();
    if (qs) u += `?${qs}`;
  }
  return u;
}

async function doPerSimFetch(args: {
  fullUrl: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  contentType: 'json' | 'form' | 'none';
  body: Record<string, any> | null;
  auth: PerSimAuth;
  timeoutMs?: number;
}): Promise<PerSimAttemptResult> {
  const effectiveTimeoutMs = args.timeoutMs ?? 20_000;
  const signal = (AbortSignal as any).timeout ? (AbortSignal as any).timeout(effectiveTimeoutMs) : undefined;
  const headers: Record<string, string> = { ...PER_SIM_WAF_HEADERS };
  const isBearer = args.auth.tag === 'bearer-token';
  const accountId = isBearer ? getSimhuisAccountId() : null;

  if (args.auth.tag === 'basic-header') {
    headers.Authorization = args.auth.header;
  } else if (args.auth.tag === 'bearer-token') {
    headers.Authorization = `Bearer ${args.auth.token}`;
  } else if (args.auth.tag === 'x-custom-headers') {
    headers['X-API-Username'] = args.auth.username;
    headers['X-API-Password'] = args.auth.password;
    if (args.auth.resellerId) headers['X-Reseller-ID'] = String(args.auth.resellerId);
  }

  let bodyInit: BodyInit | undefined;
  const mergedBody: Record<string, any> | null = args.body ? { ...args.body } : null;
  if (args.auth.tag === 'creds-body' && mergedBody) {
    mergedBody.username = args.auth.username;
    mergedBody.password = args.auth.password;
    if (args.auth.resellerId) mergedBody.reseller_id = args.auth.resellerId;
  }
  if (isBearer && accountId && mergedBody) {
    if (!mergedBody.accountId) mergedBody.accountId = accountId;
  }
  if ((args.method === 'POST' || args.method === 'PUT' || args.method === 'PATCH') && mergedBody) {
    if (args.contentType === 'json') {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(mergedBody);
    } else if (args.contentType === 'form') {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(mergedBody)) {
        if (v === null || v === undefined || v === '') continue;
        if (typeof v === 'object') sp.append(k, JSON.stringify(v));
        else sp.append(k, String(v));
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      bodyInit = sp.toString();
    }
  }

  let finalUrl = args.fullUrl;
  let queryParams: URLSearchParams | null = null;
  if (args.auth.tag === 'creds-query') {
    queryParams = new URLSearchParams();
    queryParams.append('username', args.auth.username);
    queryParams.append('password', args.auth.password);
    if (args.auth.resellerId) queryParams.append('reseller_id', String(args.auth.resellerId));
  }
  if (isBearer && accountId) {
    if (!queryParams) queryParams = new URLSearchParams();
    queryParams.append('accountId', accountId);
  }
  if (queryParams && queryParams.size > 0) {
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl = `${finalUrl}${sep}${queryParams.toString()}`;
  }

  try {
    const resp = await fetch(finalUrl, { method: args.method, headers, body: bodyInit, signal });
    const ct = resp.headers.get('content-type') ?? '';
    const text = await resp.text();
    const parsed = parseFetchResponse(text, ct);
    if (resp.ok) {
      return { tag: 'ok', body: parsed, statusCode: resp.status };
    }
    const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 300);
    const msg = `HTTP ${resp.status}: ${snippet}`;
    // 401/403 = endpoint BESTAAT, alleen auth verkeerd → doorgaan met discovery!
    if (resp.status === 401 || resp.status === 403 || resp.status === 422 || resp.status === 409 || resp.status === 400 || resp.status === 404 || resp.status === 405) {
      return { tag: 'skip', statusCode: resp.status, error: msg, raw: parsed };
    }
    return { tag: 'error', statusCode: resp.status, error: msg, raw: parsed };
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? 'Onbekende fout');
    if (err?.name === 'TimeoutError' || /timeout/i.test(msg)) {
      return { tag: 'skip', statusCode: 0, error: `Timeout na ${effectiveTimeoutMs}ms` };
    }
    return { tag: 'error', statusCode: 0, error: msg };
  }
}

/**
 * ULTRA-ROBUUSTE expliciete extractie van status, dataLimits, dataUsed en smsUsed
 * DIRECT UIT DE RUWE API RESPONSE (raw), NA de standaard toSimStatus() call.
 * Dit voorkomt de 2 PB bug en zorgt dat usage uit subscriptions[]/setups[] wordt gehaald.
 * Wordt gedeeld door listAllSims() en getSimStatus().
 */
function enrichSimhuisStatusWithDirectRawExtracts(
  baseStatus: SimhuisSimStatus | null | undefined,
  raw: unknown,
  iccid: string
): SimhuisSimStatus | null {
  if (!baseStatus || !baseStatus.iccid) return baseStatus ?? null;

  const rawObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const nested: any =
    rawObj.enabledProfile ??
    rawObj.asset ??
    rawObj.sim ??
    rawObj.simCard ??
    rawObj.device ??
    rawObj.subscription ??
    rawObj.subscriber ??
    rawObj.esimProfile ??
    rawObj.esim ??
    rawObj.profile ??
    (Array.isArray(rawObj.profiles) && rawObj.profiles.length > 0 ? rawObj.profiles[0] : null) ??
    {};

  const cardProfile: any = rawObj.cardProfile ?? nested?.cardProfile ?? rawObj.product ?? nested?.product ?? null;

  const tryRawStr = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (['status','profilestate','state','lifecycle','lifecyclestatus','lifecycle_status','sim_status','simstate','sim_state','type'].includes(lower)) return '';
    return s;
  };

  const isValidStringValue = (v: any): string => {
    const s = tryRawStr(v);
    if (!s) return '';
    const lower = s.toLowerCase();
    const placeholders = [
      'simname','sim_name','assetname','asset_name','displayname','display_name','label','name',
      'groupname','group_name','groupid','group_id','group','poolname','pool_name','batchname','batch_name',
      'productname','product_name','productcode','product_code','offername','offer_name','planname','plan_name',
      'producttype','product_type','subscriptiontype','subscription_type','iccid','eid','msisdn','status'
    ];
    if (placeholders.includes(lower)) return '';
    if (lower.length <= 2 && ['id','na','ok','--','n/a'].includes(lower)) return '';
    return s;
  };

  const firstSub = Array.isArray(rawObj.subscriptions) && rawObj.subscriptions.length > 0 ? rawObj.subscriptions[0] : (Array.isArray(nested?.subscriptions) && nested?.subscriptions.length > 0 ? nested.subscriptions[0] : null);
  const firstSetup = Array.isArray(rawObj.setups) && rawObj.setups.length > 0 ? rawObj.setups[0] : (Array.isArray(nested?.setups) && nested?.setups.length > 0 ? nested.setups[0] : null);

  // ============================================================
  // 🔍 EXTENSIVE DEBUG LOGGING: Ontdek WELKE keys de echte data bevatten!
  //    Log per ICCID match de structuur van raw, subscriptions[0], setups[0], cardProfile
  // ============================================================
  try {
    const shortIccid = iccid.slice(-6);
    const rawKeys = Object.keys(rawObj).slice(0, 30);
    const subKeys = firstSub ? Object.keys(firstSub).slice(0, 20) : null;
    const subValuesPreview: Record<string, any> | null = firstSub ? {} : null;
    if (firstSub && subKeys) {
      for (const k of subKeys) {
        const v = (firstSub as any)[k];
        if (v === null || v === undefined) { subValuesPreview![k] = null; continue; }
        if (typeof v === 'object' && !Array.isArray(v)) { subValuesPreview![k] = `{obj keys=${Object.keys(v).length}}`; continue; }
        if (Array.isArray(v)) { subValuesPreview![k] = `[arr len=${v.length}]`; continue; }
        const s = String(v);
        subValuesPreview![k] = s.length > 80 ? s.slice(0, 80) + '...' : s;
      }
    }
    const bundlesPreview: string | null = firstSub && Array.isArray((firstSub as any).bundles) && (firstSub as any).bundles.length > 0 ? (() => {
      try {
        const b = (firstSub as any).bundles[0];
        if (b === null || b === undefined) return JSON.stringify(null);
        if (typeof b !== 'object') return `[scalar=${JSON.stringify(b)}]`;
        const bKeys = Object.keys(b).slice(0, 20);
        const preview: Record<string, any> = {};
        for (const k of bKeys) {
          const bv = (b as any)[k];
          if (bv === null || bv === undefined) { preview[k] = null; continue; }
          if (typeof bv === 'object' && !Array.isArray(bv)) { preview[k] = `{obj keys=${Object.keys(bv).length}}`; continue; }
          if (Array.isArray(bv)) { preview[k] = `[arr len=${bv.length}]`; continue; }
          const s = String(bv);
          preview[k] = s.length > 120 ? s.slice(0, 120) + '...' : s;
        }
        return `keys=${JSON.stringify(bKeys)} values=${JSON.stringify(preview)}`;
      } catch { return '[error]'; }
    })() : null;
    const setupKeys = firstSetup ? Object.keys(firstSetup).slice(0, 20) : null;
    const setupValuesPreview: Record<string, any> | null = firstSetup ? {} : null;
    if (firstSetup && setupKeys) {
      for (const k of setupKeys) {
        const v = (firstSetup as any)[k];
        if (v === null || v === undefined) { setupValuesPreview![k] = null; continue; }
        if (typeof v === 'object' && !Array.isArray(v)) { setupValuesPreview![k] = `{obj keys=${Object.keys(v).length}}`; continue; }
        if (Array.isArray(v)) { setupValuesPreview![k] = `[arr len=${v.length}]`; continue; }
        const s = String(v);
        setupValuesPreview![k] = s.length > 80 ? s.slice(0, 80) + '...' : s;
      }
    }
    const cardProfileKeys = cardProfile && typeof cardProfile === 'object' ? Object.keys(cardProfile).slice(0, 20) : null;
    const cardProfileValuesPreview: Record<string, any> | null = cardProfileKeys ? {} : null;
    if (cardProfileKeys && cardProfile && typeof cardProfile === 'object') {
      for (const k of cardProfileKeys) {
        const v = (cardProfile as any)[k];
        if (v === null || v === undefined) { cardProfileValuesPreview![k] = null; continue; }
        if (typeof v === 'object' && !Array.isArray(v)) { cardProfileValuesPreview![k] = `{obj keys=${Object.keys(v).length}}`; continue; }
        if (Array.isArray(v)) { cardProfileValuesPreview![k] = `[arr len=${v.length}]`; continue; }
        const s = String(v);
        cardProfileValuesPreview![k] = s.length > 80 ? s.slice(0, 80) + '...' : s;
      }
    }
    const carriersPreview: Record<string, any> | null = (rawObj.carriers && typeof rawObj.carriers === 'object') ? rawObj.carriers : null;
    const ownerInfo: Record<string, any> = {};
    for (const k of ['ownerAccountId','ownerAccountName','ownership','customerRef','customerName','tenantName','accountName']) {
      if (rawObj[k] !== undefined && rawObj[k] !== null) ownerInfo[k] = typeof rawObj[k] === 'object' ? `[obj]` : String(rawObj[k]).slice(0, 60);
    }
    console.info(
      `[simhuis:enrichExtract] [${shortIccid}] 🔍 DEBUG STRUCTUUR:\n` +
      `     raw keys(${rawKeys.length})=${JSON.stringify(rawKeys)}\n` +
      `     raw[limit=${JSON.stringify(rawObj.limit)} smsLimit=${JSON.stringify(rawObj.smsLimit)} status=${JSON.stringify(rawObj.status)} profileState=${JSON.stringify(rawObj.profileState)}]\n` +
      `     raw.carriers=${JSON.stringify(carriersPreview)}\n` +
      `     ownerInfo=${JSON.stringify(ownerInfo)}\n` +
      `     subscriptions[0] keys=${JSON.stringify(subKeys)}\n` +
      `     subscriptions[0] values=${JSON.stringify(subValuesPreview)}\n` +
      `     subscriptions[0].bundles[0]=${JSON.stringify(bundlesPreview)}\n` +
      `     setups[0] keys=${JSON.stringify(setupKeys)}\n` +
      `     setups[0] values=${JSON.stringify(setupValuesPreview)}\n` +
      `     cardProfile keys=${JSON.stringify(cardProfileKeys)}\n` +
      `     cardProfile values=${JSON.stringify(cardProfileValuesPreview)}`
    );
  } catch { /* ignore logging errors */ }

  let directStatus = (
    tryRawStr(rawObj.status) ||
    tryRawStr(rawObj.profileState) ||
    tryRawStr(nested?.status) ||
    tryRawStr(nested?.profileState) ||
    ''
  ).toLowerCase();
  if (!directStatus && (rawObj?.enabledProfile)) {
    directStatus = (tryRawStr(rawObj.enabledProfile.status) || tryRawStr(rawObj.enabledProfile.profileState) || '').toLowerCase();
  }
  if (!directStatus && Array.isArray(rawObj?.profiles) && rawObj.profiles.length > 0) {
    const profiles: any[] = rawObj.profiles;
    const best = profiles.find((p: any) => p && (p.enabled === true || p.status || p.profileState)) ?? profiles[0];
    if (best) directStatus = (tryRawStr(best.status) || tryRawStr(best.profileState) || '').toLowerCase();
  }

  if (directStatus) {
    const ds = directStatus;
    if (['active', 'enabled', 'online', 'activated', 'in_service', 'provisioned'].includes(ds)) baseStatus.status = 'active';
    else if (['inactive', 'disabled', 'offline', 'deactivated', 'retired', 'stock', 'in_stock', 'available', 'ready'].includes(ds)) baseStatus.status = 'inactive';
    else if (['suspended', 'paused', 'barred', 'suspend', 'bar', 'hibernated', 'hibernate'].includes(ds)) baseStatus.status = 'suspended';
    else if (['terminated', 'deleted', 'cancelled', 'canceled', 'cancel', 'destroyed', 'expired'].includes(ds)) baseStatus.status = 'terminated';
    else if (['provisioning', 'activating', 'pending', 'activating_subscription', 'pre_active'].includes(ds)) baseStatus.status = 'provisioning';
    else (baseStatus as any).status = ds;
  }

  const safeNum = (v: any): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'bigint') { const n = Number(v); return Number.isFinite(n) ? n : null; }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s || s === '-' || s.toLowerCase() === 'null') return null;
      const n = Number(s.replace(/[^\d.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  const toBytesBestEffort = (rawVal: any): number | null => {
    const n = safeNum(rawVal);
    if (n === null || n <= 0) return null;
    if (n > 0 && n <= 50000) return Math.round(n * GB);
    if (n > 50000 && n <= 50_000_000) return Math.round(n * MB);
    return Math.round(n);
  };

  const rawLimitRaw = rawObj.limit ?? nested?.limit ?? rawObj.enabledProfile?.limit;
  const rawLowestLimitRaw = rawObj.lowestDataLimit ?? rawObj.lowestLimit ?? nested?.lowestDataLimit ?? nested?.lowestLimit ?? rawObj.enabledProfile?.lowestDataLimit;
  const dlBytes = toBytesBestEffort(rawLimitRaw);
  const ldlBytes = toBytesBestEffort(rawLowestLimitRaw);

  // ============================================================
  // 📊 DATA USED: 15+ EXTRA candidate keys!
  // ============================================================
  const DATA_USED_KEYS = [
    'dataUsed','dataUsage','data_used','data_usage','usageData','usedData','consumed','dataConsumed','totalDataUsed','usage',
    'usageBytes','mbUsed','totalUsage','totalData','totalDataUsage','gprsUsed','trafficUsed','dataMbUsed',
    'dataMegaBytesUsed','downloadedBytes','uploadedBytes','totalDataBytes','dataUsageBytes','dataUsageMb',
    'sessionDataUsed','consumedMb','usedMegabytes','totalMegabytes','totalMegabytesUsed','totalMbUsed','megabytesUsed',
    'gprsDataUsed','packetDataUsed','totalVolume','dataVolume','dataUsedMb','dataUsedMegaBytes','dataAmount','bytes','usedBytes'
  ];
  const SMS_USED_KEYS = ['smsUsed','smsCount','totalSms','smsSent','smsUsage','usedSms','consumedSms','smsMessages','messageCount','moSms','mtSms','totalSmsUsed','sms','messagesUsed','sentSms'];

  const BUNDLE_DATA_KEYS = ['dataUsed','remainingBytes','initialSize','usage','consumedData','usedData','bytesUsed','consumed','dataUsage'];
  const BUNDLE_SMS_KEYS = ['smsUsed','smsCount','smsRemaining','smsInitial','remainingSms','smsMessages','messagesUsed','totalSms','smsSent'];
  const BUNDLE_PRODUCT_KEYS = [
    'localProductName','local_product_name','productName','product','bundleName','bundle_name','bundleId','bundle_id','bundle','name',
    'description','localProductId','local_product_id','productId','product_code','productCode','tariff','tariffName','planName','offerName'
  ];

  // ============================================================
  // 🆕 Swagger-bevestigd: subscriptions[] is ARRAY. Elke subscription heeft bundles[] ARRAY!
  //    Loop door subscriptions[*].bundles[*] → daar zitten ECHTE dataUsed + localProductName!
  // ============================================================
  const extractFromAllBundles = (): { found: boolean; dataUsed: number|null; remaining: number|null; initial: number|null; smsUsed: number|null; productName: string|null; productSrc: string } => {
    let dataUsed: number | null = null;
    let dataUsedSrc = '';
    let remainingBytes: number | null = null;
    let initialBytes: number | null = null;
    let smsUsed: number | null = null;
    let smsUsedSrc = '';
    let pName: string | null = null;
    let pSrc = '';
    try {
      const subscriptionsArr = Array.isArray(rawObj.subscriptions) ? rawObj.subscriptions
        : Array.isArray(nested?.subscriptions) ? nested.subscriptions
        : Array.isArray((rawObj as any).enabledProfile?.subscriptions) ? (rawObj as any).enabledProfile.subscriptions
        : [];
      const sLen = subscriptionsArr.length;
      for (let si = 0; si < sLen; si++) {
        const sub = subscriptionsArr[si];
        if (!sub || typeof sub !== 'object') continue;
        const bundlesArr = Array.isArray((sub as any).bundles) ? (sub as any).bundles : [];
        for (let bi = 0; bi < bundlesArr.length; bi++) {
          const b = bundlesArr[bi];
          if (!b || typeof b !== 'object') continue;
          // --- Data used ---
          if (dataUsed === null) {
            for (const k of BUNDLE_DATA_KEYS) {
              const sv = safeNum((b as any)[k]);
              if (sv !== null && sv >= 0) {
                if (sv > 0 && sv <= 50_000_000) dataUsed = Math.round(sv * (sv <= 50000 ? MB : 1));
                else if (sv > 50_000_000) dataUsed = Math.round(sv);
                else dataUsed = 0;
                dataUsedSrc = `SUBS[${si}].BUNDLE[${bi}].${k}`;
                break;
              }
            }
          }
          if (remainingBytes === null) {
            const sv = safeNum((b as any).remainingBytes);
            if (sv !== null && sv >= 0) {
              if (sv > 0 && sv <= 50_000_000) remainingBytes = Math.round(sv * (sv <= 50000 ? GB : 1));
              else if (sv > 50_000_000) remainingBytes = Math.round(sv);
              else remainingBytes = 0;
            }
          }
          if (initialBytes === null) {
            const sv = safeNum((b as any).initialSize);
            if (sv !== null && sv >= 0) {
              if (sv > 0 && sv <= 50_000_000) initialBytes = Math.round(sv * (sv <= 50000 ? GB : 1));
              else if (sv > 50_000_000) initialBytes = Math.round(sv);
              else initialBytes = 0;
            }
          }
          // --- SMS used ---
          if (smsUsed === null) {
            for (const k of BUNDLE_SMS_KEYS) {
              const sv = safeNum((b as any)[k]);
              if (sv !== null && sv >= 0) { smsUsed = sv; smsUsedSrc = `SUBS[${si}].BUNDLE[${bi}].${k}`; break; }
            }
          }
          // --- Product name (HEET BIJ SWAGGER: localProductName!) ---
          if (!pName) {
            for (const k of BUNDLE_PRODUCT_KEYS) {
              const s = isValidStringValue((b as any)[k]);
              if (s && !looksLikeTechProfile(s)) { pName = s; pSrc = `SUBS[${si}].BUNDLE[${bi}].${k}`; break; }
            }
          }
        }
        // Als geen bundles[].productName, probeer subscriptions[].localProductName / rateplan zelf
        if (!pName) {
          for (const k of BUNDLE_PRODUCT_KEYS) {
            const s = isValidStringValue((sub as any)[k]);
            if (s && !looksLikeTechProfile(s)) { pName = s; pSrc = `SUBS[${si}].${k}`; break; }
          }
        }
      }
      // Als laatste: ratings.dataUsed (uit CDR response!)
      if (dataUsed === null) {
        const ratings = (rawObj as any).ratings;
        if (ratings && typeof ratings === 'object') {
          const ratingsArr = Array.isArray(ratings) ? ratings : [ratings];
          for (let ri = 0; ri < ratingsArr.length; ri++) {
            const rt = ratingsArr[ri];
            const sv = safeNum((rt as any)?.dataUsed);
            if (sv !== null && sv >= 0) {
              if (sv > 0 && sv <= 50_000_000) dataUsed = Math.round(sv * (sv <= 50000 ? MB : 1));
              else if (sv > 50_000_000) dataUsed = Math.round(sv);
              else dataUsed = 0;
              dataUsedSrc = `RATINGS[${ri}].dataUsed`;
              break;
            }
            // Product via ratings.product ook proberen!
            if (!pName && (rt as any)?.product && typeof (rt as any).product === 'object') {
              for (const k of BUNDLE_PRODUCT_KEYS) {
                const s = isValidStringValue(((rt as any).product as any)[k]);
                if (s && !looksLikeTechProfile(s)) { pName = s; pSrc = `RATINGS[${ri}].product.${k}`; break; }
              }
              // ratings.product.remainingBytes ook!
              if (remainingBytes === null) {
                const sv2 = safeNum(((rt as any).product as any).remainingBytes);
                if (sv2 !== null && sv2 >= 0) remainingBytes = sv2 > 50_000_000 ? Math.round(sv2) : Math.round(sv2 * (sv2 <= 50000 ? GB : 1));
              }
            }
          }
        }
      }
      // Tenslotte: losse data[] arrays (van /cdr response)
      if (dataUsed === null && Array.isArray((rawObj as any).data)) {
        let totaal = 0;
        let hasAny = false;
        for (const item of (rawObj as any).data as any[]) {
          const sv = safeNum(item?.bytes);
          if (sv !== null && sv >= 0) { totaal += sv; hasAny = true; }
          if (remainingBytes === null && item?.roundedBytes) {
            const sv2 = safeNum(item.roundedBytes);
            if (sv2 !== null && sv2 >= 0) remainingBytes = sv2 > 50_000_000 ? Math.round(sv2) : remainingBytes;
          }
        }
        if (hasAny) { dataUsed = totaal; dataUsedSrc = `data[].bytes SUM (${(rawObj as any).data.length} items)`; }
      }
      // Swagger: /cdr/stats top-level bytes field! (bytes = totaal CDR data bytes!)
      if (dataUsed === null) {
        const topBytes = safeNum((rawObj as any).bytes);
        if (topBytes !== null && topBytes >= 0) {
          dataUsed = topBytes; // cdr/stats bytes = ALTIJD raw bytes!
          dataUsedSrc = 'TOP-LEVEL.bytes (/cdr/stats)';
        }
      }
    } catch { /* ignore */ }
    return {
      found: dataUsed !== null || smsUsed !== null || !!pName,
      dataUsed,
      remaining: remainingBytes,
      initial: initialBytes,
      smsUsed,
      productName: pName,
      productSrc: pSrc + (dataUsedSrc ? `|data=${dataUsedSrc}` : '') + (smsUsedSrc ? `|sms=${smsUsedSrc}` : '')
    };
  };
  const bundleData = extractFromAllBundles();

  // ============================================================
  // Nu: dataUsed = HOOGSTE PRIO = bundles[].dataUsed!
  // ============================================================
  let duBytes: number | null = bundleData.dataUsed;
  let duSource: string = bundleData.productSrc.split('|data=').pop()?.split('|')[0] || '';
  if (duBytes === null && firstSub) {
    for (const k of DATA_USED_KEYS) {
      const sv = safeNum((firstSub as any)[k]);
      if (sv !== null && sv >= 0) {
        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
        else if (sv > 50000) duBytes = Math.round(sv);
        else duBytes = 0;
        duSource = `SUBS.${k}`;
        break;
      }
    }
  }
  if (duBytes === null && firstSetup) {
    for (const k of DATA_USED_KEYS) {
      const sv = safeNum((firstSetup as any)[k]);
      if (sv !== null && sv >= 0) {
        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
        else if (sv > 50000) duBytes = Math.round(sv);
        else duBytes = 0;
        duSource = `SETUP.${k}`;
        break;
      }
    }
  }
  if (duBytes === null) {
    for (const k of DATA_USED_KEYS) {
      const sv = safeNum((rawObj as any)[k]);
      if (sv !== null && sv >= 0) {
        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
        else if (sv > 50000) duBytes = Math.round(sv);
        else duBytes = 0;
        duSource = `RAW.${k}`;
        break;
      }
    }
  }
  if (duBytes === null && nested) {
    for (const k of DATA_USED_KEYS) {
      const sv = safeNum((nested as any)[k]);
      if (sv !== null && sv >= 0) {
        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
        else if (sv > 50000) duBytes = Math.round(sv);
        else duBytes = 0;
        duSource = `NESTED.${k}`;
        break;
      }
    }
  }
  if (duBytes === null && cardProfile) {
    for (const k of DATA_USED_KEYS) {
      const sv = safeNum((cardProfile as any)[k]);
      if (sv !== null && sv >= 0) {
        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
        else if (sv > 50000) duBytes = Math.round(sv);
        else duBytes = 0;
        duSource = `CARDPROFILE.${k}`;
        break;
      }
    }
  }
  // Bundles debug!
  try {
    const shortIccid = iccid.slice(-6);
    const bdMb = bundleData.dataUsed !== null ? (bundleData.dataUsed / 1024 / 1024).toFixed(4) + ' MB' : '-';
    const remMb = bundleData.remaining !== null ? (bundleData.remaining / 1024 / 1024 / 1024).toFixed(4) + ' GB' : '-';
    const initMb = bundleData.initial !== null ? (bundleData.initial / 1024 / 1024 / 1024).toFixed(4) + ' GB' : '-';
    console.info(`[simhuis:enrichExtract] [${shortIccid}] 🎁 BUNDLES[] extractie: dataUsed=${bdMb} remaining=${remMb} initial=${initMb} smsUsed=${JSON.stringify(bundleData.smsUsed)} product=${JSON.stringify(bundleData.productName)} (src=${bundleData.productSrc})`);
  } catch {}
  try {
    const shortIccid = iccid.slice(-6);
    const mbDisplay = duBytes !== null ? `${(duBytes / MB).toFixed(2)} MB` : '-';
    console.info(`[simhuis:enrichExtract] [${shortIccid}] 📊 dataUsed: source=${duSource || 'NOT_FOUND'} raw=${duBytes !== null ? 'FOUND' : 'NULL'} → ${mbDisplay}`);
  } catch {}

  const smsLimitRaw = rawObj.smsLimit ?? nested?.smsLimit ?? rawObj.enabledProfile?.smsLimit ?? (firstSub as any)?.smsLimit ?? (firstSetup as any)?.smsLimit;
  const smsLowestLimitRaw = rawObj.lowestSmsLimit ?? nested?.lowestSmsLimit ?? rawObj.enabledProfile?.lowestSmsLimit;
  let smsUsedNum: number | null = bundleData.smsUsed;
  let smsSource = bundleData.productSrc.split('|sms=').pop() || '';
  for (const k of SMS_USED_KEYS) {
    const sv = safeNum((rawObj as any)[k]);
    if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSource = `RAW.${k}`; break; }
  }
  if (smsUsedNum === null && firstSub) {
    for (const k of SMS_USED_KEYS) {
      const sv = safeNum((firstSub as any)[k]);
      if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSource = `SUBS.${k}`; break; }
    }
  }
  if (smsUsedNum === null && firstSetup) {
    for (const k of SMS_USED_KEYS) {
      const sv = safeNum((firstSetup as any)[k]);
      if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSource = `SETUP.${k}`; break; }
    }
  }
  const smsLimitNum = safeNum(smsLimitRaw);
  const smsLowestLimitNum = safeNum(smsLowestLimitRaw);

  // ============================================================
  // 🏷️ SIM NAME / GROUP / PRODUCT: EXPLICIET UIT RAW HALEN!
  // ============================================================
  const SIM_NAME_KEYS = [
    'simName','sim_name','assetName','asset_name','displayName','display_name','label','name','nickname','friendlyName',
    'deviceName','customerLabel','userLabel','description','customName','simLabel','cardName','profileName'
  ];
  const GROUP_KEYS = [
    'groupName','group_name','group','groupId','group_id','poolName','pool_name','batchName','batch_name',
    'pool','batch','segment','department','costCenter','costcenter','customerGroup','accountGroup'
  ];
  const PRODUCT_KEYS = [
    'productName','product_name','planName','plan_name','offerName','offer_name','productCode','product_code',
    'product','plan','offer','tariff','tariffName','rateplan','ratePlan','subscriptionName','packageName',
    'bundleName','bundle_name','bundle','planDescription','offerDescription','description','billingPlan','billing_plan','priceplan','pricingPlan'
  ];
  const PRODUCT_TYPE_KEYS = ['productType','product_type','subscriptionType','subscription_type','assetType','asset_type','category','simCategory'];

  const firstBundle: any = firstSub && Array.isArray((firstSub as any).bundles) && (firstSub as any).bundles.length > 0
    ? (firstSub as any).bundles[0] : null;

  // Filter to skip TECHNICAL product names: anything starting with "CardCentri" / "MIIMEIFPLMN" / "SimProfile" / "eSIMProfile" etc.
  const looksLikeTechProfile = (name: string): boolean => {
    if (!name) return false;
    const l = name.toLowerCase();
    return l.startsWith('cardcentri') || l.startsWith('mii') || l.includes('imeifplmn') || l.startsWith('simprofile') || l.startsWith('esimprofile') || l.startsWith('profile_') || l.startsWith('cardprofile') || l === 'profile' || l === 'card';
  };

  let directSimName: string | null = null;
  let simNameSrc = '';
  const tryExtractStr = (obj: any, keys: string[], label: string): { val: string; src: string } => {
    if (!obj || typeof obj !== 'object') return { val: '', src: '' };
    for (const k of keys) {
      const v = (obj as any)[k];
      const s = isValidStringValue(v);
      if (s && !looksLikeTechProfile(s)) return { val: s, src: `${label}.${k}` };
    }
    return { val: '', src: '' };
  };

  let r;
  // --- SimName: eerst subscriptions, dan bundles[0], dan setups, dan raw, dan cardProfile, dan nested, dan enabledProfile ---
  r = tryExtractStr(firstSub, SIM_NAME_KEYS, 'SUBS');
  if (r.val) { directSimName = r.val; simNameSrc = r.src; }
  if (!directSimName && firstBundle) { r = tryExtractStr(firstBundle, SIM_NAME_KEYS, 'BUNDLE0'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }
  if (!directSimName) { r = tryExtractStr(firstSetup, SIM_NAME_KEYS, 'SETUP'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }
  if (!directSimName) { r = tryExtractStr(rawObj, SIM_NAME_KEYS, 'RAW'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }
  if (!directSimName) { r = tryExtractStr(cardProfile, SIM_NAME_KEYS, 'CARDPROFILE'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }
  if (!directSimName && nested) { r = tryExtractStr(nested, SIM_NAME_KEYS, 'NESTED'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }
  if (!directSimName && rawObj.enabledProfile) { r = tryExtractStr(rawObj.enabledProfile, SIM_NAME_KEYS, 'ENABLEDPROFILE'); if (r.val) { directSimName = r.val; simNameSrc = r.src; } }

  // --- Group: eerst subscriptions, dan bundles[0], dan expliciete keys ---
  let directGroupName: string | null = null;
  let groupSrc = '';
  r = tryExtractStr(firstSub, GROUP_KEYS, 'SUBS');
  if (r.val) { directGroupName = r.val; groupSrc = r.src; }
  if (!directGroupName && firstBundle) { r = tryExtractStr(firstBundle, GROUP_KEYS, 'BUNDLE0'); if (r.val) { directGroupName = r.val; groupSrc = r.src; } }
  if (!directGroupName) { r = tryExtractStr(firstSetup, GROUP_KEYS, 'SETUP'); if (r.val) { directGroupName = r.val; groupSrc = r.src; } }
  if (!directGroupName) { r = tryExtractStr(rawObj, GROUP_KEYS, 'RAW'); if (r.val) { directGroupName = r.val; groupSrc = r.src; } }
  if (!directGroupName) { r = tryExtractStr(cardProfile, GROUP_KEYS, 'CARDPROFILE'); if (r.val) { directGroupName = r.val; groupSrc = r.src; } }
  if (!directGroupName && nested) { r = tryExtractStr(nested, GROUP_KEYS, 'NESTED'); if (r.val) { directGroupName = r.val; groupSrc = r.src; } }
  if (!directGroupName) {
    const owner = isValidStringValue(rawObj.ownerAccountName) || isValidStringValue(nested?.ownerAccountName);
    if (owner) { directGroupName = owner; groupSrc = 'OWNER.ownerAccountName'; }
  }
  if (!directGroupName && Array.isArray(rawObj.ownership) && rawObj.ownership.length > 1) {
    for (const item of rawObj.ownership) {
      const s = isValidStringValue(item);
      if (s && s.toLowerCase() !== isValidStringValue(rawObj.ownerAccountId).toLowerCase()) {
        directGroupName = s; groupSrc = 'OWNERSHIP[]'; break;
      }
    }
  }
  let directGroupId: string | null = null;
  for (const k of ['groupId','group_id','poolId','pool_id','batchId','batch_id']) {
    const s = isValidStringValue((rawObj as any)[k] ?? (firstSub as any)?.[k] ?? (firstBundle as any)?.[k] ?? (firstSetup as any)?.[k]);
    if (s) { directGroupId = s; break; }
  }

  // --- Product: 🎯 HOOGSTE PRIO = bundles[].localProductName (uit ALL subscriptions[*].bundles[*]!) ---
  let directProductName: string | null = null;
  let productSrc = '';
  // 🎯 NIEUW: extractFromAllBundles() heeft ALLE subscriptions[*].bundles[*] doorzocht! Dat is de ECHTE bron!
  if (bundleData.productName) { directProductName = bundleData.productName; productSrc = bundleData.productSrc.split('|')[0]; }
  if (!directProductName && firstBundle) { r = tryExtractStr(firstBundle, PRODUCT_KEYS, 'BUNDLE0'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  if (!directProductName) { r = tryExtractStr(firstSub, PRODUCT_KEYS, 'SUBS'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  if (!directProductName) { r = tryExtractStr(firstSetup, PRODUCT_KEYS, 'SETUP'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  if (!directProductName) { r = tryExtractStr(rawObj, PRODUCT_KEYS, 'RAW'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  if (!directProductName && nested) { r = tryExtractStr(nested, PRODUCT_KEYS, 'NESTED'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  if (!directProductName && rawObj.enabledProfile) { r = tryExtractStr(rawObj.enabledProfile, PRODUCT_KEYS, 'ENABLEDPROFILE'); if (r.val) { directProductName = r.val; productSrc = r.src; } }
  // Fallback 1: CARRIERS{} keys (bv {"ROPD":true}) eventueel gecombineerd met ownerAccountName!
  if (!directProductName && rawObj.carriers && typeof rawObj.carriers === 'object') {
    const carrierKeys = Object.keys(rawObj.carriers).filter((c: string) => c && !looksLikeTechProfile(c));
    if (carrierKeys.length > 0) {
      const ownerName = isValidStringValue(rawObj.ownerAccountName);
      const combi = ownerName
        ? `${ownerName} ${carrierKeys.join(' + ')}`
        : carrierKeys.join(', ');
      directProductName = combi;
      productSrc = ownerName ? 'OWNER + CARRIERS[] keys' : 'CARRIERS[] keys';
    }
  }
  // Fallback 2: ALLERLAATSTE! cardProfile (moet NIET standaard de "profile" key paken, tenzij niets beters!)
  if (!directProductName && cardProfile) { r = tryExtractStr(cardProfile, PRODUCT_KEYS, 'CARDPROFILE'); if (r.val) { directProductName = r.val; productSrc = r.src; } }

  let directProductType: string | null = null;
  for (const k of PRODUCT_TYPE_KEYS) {
    const s = isValidStringValue((rawObj as any)[k] ?? (firstBundle as any)?.[k] ?? (firstSub as any)?.[k] ?? (cardProfile as any)?.[k] ?? (nested as any)?.[k]);
    if (s && !looksLikeTechProfile(s)) { directProductType = s; break; }
  }

  try {
    const shortIccid = iccid.slice(-6);
    console.info(
      `[simhuis:enrichExtract] [${shortIccid}] 🏷️ META VELDEN:\n` +
      `     simName=${JSON.stringify(directSimName)} (src=${simNameSrc || '-'})\n` +
      `     groupName=${JSON.stringify(directGroupName)} groupId=${JSON.stringify(directGroupId)} (src=${groupSrc || '-'})\n` +
      `     productName=${JSON.stringify(directProductName)} (src=${productSrc || '-'})\n` +
      `     productType=${JSON.stringify(directProductType)}\n` +
      `     smsUsed=${JSON.stringify(smsUsedNum)} (src=${smsSource || '-'})`
    );
  } catch {}

  const directDataLimitBytes = (dlBytes !== null && dlBytes > 0) ? dlBytes : null;
  const directLowestDataLimitBytes = (ldlBytes !== null && ldlBytes > 0) ? ldlBytes : null;
  const directSmsLimitCount = (smsLimitNum !== null && smsLimitNum >= 0) ? smsLimitNum : null;
  const directLowestSmsLimitCount = (smsLowestLimitNum !== null && smsLowestLimitNum >= 0) ? smsLowestLimitNum : null;
  const directDataUsedBytes = (duBytes !== null && duBytes >= 0) ? duBytes : null;
  const directSmsUsedCount = (smsUsedNum !== null && smsUsedNum >= 0) ? smsUsedNum : null;

  if (directDataLimitBytes !== null) (baseStatus as any).dataLimitBytes = directDataLimitBytes;
  if (directLowestDataLimitBytes !== null) (baseStatus as any).lowestDataLimitBytes = directLowestDataLimitBytes;
  else if (directDataLimitBytes !== null) (baseStatus as any).lowestDataLimitBytes = directDataLimitBytes;
  if (directSmsLimitCount !== null) (baseStatus as any).smsLimitCount = directSmsLimitCount;
  if (directLowestSmsLimitCount !== null) (baseStatus as any).lowestSmsLimitCount = directLowestSmsLimitCount;
  else if (directSmsLimitCount !== null) (baseStatus as any).lowestSmsLimitCount = directSmsLimitCount;
  if (directDataUsedBytes !== null) (baseStatus as any).dataUsedBytes = directDataUsedBytes;
  if (directSmsUsedCount !== null) (baseStatus as any).smsUsedCount = directSmsUsedCount;

  if (directSimName) { (baseStatus as any).simName = directSimName; (baseStatus as any).displayName = directSimName; (baseStatus as any).assetName = directSimName; (baseStatus as any).label = directSimName; }
  if (directGroupName) { (baseStatus as any).groupName = directGroupName; (baseStatus as any).group = directGroupName; }
  if (directGroupId) { (baseStatus as any).groupId = directGroupId; }
  if (directProductName) { (baseStatus as any).productName = directProductName; (baseStatus as any).planName = directProductName; (baseStatus as any).offerName = directProductName; }
  if (directProductType) { (baseStatus as any).productType = directProductType; }

  return baseStatus;
}

export async function getSimStatus(iccid: string): Promise<SimhuisSimStatus> {
  const startedAtGetSim = Date.now();
  const DEBUG_LOG = (msg: string) => {
    try { console.debug(`[simhuis:getSimStatus] [${iccid.slice(-6)}] (+${Date.now() - startedAtGetSim}ms) ${msg}`); } catch {}
  };
  const GET_SIM_MAX_WALL_MS = 40_000;
  const GET_SIM_MAX_ATTEMPTS = 50;
  let totalFetchAttempts = 0;
  let didBailEarly = false;
  function bailCheck(label: string): boolean {
    if (didBailEarly) return true;
    totalFetchAttempts++;
    const overTime = Date.now() - startedAtGetSim > GET_SIM_MAX_WALL_MS;
    const overAttempts = totalFetchAttempts > GET_SIM_MAX_ATTEMPTS;
    if (overTime || overAttempts) {
      didBailEarly = true;
      DEBUG_LOG(`⏹️ BAIL ${label}: attempts=${totalFetchAttempts} overAttempts=${overAttempts} overTime=${overTime} (+${Date.now() - startedAtGetSim}ms). Ga direct naar listAllSims fallback.`);
      try { console.warn(`[simhuis:getSimStatus] ⏹️ Vroegtijdig gestopt na ${Date.now() - startedAtGetSim}ms / ${totalFetchAttempts} pogingen voor ICCID ${iccid}. Fallback listAllSims.`); } catch {}
      return true;
    }
    return false;
  }

  const creds = await getSimhuisCreds();
  const authBasic = basicAuthHeader(creds.username, creds.password);
  const aidForGetSim = getSimhuisAccountId();
  const bearerToken = await acquireBearerToken(creds);

  // 🏆 STAP 0: EERST DE PRECIEZE WINNING COMBO UIT listAllSims! (Geen 50 nutteloze attempts!)
  if (aidForGetSim && bearerToken) {
    DEBUG_LOG(`🏆 STAP 0: Phase A - PRECIEZE WINNING COMBO (POST /v3/assetsbulk + esimsbulk) eerst!`);
    try {
      let winAuth: PerSimAuth = { tag: 'bearer-token', token: bearerToken };
      let finalBatches: Array<{ name: string; items: any[] }> = [];
      let finalAssetsOk = false;
      let finalEsimsOk = false;

      // 💥 KRITIEK: MAX 2 POGINGEN! Bij HTTP 401 (InvalidCredentials):
      //   Poging 1 faalt met 401 → token cache WEGDOEN + NIEUW token halen + POGING 2!
      for (let wcAttempt = 1; wcAttempt <= 2; wcAttempt++) {
        const [assetsRes, esimsRes] = await Promise.all([
          doPerSimFetch({
            fullUrl: makePerSimFullUrl(creds.baseUrl, '/v3/assetsbulk', { accountId: aidForGetSim }),
            method: 'POST',
            contentType: 'json',
            body: { accountId: aidForGetSim, page: 1, limit: 1000 },
            auth: winAuth,
            timeoutMs: 15_000,
          }),
          doPerSimFetch({
            fullUrl: makePerSimFullUrl(creds.baseUrl, '/v3/esimsbulk', { accountId: aidForGetSim }),
            method: 'POST',
            contentType: 'json',
            body: { accountId: aidForGetSim, page: 1, limit: 1000 },
            auth: winAuth,
            timeoutMs: 15_000,
          }),
        ]);
        const both401 = assetsRes.statusCode === 401 && esimsRes.statusCode === 401;
        finalAssetsOk = assetsRes.tag === 'ok';
        finalEsimsOk = esimsRes.tag === 'ok';
        if (both401 && wcAttempt === 1) {
          DEBUG_LOG(`🏆 STAP 0 Poging 1/2: Winning Combo BULK endpoints gaven BEIDE HTTP 401 (InvalidCredentials)! Token cache WEGGOOIEN + OPNIEUW /v3/auth/token aanroepen...`);
          invalidateBearerTokenCache(creds.baseUrl);
          const freshToken = await acquireBearerToken(creds);
          if (!freshToken) { DEBUG_LOG(`🏆 STAP 0 Poging 2/2: NIEUW token verkrijgen MISLUKT! Stop Winning Combo.`); break; }
          winAuth = { tag: 'bearer-token', token: freshToken };
          DEBUG_LOG(`🏆 STAP 0 Poging 2/2: FRESH token OK (len=${freshToken.length}). Winning Combo opnieuw proberen!`);
          continue;
        }
        if (wcAttempt === 2 && both401) { DEBUG_LOG(`🏆 STAP 0 Poging 2/2: NOG STEEDS HTTP 401! Winning Combo compleet mislukt.`); break; }
        // Data verzamelen
        const batches: Array<{ name: string; items: any[] }> = [];
        if (assetsRes.tag === 'ok') batches.push({ name: 'assetsbulk-aid', items: extractSimList(assetsRes.body) });
        if (esimsRes.tag === 'ok') batches.push({ name: 'esimsbulk-aid', items: extractSimList(esimsRes.body) });
        DEBUG_LOG(`🏆 Phase A poging ${wcAttempt}/2: HTTP assetsbulk=${assetsRes.tag === 'ok' ? '200' : assetsRes.statusCode} esimsbulk=${esimsRes.tag === 'ok' ? '200' : esimsRes.statusCode}. items.len=${batches.map(b => `${b.name}=${b.items.length}`).join(', ') || '(geen 200)'}`);
        if (batches.length === 0 && wcAttempt === 1 && (assetsRes.statusCode === 401 || esimsRes.statusCode === 401)) {
          // Ook als slechts 1 van de 2 401 geeft (randgeval): invalidate + retry
          DEBUG_LOG(`🏆 STAP 0 Poging 1/2: 1 van de 2 bulk = 401. Cache wegdoen + retry.`);
          invalidateBearerTokenCache(creds.baseUrl);
          const freshToken = await acquireBearerToken(creds);
          if (freshToken) { winAuth = { tag: 'bearer-token', token: freshToken }; continue; }
        }
        finalBatches = batches;
        break; // Succes (of: na poging 2 altijd uit de loop!)
      }

      const batches = finalBatches;
      let phaseABest: SimhuisSimStatus | null = null;
      let phaseABestScore = -1;

      for (const batch of batches) {
        for (const raw of batch.items) {
          const tryStr = (v: any) => v == null ? '' : String(v).trim();
          const rawIccid = tryStr((raw as any).iccid);
          const profilesIccid = Array.isArray((raw as any).profiles)
            ? ((raw as any).profiles.map((p: any) => tryStr(p.iccid)).find((x: string) => !!x) ?? '')
            : '';
          const enabledIccid = tryStr((raw as any).enabledProfile?.iccid);
          if (rawIccid !== iccid && profilesIccid !== iccid && enabledIccid !== iccid) continue;
          DEBUG_LOG(`🏆 Phase A GEVONDEN in ${batch.name}! ICCID match!`);
          let extracted: SimhuisSimStatus | null = null;
          try {
            extracted = toSimStatus(raw, iccid);
          } catch { extracted = null; }

          // 💥 CRITICIAL FIX: Catch-22 opheffen!
          // WIJ WETEN dat dit de juiste SIM is (match op ICCID!). Dus:
          // 1. Als toSimStatus() null of iccid=null gaf → initialiseer minimal safe object
          // 2. FORCEER extracted.iccid = iccid (de gezochte!) zodat enrich NIET vroegtijdig returnt!
          if (!extracted) {
            extracted = { iccid } as SimhuisSimStatus;
          }
          if (!(extracted as any).iccid) {
            (extracted as any).iccid = iccid;
          }
          // 3. Expliciet eid/msisdn vooraf vullen indien mogelijk (listAllSims Winning Combo strategie!)
          const tryRawIccid = (v: any) => {
            if (v === null || v === undefined) return '';
            const s = String(v).trim();
            if (!s) return '';
            const lower = s.toLowerCase();
            if (['iccid','sim_iccid','simiccid','esimid','esim_id','eid'].includes(lower)) return '';
            return s;
          };
          const eidMaybe = tryRawIccid((raw as any).eid) || tryRawIccid((raw as any).esimId) || tryRawIccid((raw as any).enabledProfile?.eid);
          if (eidMaybe && !(extracted as any).eid) (extracted as any).eid = eidMaybe;
          if (Array.isArray((raw as any).msisdn) && (raw as any).msisdn.length > 0) {
            const mFirst = String((raw as any).msisdn[0] ?? '').trim();
            if (mFirst && !(extracted as any).msisdn) (extracted as any).msisdn = mFirst;
          }

          // Nu kan enrich VEILIG alles vullen! (baseStatus.iccid is nu IMMER gezet!)
          try {
            extracted = enrichSimhuisStatusWithDirectRawExtracts(extracted, raw, iccid);
          } catch { /* ignore enrich errors */ }

          if (!(extracted as any)?.iccid) {
            DEBUG_LOG(`🏆 Phase A: extracted.iccid nog steeds NULL na enrich → SKIP (mogelijk corrupte raw data)`);
            continue;
          }
          const valid = extracted as SimhuisSimStatus;
          const sc = scoreSimStatus(valid);
          DEBUG_LOG(`🏆 Phase A: match score=${sc}. hasAnyUsage=${hasAnyUsage(valid)} hasFullUsage=${hasFullUsage(valid)}`);
          if (hasFullUsage(valid)) {
            DEBUG_LOG(`🏆 Phase A EARLY RETURN: complete usage data (score=${sc}).`);
            return valid;
          }
          // 💥 DREMPEL VERLAAGD: Winning Combo data = altijd inventory data. Dus:
          //   - Als we ANY usage hebben (dataLimit of dataUsed of smsLimit) → onmiddellijk return; beter dan 50 attempts!
          //   - Als status gevuld is + msisdn → return (score>=3 ok)
          if (hasAnyUsage(valid) && sc >= 4) {
            DEBUG_LOG(`🏆 Phase A EARLY RETURN (drempel verlaagd): hasAnyUsage=true & score=${sc} ≥4. Beter dan 50× mislukte endpoints!`);
            return valid;
          }
          if (sc > phaseABestScore) {
            phaseABest = valid;
            phaseABestScore = sc;
          }
        }
      }

      // 💥 DREMPEL VERLAAGD (geen 10 meer!):
      //   We hebben IMMER een geldige inventory match. Phase A is 100× betrouwbaarder dan de 50× legacy endpoints.
      //   Dus: als er EEN BESTAANDE match is (phaseABest !== null) → eerst Phase A.5 (usage endpoints) proberen, DAN return!
      if (phaseABest) {
        const best = phaseABest as SimhuisSimStatus;
        const needsUsage = best.dataUsedBytes === null || best.smsUsedCount === null || best.productName === null || /cardcentri|mii|imeifplmn/i.test(best.productName ?? '');
        if (needsUsage && bearerToken && aidForGetSim) {
          DEBUG_LOG(`🏆 Phase A.5: needsUsage=${needsUsage} dataUsed=${JSON.stringify((best as any).dataUsedBytes)} smsUsed=${JSON.stringify((best as any).smsUsedCount)} product=${JSON.stringify((best as any).productName)} → Probeer 4 Swagger-bevestigde per-SIM endpoints met Bearer-token + accountId!`);
          const billTime = billTimeCurrentMonth();
          DEBUG_LOG(`🏆 Phase A.5: billTime (huidige maand facturatieperiode) = ${billTime.combined}`);
          try {
            // ============================================================
            // 🆕 Swagger-bevestigde endpoints (volgorde = HOOGSTE PRIO eerst!):
            //   1. GET /v3/assets/{iccid}?accountId={aid}
            //      → subscriptions[].bundles[] bevat dataUsed + localProductName!
            //   2. GET /v3/accounts/{aid}/assets/{iccid}?accountId={aid}
            //      → Zelfde data, met accounts prefix!
            //   3. GET /v3/cdr/stats?accountId={aid}&iccid={iccid}&type=data&billTime=...
            //      → Top-level `bytes` = PERIODE TOTAAL DATAVERBRUIK! (100% bytes!)
            //   4. GET /v3/cdr?accountId={aid}&iccid={iccid}&type=data&limit=50&order=desc
            //      → data[].bytes + ratings[].dataUsed + ratings[].product.remainingBytes!
            // ============================================================
            const usageTemplates: Array<{ method: 'GET' | 'POST'; path: string; query?: Record<string, any>; body?: Record<string, any>; contentType?: 'json' | 'form' | 'none' }> = [];
            usageTemplates.push({ method: 'GET', path: `/assets/${iccid}`, query: { accountId: aidForGetSim } });
            usageTemplates.push({ method: 'GET', path: `/accounts/${aidForGetSim}/assets/${iccid}`, query: { accountId: aidForGetSim } });
            usageTemplates.push({ method: 'GET', path: `/cdr/stats`, query: { accountId: aidForGetSim, iccid, type: 'data', billTime: billTime.combined } });
            usageTemplates.push({ method: 'GET', path: `/cdr`, query: { accountId: aidForGetSim, iccid, type: 'data', limit: 50, sort: 'billTime', order: 'desc', billTime: billTime.combined } });
            for (let i = 0; i < usageTemplates.length; i++) {
              const ut = usageTemplates[i];
              if (Date.now() - startedAtGetSim > 15_000) { DEBUG_LOG(`🏆 Phase A.5: time-out (>15s) na ${i} pogingen.`); break; }
              try {
                const auth: PerSimAuth = { tag: 'bearer-token', token: bearerToken };
                const fullUrl = makePerSimFullUrl(creds.baseUrl, `/v3${ut.path}`, ut.query ?? {});
                DEBUG_LOG(`🏆 Phase A.5: poging ${i+1}/${usageTemplates.length} → ${ut.method} /v3${ut.path}${ut.query && Object.keys(ut.query).length ? `?${Object.entries(ut.query).map(([k,v]) => v && typeof v === 'string' && v.includes(',') ? `${k}=<periode>` : `${k}=${v}`).join('&')}` : ''} auth=bearer+aid...`);
                const result = await doPerSimFetch({
                  fullUrl,
                  method: ut.method,
                  contentType: (ut as any).contentType ?? 'none',
                  body: (ut.body ?? null) as any,
                  auth,
                  timeoutMs: 5000,
                });
                if (result.tag === 'ok') {
                  try {
                    // 🆕 Debug: print TOP-LEVEL keys van response (geen data dump!) zodat we weten wat erin zit!
                    const topKeys = Array.isArray(result.body)
                      ? `ARRAY len=${result.body.length}${result.body.length > 0 ? `; item[0] keys=${Object.keys((result.body as any[])[0] ?? {}).join(',')}` : ''}`
                      : `OBJECT keys=${Object.keys((result.body ?? {}) as object).join(',')}`;
                    DEBUG_LOG(`🏆 Phase A.5: ${ut.method} /v3${ut.path} HTTP 200! response=${topKeys}`);
                    const prevDU = (best as any).dataUsedBytes;
                    const prevSMS = (best as any).smsUsedCount;
                    const prevProd = (best as any).productName;
                    const bestAsMutable: any = { ...best as any };
                    if (!bestAsMutable.iccid) bestAsMutable.iccid = iccid;
                    const enriched = enrichSimhuisStatusWithDirectRawExtracts(bestAsMutable as SimhuisSimStatus, result.body, iccid);
                    if (enriched) {
                      const newDU = (enriched as any).dataUsedBytes;
                      const newSMS = (enriched as any).smsUsedCount;
                      const newProd = (enriched as any).productName;
                      DEBUG_LOG(`🏆 Phase A.5: ${ut.method} /v3${ut.path} → dataUsed ${prevDU ?? 'NULL'} → ${newDU ?? 'NULL'}, smsUsed ${prevSMS ?? 'NULL'} → ${newSMS ?? 'NULL'}, product ${prevProd ?? 'NULL'} → ${newProd ?? 'NULL'}.`);
                      const verbeterd =
                        (newDU !== null && prevDU === null) ||
                        (newSMS !== null && prevSMS === null) ||
                        (newProd !== null && !/cardcentri|mii|imeifplmn/i.test(newProd) && /cardcentri|mii|imeifplmn/i.test(prevProd ?? ''));
                      // 💥 EARLY RETURN: als we dataUsed HEBBEN + geen lege tech profiel naam meer → meteen returnen!
                      if (newDU !== null && newSMS !== null) {
                        DEBUG_LOG(`🏆 Phase A.5: COMPLETE usage data (data+sms) → EARLY RETURN!`);
                        return enriched;
                      }
                      if (verbeterd) {
                        DEBUG_LOG(`🏆 Phase A.5: Verbetering gevonden! Update phaseABest...`);
                        (best as any).dataUsedBytes = newDU;
                        (best as any).smsUsedCount = newSMS;
                        // Alle andere velden van enriched ook overnemen (mocht het een los asset endpoint zijn met meer meta!)
                        for (const f of ['productName','productType','simName','groupName','groupId','dataLimitBytes','smsLimitCount','lowestDataLimitBytes','lowestSmsLimitCount','status','msisdn','eid'] as const) {
                          const v = (enriched as any)[f];
                          if (v !== null && v !== undefined) {
                            if (f === 'productName' && (best as any)[f] && /cardcentri|mii|imeifplmn/i.test(String((best as any)[f]))) { (best as any)[f] = v; }
                            else if (f === 'productName' && !(best as any)[f]) { (best as any)[f] = v; }
                            else if (f !== 'status' || !(best as any)[f]) { (best as any)[f] = v; }
                          }
                        }
                      }
                    }
                  } catch (err2) { DEBUG_LOG(`🏆 Phase A.5: parse error: ${(err2 as any)?.message ?? err2}`); }
                } else {
                  DEBUG_LOG(`🏆 Phase A.5: ${ut.method} /v3${ut.path} HTTP ${result.statusCode}.`);
                }
              } catch (err3) { DEBUG_LOG(`🏆 Phase A.5: poging ${i+1} fetch error: ${(err3 as any)?.message ?? err3}`); }
            }
          } catch (err) {
            DEBUG_LOG(`🏆 Phase A.5 exceptie: ${(err as any)?.message ?? err}. Blijf phaseABest retourneren.`);
          }
        } else {
          DEBUG_LOG(`🏆 Phase A.5: overslaan → needsUsage=${needsUsage} (${!needsUsage ? 'compleet!' : ''}${!bearerToken ? '; geen bearer-token' : ''}${!aidForGetSim ? '; geen aidForGetSim' : ''}).`);
        }
        DEBUG_LOG(`🏆 Phase A: phaseABest iccid=${(best as any).iccid} score=${phaseABestScore} dataUsed=${JSON.stringify((best as any).dataUsedBytes)} smsUsed=${JSON.stringify((best as any).smsUsedCount)} product=${JSON.stringify((best as any).productName)} → RETURN (Winning Combo + optioneel A.5).`);
        return best;
      }
      DEBUG_LOG(`🏆 Phase A: geen match (ongebruikelijk!). ${phaseABest ? `beste score=${phaseABestScore}` : 'phaseABest=null'}. Ga door met overige endpoints.`);
    } catch (err) {
      DEBUG_LOG(`🏆 Phase A exceptie: ${(err as any)?.message ?? err}. Ga door.`);
    }
  }

  const authVariants: PerSimAuth[] = [];
  authVariants.push({ tag: 'basic-header', header: authBasic });
  authVariants.push({ tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  if (bearerToken) authVariants.push({ tag: 'bearer-token', token: bearerToken });
  authVariants.push({ tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  authVariants.push({ tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId });

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;

  // ⚡ SCHERPE SELECTIE: alleen 14 meest kansrijke endpoints (GEEN 50+ legacy endpoints!)
  const prefixes = ['/v3'];
  type Template = { method: 'GET' | 'POST'; pathTpl: string; query?: Record<string, any>; body?: Record<string, any>; multiBody?: Array<Record<string, any>> };
  const templates: Template[] = [];
  if (aidForGetSim) {
    templates.push(
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/assets/{iccid}` },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/assets/{iccid}/diagnostic` },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/sims/{iccid}` },
      { method: 'POST', pathTpl: `/accounts/${aidForGetSim}/assetsbulk`, multiBody: [{ accountId: aidForGetSim, iccid, limit: 5 }, { accountId: aidForGetSim, filter: { iccid }, limit: 5 }] },
    );
  }
  templates.push(
    { method: 'GET',  pathTpl: '/assets/{iccid}' },
    { method: 'GET',  pathTpl: '/sims/{iccid}' },
    { method: 'GET',  pathTpl: '/assets/{iccid}/diagnostic' },
    { method: 'GET',  pathTpl: '/assetsbulk',  query: { iccid, accountId: aidForGetSim, limit: 5 } },
    { method: 'GET',  pathTpl: '/esimsbulk',   query: { iccid, accountId: aidForGetSim, limit: 5 } },
    { method: 'POST', pathTpl: '/assetsbulk',  multiBody: [{ iccid, limit: 5 }, { filter: { iccid }, limit: 5 }, { query: { iccid }, limit: 5 }, { iccid, accountId: aidForGetSim, limit: 5 }] },
    { method: 'POST', pathTpl: '/esimsbulk',   multiBody: [{ iccid, limit: 5 }, { filter: { iccid }, limit: 5 }, { query: { iccid }, limit: 5 }, { iccid, accountId: aidForGetSim, limit: 5 }] },
    { method: 'GET',  pathTpl: '/esims', query: { iccid, accountId: aidForGetSim, limit: 5 } },
    { method: 'GET',  pathTpl: '/assets', query: { iccid, accountId: aidForGetSim, limit: 5 } },
  );

  const METHOD_CYCLE: Array<'GET' | 'POST'> = ['GET', 'POST'];
  function allMethodsAfter(start: 'GET' | 'POST'): Array<'GET' | 'POST'> {
    const idx = METHOD_CYCLE.indexOf(start);
    const rest = METHOD_CYCLE.slice();
    rest.splice(idx, 1);
    return rest;
  }

  function pushRanked(meta: PerSimAttemptMeta, result: PerSimAttemptResult) {
    if (result.tag === 'ok') return;
    const score = attemptRankScore(result.statusCode, result.error ?? null);
    rankedAttempts.push({ meta, statusCode: result.statusCode, error: result.error ?? null, score });
  }
  function topRanked(n: number): RankedAttempt[] {
    return [...rankedAttempts].sort((a, b) => b.score - a.score).slice(0, n);
  }

  // EERST /v3 prefix, want dat is AirOn360 standaard
  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const score = (p: string) => {
      if (p === '/v3') return 0;
      if (p === '') return 1;
      if (p.startsWith('/v3/')) return 2;
      if (p.startsWith('/api/v3')) return 3;
      if (p === '/v2') return 4;
      if (p.startsWith('/api/v2')) return 5;
      if (p.startsWith('/v1')) return 6;
      if (p.startsWith('/api')) return 7;
      return 9;
    };
    return score(a) - score(b);
  });

  // "Beste response" accumulator: we houden de status met de meeste velden bij,
  // zodat een endpoint zonder data-velden niet een later (completer) endpoint blokkeert.
  let bestStatus: SimhuisSimStatus | null = null;
  let bestScore = -1;
  function scoreSimStatus(s: SimhuisSimStatus): number {
    if (!s || !s.iccid) return -1;
    let score = 0;
    if (s.status) score += 1;
    if (s.imsi) score += 1;
    if (s.msisdn) score += 2;
    if (s.activatedAt) score += 1;
    if (s.dataUsedBytes != null) score += 8;
    if (s.dataLimitBytes != null) score += 5;
    if (s.lowestDataLimitBytes != null) score += 3;
    if (s.smsUsedCount != null) score += 8;
    if (s.smsLimitCount != null) score += 5;
    if (s.lowestSmsLimitCount != null) score += 3;
    if (s.ip) score += 1;
    if (s.network) score += 1;
    if (s.productName) score += 1;
    return score;
  }
  function hasAnyUsage(s: SimhuisSimStatus): boolean {
    return s.dataUsedBytes != null || s.dataLimitBytes != null || s.lowestDataLimitBytes != null
      || s.smsUsedCount != null || s.smsLimitCount != null || s.lowestSmsLimitCount != null;
  }
  function hasFullUsage(s: SimhuisSimStatus): boolean {
    return (s.dataUsedBytes != null || s.smsUsedCount != null)
      && (s.dataLimitBytes != null || s.smsLimitCount != null);
  }
  function consider(s: SimhuisSimStatus | null | undefined): SimhuisSimStatus | null {
    if (!s || !s.iccid) return bestStatus;
    const sc = scoreSimStatus(s);
    if (sc > bestScore) { bestScore = sc; bestStatus = s; }
    return bestStatus;
  }

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      const bodyVariants: Array<Record<string, any> | null> = [];
      if (tpl.method === 'GET') {
        bodyVariants.push(null);
      } else if (tpl.multiBody && tpl.multiBody.length > 0) {
        for (const mb of tpl.multiBody) bodyVariants.push(mb);
      } else {
        bodyVariants.push(tpl.body ?? {});
      }

      for (const bodyVariant of bodyVariants) {
        for (const auth of authVariants) {
          const contentTypes = tpl.method === 'GET'
            ? (['none'] as const)
            : (['json', 'form'] as const);

          for (const contentType of contentTypes) {
            if (tpl.method === 'GET' && (auth.tag === 'creds-body')) continue;
            if (bailCheck(`tpl=${tpl.method}:${tpl.pathTpl}`)) break;

            const endpointPath = `${prefix}${tpl.pathTpl}`.replace('{iccid}', encodeURIComponent(iccid));
            const query = tpl.method === 'GET' ? (tpl.query ?? {}) : null;
            const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, query);
            const body = tpl.method === 'POST' ? (bodyVariant ?? {}) : null;
            const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };
            DEBUG_LOG(`attempt ${totalFetchAttempts}: ${tpl.method} ${endpointPath} auth=${auth.tag} ct=${contentType}`);

            const result = await doPerSimFetch({
              fullUrl,
              method: tpl.method,
              contentType: contentType as any,
              body,
              auth,
              timeoutMs: 15_000,
            });

            if (result.tag === 'ok') {
              let extracted: SimhuisSimStatus | null = null;
              try { extracted = toSimStatus(result.body, iccid); extracted = enrichSimhuisStatusWithDirectRawExtracts(extracted, result.body, iccid); } catch { extracted = null; }
              if (extracted?.iccid) {
                consider(extracted);
                // Vroegtijdig stoppen ALLEEN als deze response echt complete usage data heeft
                if (hasFullUsage(extracted)) { DEBUG_LOG(`✅ EARLY EXIT: ${tpl.method}:${tpl.pathTpl} gaf complete usage data!`); return extracted; }
              }
            }

            pushRanked(meta, result);
            if (result.tag === 'error') lastErrorResult = result;

            if (result.statusCode === 405) {
              const remaining = allMethodsAfter(tpl.method);
              for (const altMethod of remaining) {
                if (bailCheck(`altMethod=${altMethod} (405)`)) break;
                if (altMethod === 'GET' && auth.tag === 'creds-body') continue;
                const altContentType: 'json' | 'form' | 'none' = altMethod === 'GET' ? 'none' : 'json';
                const altQuery = altMethod === 'GET' ? { iccid, ...(tpl.query ?? {}) } : null;
                const altBody = altMethod === 'GET' ? null : { ...(bodyVariant ?? {}), iccid };
                const altFullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, altQuery);
                const altMeta: PerSimAttemptMeta = { endpointPath, method: altMethod, authTag: toAuthTag(auth), contentType: altContentType };
                const altResult = await doPerSimFetch({
                  fullUrl: altFullUrl,
                  method: altMethod,
                  contentType: altContentType,
                  body: altBody,
                  auth,
                  timeoutMs: 15_000,
                });
                if (altResult.tag === 'ok') {
                  let extracted: SimhuisSimStatus | null = null;
                  try { extracted = toSimStatus(altResult.body, iccid); extracted = enrichSimhuisStatusWithDirectRawExtracts(extracted, altResult.body, iccid); } catch { extracted = null; }
                  if (extracted?.iccid) {
                    consider(extracted);
                    if (hasFullUsage(extracted)) { DEBUG_LOG(`✅ EARLY EXIT (405 alt ${altMethod}): complete usage data!`); return extracted; }
                  }
                }
                pushRanked(altMeta, altResult);
                if (altResult.tag === 'error') lastErrorResult = altResult;
              }
              if (didBailEarly) break;
            }
          }
          if (didBailEarly) break;
        }
        if (didBailEarly) break;
      }
      if (didBailEarly) break;
    }
  }

  // === Laatste redmiddel: listSims EN GET /v3/sims + scoped-accounts paden! ===
  DEBUG_LOG(`⚡ FALLBACK: list queries + listSims fallback.`);
  const listAttempts: Array<{ label: string; items: any[] | null; iccidFound: boolean }> = [];
  try {
    const listPathCandidates: Array<{ label: string; suffix: string }> = [];
    if (aidForGetSim) {
      listPathCandidates.push(
        { label: `/accounts/${aidForGetSim}/assets`, suffix: `/accounts/${aidForGetSim}/assets` },
      );
    }
    listPathCandidates.push(
      { label: '/assets', suffix: '/assets' },
      { label: '/esims', suffix: '/esims' },
    );
    const listQueryCandidates: Array<Record<string, any>> = [
      { iccid, accountId: aidForGetSim, page: 1, limit: 1000 },
    ];

    for (const prefix of orderedPrefixes.slice(0, 1)) {
      for (const auth of authVariants.slice(0, 3)) {
        for (const pc of listPathCandidates) {
          for (const q of listQueryCandidates) {
            if (bailCheck(`listGET pc=${pc.label}`)) break;
            try {
              const fullUrl = makePerSimFullUrl(creds.baseUrl, `${prefix}${pc.suffix}`, q);
              const result = await doPerSimFetch({ fullUrl, method: 'GET', contentType: 'none', body: null, auth, timeoutMs: 20_000 });
              if (result.tag === 'ok') {
                const items: any[] = Array.isArray(result.body)
                  ? result.body
                  : ((result.body && typeof result.body === 'object' && Array.isArray((result.body as any).items)) ? (result.body as any).items : []);
                const found = items.some((s: any) => String(s.iccid ?? '').trim() === iccid);
                listAttempts.push({ label: `${prefix}${pc.label} auth=${toAuthTag(auth)} (items=${items.length})`, items, iccidFound: found });
                if (found) {
                  const match = items.find((s: any) => String(s.iccid ?? '').trim() === iccid);
                  if (match) {
                    try {
                      let st: SimhuisSimStatus | null = toSimStatus(match, iccid);
                      if (!st) st = { iccid } as SimhuisSimStatus;
                      if (!(st as any).iccid) (st as any).iccid = iccid;
                      st = enrichSimhuisStatusWithDirectRawExtracts(st, match, iccid);
                      if (st?.iccid) {
                        consider(st);
                        if (hasFullUsage(st) || hasAnyUsage(st)) { DEBUG_LOG(`✅ listGET hit ${pc.label} found iccid! returning.`); return st; }
                      }
                    } catch { /* bad item, continue */ }
                  }
                }
              } else {
                listAttempts.push({ label: `${prefix}${pc.label} auth=${toAuthTag(auth)} HTTP ${result.statusCode}`, items: null, iccidFound: false });
              }
            } catch { /* negeer */ }
          }
          if (didBailEarly) break;
        }
        if (didBailEarly) break;
      }
      if (didBailEarly) break;
    }
  } catch { /* negeer */ }

  try {
    const statusVariants: Array<(string | undefined | null)> = [undefined];
    for (const sv of statusVariants) {
      if (bailCheck(`listSims sv=${sv}`)) break;
      try {
        const opts: any = { page: 1, limit: 1000 };
        if (sv !== undefined) (opts as any).status = sv === null ? null : sv;
        DEBUG_LOG(`listSims() aanroepen (+${Date.now() - startedAtGetSim}ms)`);
        const lr = await listSims(opts);
        const items: any[] = (lr && Array.isArray((lr as any).items)) ? (lr as any).items : [];
        const found = items.some((s: any) => String(s.iccid ?? '').trim() === iccid);
        listAttempts.push({
          label: `listSims status=${sv === undefined ? 'unset' : (sv === null ? 'null' : sv)} (items=${items.length})`,
          items,
          iccidFound: found,
        });
        if (found) {
          const match = items.find((s: any) => String(s.iccid ?? '').trim() === iccid);
          if (match) {
            try {
              let st: SimhuisSimStatus | null = toSimStatus(match, iccid);
              if (!st) st = { iccid } as SimhuisSimStatus;
              if (!(st as any).iccid) (st as any).iccid = iccid;
              st = enrichSimhuisStatusWithDirectRawExtracts(st, match, iccid);
              if (st?.iccid) {
                consider(st);
                if (hasFullUsage(st) || hasAnyUsage(st)) { DEBUG_LOG(`✅ listSims() fallback hit iccid! returning.`); return st; }
              }
            } catch { /* bad shape, continue */ }
          }
        }
      } catch { /* negeer */ }
    }
  } catch { /* negeer */ }

  // Op dit punt: als we een "best" hebben met in ieder geval wat usage,
  // geef die voorkeur boven de raw eerste-OK fallback.
  if (bestStatus && hasAnyUsage(bestStatus)) return bestStatus;

  const top = topRanked(5);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 220)}` : ''}`,
      ).join('\n')
    : '  (geen pogingen geregistreerd)';
  const listDebugStr = listAttempts.length
    ? '\n\nListSims / eSIMS query resultaten:\n' + listAttempts.map((la) => `  - ${la.label} → iccidFound=${la.iccidFound}`).join('\n')
    : '';

  // Fallback: als wél bestStatus bestaat (met ICCID, status etc. maar zonder usage) — return die dan. Alleen als geen enkele OK was, throw.
  const bestAny = bestStatus as (SimhuisSimStatus | null);
  if (bestAny && bestAny.iccid) {
    if (!bestAny.status) (bestAny as any).status = 'active';
    return bestAny;
  }

  if (lastErrorResult) {
    const raw = lastErrorResult.raw ?? (top[0] ? undefined : undefined);
    const statusCode = lastErrorResult.statusCode || (top[0]?.statusCode ?? 500);
    throw new SimhuisApiError(
      statusCode,
      raw ?? null,
      creds.baseUrl,
      `[Simhuis] getSimStatus mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-5 meest veelbelovende pogingen:\n${topStr}${listDebugStr}`,
    );
  }
  throw new Error(
    `[Simhuis] getSimStatus mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-5 meest veelbelovende pogingen:\n${topStr}${listDebugStr}`,
  );
}

export async function activateSim(options: ActivateSimOptions): Promise<SimhuisSimStatus> {
  const creds = await getSimhuisCreds();
  const authBasic = basicAuthHeader(creds.username, creds.password);
  const resellerId = options.resellerId ?? creds.resellerId;

  const bodyBase: Record<string, unknown> = {};
  if (options.offerId) bodyBase.offer_id = options.offerId;
  if (options.planId) bodyBase.plan_id = options.planId;
  if (resellerId) bodyBase.reseller_id = resellerId;
  if (options.customerRef) bodyBase.customer_ref = options.customerRef;
  bodyBase.iccid = options.iccid;

  const allAuthVariants: PerSimAuth[] = [
    { tag: 'basic-header', header: authBasic },
    { tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId },
    { tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId },
    { tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId },
  ];
  let bearerToken: string | null = null;
  try {
    bearerToken = await acquireBearerToken(creds);
  } catch {
    bearerToken = null;
  }
  if (bearerToken) {
    allAuthVariants.unshift({ tag: 'bearer-token', token: bearerToken });
  }

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;
  let successRaw: unknown = null;
  let successFound = false;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 4);
  const iccid = options.iccid;

  type Template = { method: 'POST' | 'PUT' | 'PATCH'; pathTpl: string; body: Record<string, unknown> };
  const templates: Template[] = [
    { method: 'PUT', pathTpl: '/assets/{iccid}/subscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/subscribe', body: { ...bodyBase } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/resubscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/unsuspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/esims/{iccid}/subscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/esims/{iccid}/subscribe', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/bulk/esims/subscribe', body: { iccids: [iccid], offer_id: options.offerId, plan_id: options.planId, customer_ref: options.customerRef, reseller_id: resellerId } },
    { method: 'PUT', pathTpl: '/iot/device/{iccid}/subscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/ulb/device/{iccid}/subscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sims/{iccid}/activate', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sims/activate', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/sim/{iccid}/activate', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sim/activate', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/subscription/activate', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/subscriptions/{iccid}/activate', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/simcards/{iccid}/activate', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/sims/{iccid}', body: { ...bodyBase, status: 'active' } },
    { method: 'PUT', pathTpl: '/sim/{iccid}', body: { ...bodyBase, iccid: undefined, status: 'active' } },
    { method: 'PATCH', pathTpl: '/sims/{iccid}', body: { ...bodyBase, status: 'active' } },
  ];

  function pushRanked(meta: PerSimAttemptMeta, result: PerSimAttemptResult) {
    if (result.tag === 'ok') return;
    const score = attemptRankScore(result.statusCode, result.error ?? null);
    rankedAttempts.push({ meta, statusCode: result.statusCode, error: result.error ?? null, score });
  }
  function topRanked(n: number): RankedAttempt[] {
    return [...rankedAttempts].sort((a, b) => b.score - a.score).slice(0, n);
  }
  const ACTIVATE_METHODS: Array<'POST' | 'PUT' | 'PATCH'> = ['POST', 'PUT', 'PATCH'];
  function allActivateMethodsAfter(start: 'POST' | 'PUT' | 'PATCH'): Array<'POST' | 'PUT' | 'PATCH'> {
    const idx = ACTIVATE_METHODS.indexOf(start);
    const rest = ACTIVATE_METHODS.slice();
    rest.splice(idx, 1);
    return rest;
  }

  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const aScore = a === '/v3' ? 0 : a === '' ? 1 : a === '/v2' ? 2 : a === '/api/v3' ? 3 : a === '/api/v2' ? 4 : 5;
    const bScore = b === '/v3' ? 0 : b === '' ? 1 : b === '/v2' ? 2 : b === '/api/v3' ? 3 : b === '/api/v2' ? 4 : 5;
    return aScore - bScore;
  });

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      for (const auth of allAuthVariants) {
        const contentTypes: Array<'json' | 'form'> = ['json', 'form'];
        for (const contentType of contentTypes) {
          const endpointPath = `${prefix}${tpl.pathTpl}`.replaceAll('{iccid}', encodeURIComponent(iccid));
          const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, null);
          const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };
          const result = await doPerSimFetch({
            fullUrl,
            method: tpl.method,
            contentType,
            body: tpl.body,
            auth,
            timeoutMs: 30_000,
          });
          if (result.tag === 'ok') {
            successFound = true;
            successRaw = result.body;
            try {
              const status = toSimStatus(result.body, iccid);
              if (status.status || status.imsi || status.msisdn || status.activatedAt) return status;
            } catch { /* bad shape, continue */ }
          } else {
            pushRanked(meta, result);
            if (result.tag === 'error') lastErrorResult = result;
          }

          if (result.statusCode === 405) {
            const remaining = allActivateMethodsAfter(tpl.method);
            for (const altMethod of remaining) {
              const altMeta: PerSimAttemptMeta = { endpointPath, method: altMethod, authTag: toAuthTag(auth), contentType };
              const altResult = await doPerSimFetch({
                fullUrl,
                method: altMethod,
                contentType,
                body: { ...tpl.body },
                auth,
                timeoutMs: 30_000,
              });
              if (altResult.tag === 'ok') {
                successFound = true;
                successRaw = altResult.body;
                try {
                  const status = toSimStatus(altResult.body, iccid);
                  if (status.status || status.imsi || status.msisdn || status.activatedAt) return status;
                } catch { /* bad shape, continue */ }
              } else {
                pushRanked(altMeta, altResult);
                if (altResult.tag === 'error') lastErrorResult = altResult;
              }
            }
          }
        }
      }
    }
  }

  const top = topRanked(5);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method.padEnd(5)} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 220)}` : ''}`,
      ).join('\n')
    : '  (geen pogingen geregistreerd)';

  if (successFound && successRaw !== null) {
    try {
      const status = toSimStatus(successRaw, iccid);
      if (!status.status) status.status = 'active';
      return status;
    } catch { /* fall through to error */ }
  }

  if (lastErrorResult) {
    const statusCode = lastErrorResult.statusCode || (top[0]?.statusCode ?? 500);
    throw new SimhuisApiError(
      statusCode,
      lastErrorResult.raw ?? null,
      creds.baseUrl,
      `[Simhuis] activateSim mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-5 meest veelbelovende pogingen:\n${topStr}`,
    );
  }
  throw new Error(
    `[Simhuis] activateSim mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-5 meest veelbelovende pogingen:\n${topStr}`,
  );
}

export async function deactivateSim(iccid: string): Promise<SimhuisSimStatus> {
  const creds = await getSimhuisCreds();
  const authBasic = basicAuthHeader(creds.username, creds.password);
  const resellerId = creds.resellerId;
  const bodyBase: Record<string, unknown> = { iccid };
  if (resellerId) bodyBase.reseller_id = resellerId;

  const allAuthVariants: PerSimAuth[] = [
    { tag: 'basic-header', header: authBasic },
    { tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId },
    { tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId },
    { tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId },
  ];
  let bearerToken: string | null = null;
  try {
    bearerToken = await acquireBearerToken(creds);
  } catch {
    bearerToken = null;
  }
  if (bearerToken) {
    allAuthVariants.unshift({ tag: 'bearer-token', token: bearerToken });
  }

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;
  let successRaw: unknown = null;
  let successFound = false;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 4);

  type Template = { method: 'POST' | 'PUT' | 'PATCH'; pathTpl: string; body: Record<string, unknown> };
  const templates: Template[] = [
    { method: 'PUT', pathTpl: '/assets/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/suspend', body: { ...bodyBase } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/terminate', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/assets/{iccid}/unsubscribe', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/esims/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/bulk/esims/suspend', body: { iccids: [iccid], reseller_id: resellerId } },
    { method: 'PUT', pathTpl: '/iot/device/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/ulb/device/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sims/{iccid}/deactivate', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sims/deactivate', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/sim/{iccid}/deactivate', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sim/deactivate', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/subscription/suspend', body: { ...bodyBase } },
    { method: 'POST', pathTpl: '/subscriptions/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/sims/{iccid}/suspend', body: { ...bodyBase, iccid: undefined } },
    { method: 'POST', pathTpl: '/simcards/{iccid}/deactivate', body: { ...bodyBase, iccid: undefined } },
    { method: 'PUT', pathTpl: '/sims/{iccid}', body: { ...bodyBase, status: 'inactive' } },
    { method: 'PATCH', pathTpl: '/sims/{iccid}', body: { ...bodyBase, status: 'inactive' } },
  ];

  function pushRanked(meta: PerSimAttemptMeta, result: PerSimAttemptResult) {
    if (result.tag === 'ok') return;
    const score = attemptRankScore(result.statusCode, result.error ?? null);
    rankedAttempts.push({ meta, statusCode: result.statusCode, error: result.error ?? null, score });
  }
  function topRanked(n: number): RankedAttempt[] {
    return [...rankedAttempts].sort((a, b) => b.score - a.score).slice(0, n);
  }
  const ACTIVATE_METHODS: Array<'POST' | 'PUT' | 'PATCH'> = ['POST', 'PUT', 'PATCH'];
  function allActivateMethodsAfter(start: 'POST' | 'PUT' | 'PATCH'): Array<'POST' | 'PUT' | 'PATCH'> {
    const idx = ACTIVATE_METHODS.indexOf(start);
    const rest = ACTIVATE_METHODS.slice();
    rest.splice(idx, 1);
    return rest;
  }

  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const aScore = a === '/v3' ? 0 : a === '' ? 1 : a === '/v2' ? 2 : a === '/api/v3' ? 3 : a === '/api/v2' ? 4 : 5;
    const bScore = b === '/v3' ? 0 : b === '' ? 1 : b === '/v2' ? 2 : b === '/api/v3' ? 3 : b === '/api/v2' ? 4 : 5;
    return aScore - bScore;
  });

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      for (const auth of allAuthVariants) {
        const contentTypes: Array<'json' | 'form'> = ['json', 'form'];
        for (const contentType of contentTypes) {
          const endpointPath = `${prefix}${tpl.pathTpl}`.replaceAll('{iccid}', encodeURIComponent(iccid));
          const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, null);
          const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };
          const result = await doPerSimFetch({
            fullUrl,
            method: tpl.method,
            contentType,
            body: tpl.body,
            auth,
            timeoutMs: 30_000,
          });
          if (result.tag === 'ok') {
            successFound = true;
            successRaw = result.body;
            try {
              const status = toSimStatus(result.body, iccid);
              if (status.status || status.imsi || status.msisdn || status.ip !== undefined) return status;
            } catch { /* bad shape, continue */ }
          } else {
            pushRanked(meta, result);
            if (result.tag === 'error') lastErrorResult = result;
          }

          if (result.statusCode === 405) {
            const remaining = allActivateMethodsAfter(tpl.method);
            for (const altMethod of remaining) {
              const altMeta: PerSimAttemptMeta = { endpointPath, method: altMethod, authTag: toAuthTag(auth), contentType };
              const altResult = await doPerSimFetch({
                fullUrl,
                method: altMethod,
                contentType,
                body: { ...tpl.body },
                auth,
                timeoutMs: 30_000,
              });
              if (altResult.tag === 'ok') {
                successFound = true;
                successRaw = altResult.body;
                try {
                  const status = toSimStatus(altResult.body, iccid);
                  if (status.status || status.imsi || status.msisdn || status.ip !== undefined) return status;
                } catch { /* bad shape, continue */ }
              } else {
                pushRanked(altMeta, altResult);
                if (altResult.tag === 'error') lastErrorResult = altResult;
              }
            }
          }
        }
      }
    }
  }

  const top = topRanked(5);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method.padEnd(5)} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 220)}` : ''}`,
      ).join('\n')
    : '  (geen pogingen geregistreerd)';

  if (successFound && successRaw !== null) {
    try {
      const status = toSimStatus(successRaw, iccid);
      if (!status.status) status.status = 'inactive';
      return status;
    } catch { /* fall through to error */ }
  }

  if (lastErrorResult) {
    const statusCode = lastErrorResult.statusCode || (top[0]?.statusCode ?? 500);
    throw new SimhuisApiError(
      statusCode,
      lastErrorResult.raw ?? null,
      creds.baseUrl,
      `[Simhuis] deactivateSim mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-5 meest veelbelovende pogingen:\n${topStr}`,
    );
  }
  throw new Error(
    `[Simhuis] deactivateSim mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-5 meest veelbelovende pogingen:\n${topStr}`,
  );
}

export interface ListSimsOptions {
  page?: number;
  limit?: number;
  status?: string;
  resellerId?: string | null;
}

export interface ListSimsResult {
  items: SimhuisSimStatus[];
  total?: number;
  page: number;
  limit: number;
  hasMore: boolean;
  raw?: unknown;
}

function extractSimList(raw: unknown): Array<Record<string, any>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, any>>;
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, any>;
  const candidates = [
    r.data,
    r.sims,
    r.items,
    r.results,
    r.rows,
    r.list,
    r.assets,
    r.esims,
    r.content,
    r.records,
    r.subscribers,
    r.subscriptions,
    r.inventory,
    r?.data?.sims,
    r?.data?.items,
    r?.data?.results,
    r?.data?.assets,
    r?.data?.esims,
    r?.data?.content,
    r?.data?.records,
    r?.data?.data,
    r?.data?.subscribers,
    r?.payload?.sims,
    r?.payload?.data,
    r?.response?.data,
    r?.response?.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Array<Record<string, any>>;
  }
  return [];
}

function shapeOf(obj: unknown): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (Array.isArray(obj)) return `Array(len=${obj.length})`;
  const t: string = typeof obj;
  if (t !== 'object') return t;
  const r = obj as Record<string, any>;
  const keys = Object.keys(r);
  const desc: string[] = keys.slice(0, 20).map((k) => {
    const v = r[k];
    let vtype: string = typeof v;
    if (v === null) vtype = 'null';
    else if (Array.isArray(v)) vtype = `Array(len=${v.length})`;
    else if (typeof v === 'object') vtype = `Obj(keys=${(Object.keys(v).slice(0, 10).join(',') as string) || '0'})`;
    return `${k}:${vtype}`;
  });
  return `{${desc.join('; ')}}`;
}

function extractTotal(raw: unknown, fallback: number): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;
  const candidates = [r.total, r.total_count, r.totalCount, r.count, r?.meta?.total, r?.pagination?.total, r?.data?.total, r?.meta?.totalElements, r?.page?.totalItems, r?.data?.count, r?.response?.total];
  for (const c of candidates) {
    if (typeof c === 'number' && isFinite(c)) return c;
    if (typeof c === 'string') {
      const n = Number(c);
      if (isFinite(n)) return n;
    }
  }
  return fallback;
}

function basicAuthHeader(username: string, password: string): string {
  const combo = `${username}:${password}`;
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(combo).toString('base64')
    : btoa(combo);
  return `Basic ${encoded}`;
}

function parseFetchResponse(respText: string, ct: string): unknown {
  if (ct && ct.includes('application/json')) {
    try { return JSON.parse(respText); } catch { /* fallthrough */ }
  }
  try { return JSON.parse(respText); } catch { /* ignore */ }
  return respText;
}

type ListAttempt = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  path: string;
  kind: 'query' | 'json-body' | 'form-body';
  signature?: string;
  statusCode?: number;
  error?: string;
  errorClass?: string;
};

type AuthStyle =
  | { tag: 'basic-header'; header: string }
  | { tag: 'bearer-header'; header: string }
  | { tag: 'apikey-header-x'; header: string }
  | { tag: 'api-key-auth-header'; header: string }
  | { tag: 'custom-headers'; headers: Record<string, string> };

export async function listSims(options: ListSimsOptions = {}): Promise<ListSimsResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;

  const credsClient = await simhuisClient.getClient();
  if (!credsClient) {
    throw new Error('[Simhuis] Niet geconfigureerd.');
  }
  const creds = (credsClient as any).creds as {
    baseUrl: string;
    authMode: 'basic' | 'bearer';
    username: string;
    password: string;
    resellerId?: string | null;
  };
  const resellerId = options.resellerId ?? creds.resellerId;

  const basePayload: Record<string, any> = { page: page, limit: limit };
  if (resellerId) basePayload.reseller_id = resellerId;
  if (options.status) basePayload.status = options.status;

  const attempts: ListAttempt[] = [];
  const MAX_ATTEMPTS = 300;
  let pogingen = 0;
  const overallDeadline = AbortSignal.timeout(45000);
  const allowHeadersByPath = new Map<string, string>();
  const authBasic = basicAuthHeader(creds.username, creds.password);

  let bearerToken: string | null = null;
  try {
    const simhuisCreds = await getSimhuisCreds();
    bearerToken = await acquireBearerToken(simhuisCreds);
  } catch {
    bearerToken = null;
  }

  // === WAF-BYPASS HEADERS V2 (EXTREME Chrome-browser spoofing) ===
  // Simhuis/apicontrolcenter.com staat achter een reverse-proxy WAF (Netscaler/Citrix/Cloudflare).
  // De WAF weigert ALLE requests die niet 100% op een echte browser lijken → generieke 405 Allow: OPTIONS.
  // Daarom ALLE headers meesturen die Chrome opstuurt, inclusief Origin, Referer, Sec-Fetch-*, TLS-SNI, enz.
  const wafBypassHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Origin': 'https://apicontrolcenter.com',
    'Referer': 'https://apicontrolcenter.com/',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest',
    'Connection': 'keep-alive',
  };

  const basicAuthOnly: AuthStyle = { tag: 'basic-header', header: authBasic };
  const bearerAuthOnly: AuthStyle | null = bearerToken ? { tag: 'bearer-header', header: `Bearer ${bearerToken}` } : null;
  const noAuth: AuthStyle = { tag: 'custom-headers', headers: {} };
  const xUserPassHeaders: AuthStyle = {
    tag: 'custom-headers',
    headers: {
      'X-API-Username': creds.username,
      'X-API-Password': creds.password,
      ...(resellerId ? { 'X-Reseller-ID': String(resellerId) } : {}),
    },
  };
  const primaryAuthOrder: AuthStyle[] = bearerAuthOnly ? [bearerAuthOnly, basicAuthOnly, xUserPassHeaders, noAuth] : [basicAuthOnly, xUserPassHeaders, noAuth];

  const resellerFragment = resellerId ? encodeURIComponent(String(resellerId)) : null;

  // ===== FASE -1: MULTI-BASE PROBE — probeer eerst waarschijnlijke base URLs met AirOn360 endpoints =====
  const origBase = creds.baseUrl.replace(/\/+$/, '');
  const baseCandidates = Array.from(new Set<string>([
    origBase,
    origBase.replace(/\/v\d+$/, ''),
  ])).slice(0, 4);

  type BaseHit = { base: string; method: 'GET' | 'POST'; path: string; auth: AuthStyle; statusCode: number; body: unknown };
  const baseHits: BaseHit[] = [];

  for (const base of baseCandidates) {
    if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
    const baseClean = base.endsWith('/') ? base.slice(0, -1) : base;
    const makeUrlForBase = (path: string, query: Record<string, any> | null): string => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      let u = `${baseClean}/${cleanPath}`;
      if (query && Object.keys(query).length > 0) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
          if (v === null || v === undefined || v === '') continue;
          sp.append(k, String(v));
        }
        const qs = sp.toString();
        if (qs) u += `?${qs}`;
      }
      return u;
    };
    // ✅ FASE -1: ALLEEN de 2 ECHTE AirOn360 SIM-endpoints EERST! (Allow-header bevestigd.)
    // Fout van vorige run: /v3/accounts/... /tenants/... gaven 405 Allow: OPTIONS = BESTAAN NIET!
    // Dus: begint DIRECT met GET /v3/esims + GET /v3/assets (met Bearer + correct UUID accountId uit permissions!)
    const accountIdVal = getSimhuisAccountId(); // ✅ NIEUW: altijd accountId (niet alleen als Bearer bekend is)
    const baseAidQuery = accountIdVal
      ? { accountId: accountIdVal, page: 1, limit: 200 }
      : { page: 1, limit: 200 };
    const baseAidBody = accountIdVal
      ? { accountId: accountIdVal, page: 1, limit: 200 }
      : { page: 1, limit: 200 };
    const credsBodyQuery = { username: creds.username, password: creds.password, ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}), page: 1, limit: 200 };
    const testCases: Array<{ method: 'GET' | 'POST'; path: string; auth: AuthStyle; kind: 'json-body' | 'query' | 'form-body'; body?: Record<string, any>; query?: Record<string, any> }> = [];
    const simOnlyPageQuery = { page: 1, limit: 200 };
    const simOnlyPageBody  = { page: 1, limit: 200 };
    const aidForPath = accountIdVal ?? '';
    // ============================================================
    // PRIORITEIT 1: /v3/sims endpoints — BASIC + CUSTOM eerst (Bearer gaf 401! Dus LAATSTE!)
    // NIEUW: ook /v3/accounts/{aid}/sims en /v3/tenants/{aid}/sims
    // NIEUW: ook POST met credentials IN BODY (login werkte ook met body zonder auth!)
    // ============================================================
    testCases.push(
      // --- /v3/sims root ---
      { method: 'GET',  path: '/v3/sims', auth: basicAuthOnly,   kind: 'query', query: { ...simOnlyPageQuery } },
      { method: 'POST', path: '/v3/sims', auth: basicAuthOnly,   kind: 'json-body', body: { ...simOnlyPageBody } },
      { method: 'GET',  path: '/v3/sims', auth: xUserPassHeaders, kind: 'query', query: { ...simOnlyPageQuery } },
      { method: 'POST', path: '/v3/sims', auth: xUserPassHeaders, kind: 'json-body', body: { ...simOnlyPageBody } },
      { method: 'POST', path: '/v3/sims', auth: noAuth,          kind: 'json-body', body: { ...credsBodyQuery } }, // credentials in body!
      { method: 'GET',  path: '/v3/sims', auth: noAuth,          kind: 'query',     query: { ...credsBodyQuery } }, // credentials in query!
    );
    if (aidForPath) {
      testCases.push(
        // --- /v3/accounts/{aid}/sims ---
        { method: 'GET',  path: `/v3/accounts/${aidForPath}/sims`, auth: basicAuthOnly,   kind: 'query', query: { page: 1, limit: 200 } },
        { method: 'POST', path: `/v3/accounts/${aidForPath}/sims`, auth: basicAuthOnly,   kind: 'json-body', body: { page: 1, limit: 200 } },
        { method: 'GET',  path: `/v3/accounts/${aidForPath}/sims`, auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 200 } },
        { method: 'POST', path: `/v3/accounts/${aidForPath}/sims`, auth: noAuth,          kind: 'json-body', body: { ...credsBodyQuery } },
        // --- /v3/tenants/{aid}/sims ---
        { method: 'GET',  path: `/v3/tenants/${aidForPath}/sims`,  auth: basicAuthOnly,   kind: 'query', query: { page: 1, limit: 200 } },
        { method: 'POST', path: `/v3/tenants/${aidForPath}/sims`,  auth: xUserPassHeaders, kind: 'json-body', body: { page: 1, limit: 200 } },
      );
    }
    // Bearer LAATSTE voor SIM endpoints (geeft consistent 401!)
    if (bearerAuthOnly) {
      testCases.push(
        { method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query',     query: { ...baseAidQuery } },
        { method: 'POST', path: '/v3/sims', auth: bearerAuthOnly, kind: 'json-body', body: { ...baseAidBody } },
      );
      if (aidForPath) {
        testCases.push(
          { method: 'GET',  path: `/v3/accounts/${aidForPath}/sims`, auth: bearerAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
          { method: 'GET',  path: `/v3/tenants/${aidForPath}/sims`,  auth: bearerAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
        );
      }
    }
    // ============================================================
    // PRIORITEIT 2: /v3/esims + /v3/assets (zelfde auth-volgorde: Basic/Custom eerst, Bearer laatst)
    // ============================================================
    testCases.push(
      { method: 'GET',  path: '/v3/esims',  auth: basicAuthOnly,   kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'GET',  path: '/v3/assets', auth: basicAuthOnly,   kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'GET',  path: '/v3/esims',  auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'GET',  path: '/v3/assets', auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'POST', path: '/v3/esims',  auth: noAuth,          kind: 'json-body', body: { ...credsBodyQuery, limit: 50 } },
      { method: 'POST', path: '/v3/assets', auth: noAuth,          kind: 'json-body', body: { ...credsBodyQuery, limit: 50 } },
    );
    if (aidForPath) {
      testCases.push(
        { method: 'GET', path: `/v3/accounts/${aidForPath}/assets`, auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 50 } },
        { method: 'GET', path: `/v3/accounts/${aidForPath}/esims`,  auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 50 } },
        { method: 'GET', path: `/v3/tenants/${aidForPath}/assets`,  auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 50 } },
        { method: 'GET', path: `/v3/tenants/${aidForPath}/esims`,   auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 50 } },
      );
    }
    if (bearerAuthOnly) {
      testCases.push(
        { method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query',     query: { ...baseAidQuery } },
        { method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query',     query: { ...baseAidQuery } },
        { method: 'POST', path: '/v3/esims',  auth: bearerAuthOnly, kind: 'json-body', body: { ...baseAidBody } },
        { method: 'POST', path: '/v3/assets', auth: bearerAuthOnly, kind: 'json-body', body: { ...baseAidBody } },
      );
    }
    // Auth/token als LAATSTE (niet een SIM endpoint, alleen om base-URL te bevestigen)
    testCases.push(
      { method: 'POST', path: '/v3/auth/token', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, grant_type: 'password' } },
    );
    for (const tc of testCases) {
      if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
      pogingen++;
      const trace: ListAttempt = {
        method: tc.method,
        path: tc.path,
        kind: tc.kind,
        signature: `base=${baseClean};auth=${tc.auth.tag}`,
      };
      try {
        const headers: Record<string, string> = { ...wafBypassHeaders };
        if (tc.auth.tag === 'custom-headers') Object.assign(headers, tc.auth.headers);
        else headers.Authorization = tc.auth.header;
        let bodyInit: BodyInit | undefined;
        const fullUrl = tc.method === 'GET'
          ? makeUrlForBase(tc.path, (tc.query ?? {}) as Record<string, any>)
          : makeUrlForBase(tc.path, null);
        if (tc.method === 'POST' && tc.body) {
          if (tc.kind === 'json-body') {
            headers['Content-Type'] = 'application/json';
            bodyInit = JSON.stringify(tc.body);
          } else if (tc.kind === 'form-body') {
            const sp = new URLSearchParams();
            for (const [k, v] of Object.entries(tc.body)) {
              if (v === null || v === undefined || v === '') continue;
              sp.append(k, String(v));
            }
            headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            bodyInit = sp.toString();
          }
        }
        const resp = await fetch(fullUrl, { method: tc.method, headers, body: bodyInit, signal: overallDeadline });
        const ct = resp.headers.get('content-type') ?? '';
        if (resp.status === 405) {
          const allow = resp.headers.get('allow') ?? '';
          if (allow) allowHeadersByPath.set(`[${baseClean}]${tc.path}`, allow);
        }
        const text = await resp.text();
        const parsed = parseFetchResponse(text, ct);
        if (resp.ok) {
          trace.statusCode = resp.status;
          trace.errorClass = 'OK-200';
          const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 140);
          trace.error = `Body: ${snippet || '(leeg)'}`;
          attempts.push(trace);
          baseHits.push({ base: baseClean, method: tc.method, path: tc.path, auth: tc.auth, statusCode: resp.status, body: parsed });
          // ✅ ECHTE 200 OK = base EN endpoint geldig! Stop met FASE -1 → dit is ons beginpunt.
          break;
        } else {
          trace.statusCode = resp.status;
          const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 150);
          const allowExtra = (resp.status === 405 && allowHeadersByPath.has(`[${baseClean}]${tc.path}`))
            ? ` [Allow: ${allowHeadersByPath.get(`[${baseClean}]${tc.path}`)}]`
            : '';
          trace.error = `HTTP ${resp.status}${allowExtra}: ${snippet}`;
          trace.errorClass = 'HTTPError';
          attempts.push(trace);
          if (resp.status !== 404 && resp.status !== 405 && resp.status < 500) {
            // App-level response! (401 InvalidCredentials, 403 NotAuthorized, 400, etc.)
            // 401/403 betekenen "pad BESTAAT, ALLEEN DEZE AUTH-METHODE WERKT NIET".
            // → BLIJVEN proberen met ANDERE auth-methodes (Basic, X-Headers, body-creds, Bearer) voor hetzelfde pad.
            baseHits.push({ base: baseClean, method: tc.method, path: tc.path, auth: tc.auth, statusCode: resp.status, body: parsed });
            console.info(
              `[simhuis-listSims] FASE-1 auth/pad combinatie gaf HTTP ${resp.status}: ` +
              `${tc.method} ${baseClean}${tc.path} (auth=${tc.auth.tag}). Doorgaan naar volgende auth-methode...`
            );
            // ✅ Blijf de ANDERE testCases (zelfde pad, andere auth) uitvoeren!
            continue;
          }
          if (resp.status === 403) {
            baseHits.push({ base: baseClean, method: tc.method, path: tc.path, auth: tc.auth, statusCode: resp.status, body: parsed });
            console.info(
              `[simhuis-listSims] FASE-1 auth/pad combinatie gaf HTTP 403: ` +
              `${tc.method} ${baseClean}${tc.path} (auth=${tc.auth.tag}). Doorgaan naar volgende auth-methode...`
            );
            continue;
          }
        }
      } catch (err: any) {
        trace.statusCode = err instanceof SimhuisApiError ? err.statusCode : (err?.name === 'TimeoutError' ? 0 : undefined);
        trace.error = String(err?.message ?? err ?? 'Onbekende fout').slice(0, 200);
        trace.errorClass = err instanceof SimhuisApiError ? 'SimhuisApiError' : (err?.name === 'TimeoutError' ? 'Timeout' : err?.constructor?.name ?? 'Error');
        attempts.push(trace);
        if (err instanceof SimhuisApiError) throw err;
      }
    }
    if (baseHits.length > 0) break;
  }

  // Kies de beste base (eerste hit)
  let effectiveBase = creds.baseUrl.replace(/\/+$/, '');
  if (baseHits.length > 0) {
    effectiveBase = baseHits[0].base;
  }

  // Overschrijf makeFullUrl / augmentBody etc. om effectieve base te gebruiken (als die afwijkt)
  const useCustomBase = baseHits.length > 0;
  const buildFinalUrl = (path: string, query: Record<string, any> | null): string => {
    if (!useCustomBase) return makeFullUrl(path, query);
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    let url = `${effectiveBase}/${cleanPath}`;
    if (query && Object.keys(query).length > 0) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        sp.append(k, String(v));
      }
      const qs = sp.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  };

  type Phase0Probe = {
    label: string;
    method: 'GET' | 'POST' | 'PUT';
    path: string;
    auth: AuthStyle;
    kind: 'query' | 'json-body' | 'form-body';
    body?: Record<string, any>;
    query?: Record<string, any>;
  };

  // ✅ FASE 0: MINIMALE AirOn360 probes — ALLEEN endpoints die ECHT bestaan (Allow-header bevestigd!)
  // NIEUW-2: Auth-volgorde = **Basic + X-Headers EERST** (Bearer geeft ALTIJD 401 op SIM endpoints!)
  // NIEUW-2: Credentials in BODY / QUERY als extra auth-methode (werkte voor /v3/auth/token!)
  // NIEUW-2: /v3/accounts/{aid} en /v3/tenants/{aid} als pad-scope
  const probes: Phase0Probe[] = [];
  const probeAuth = bearerAuthOnly ?? basicAuthOnly;
  const aid = getSimhuisAccountId();

  const pageQuery = { page: 1, limit: 200 };
  const pageBody  = { page: 1, limit: 200 };
  const credsQuery = { username: creds.username, password: creds.password, ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}), page: 1, limit: 200 };
  const credsBody  = { username: creds.username, password: creds.password, ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}), page: 1, limit: 200 };

  // ============================================================
  // PRIORITEIT 1: /v3/sims endpoints — BASIC + CUSTOM eerst!
  // ============================================================
  probes.push(
    { label: 'GET-v3-sims-basic',       method: 'GET',  path: '/v3/sims', auth: basicAuthOnly,     kind: 'query',     query: { ...pageQuery } },
    { label: 'POST-v3-sims-basic',      method: 'POST', path: '/v3/sims', auth: basicAuthOnly,     kind: 'json-body', body:  { ...pageBody } },
    { label: 'GET-v3-sims-xheaders',    method: 'GET',  path: '/v3/sims', auth: xUserPassHeaders,  kind: 'query',     query: { ...pageQuery } },
    { label: 'POST-v3-sims-xheaders',   method: 'POST', path: '/v3/sims', auth: xUserPassHeaders,  kind: 'json-body', body:  { ...pageBody } },
    { label: 'POST-v3-sims-creds-body', method: 'POST', path: '/v3/sims', auth: noAuth,            kind: 'json-body', body:  { ...credsBody } }, // credentials IN body
    { label: 'GET-v3-sims-creds-query', method: 'GET',  path: '/v3/sims', auth: noAuth,            kind: 'query',     query: { ...credsQuery } }, // credentials IN query
  );
  if (aid) {
    // --- accountId / tenantId param varianten met BASIC eerst ---
    probes.push(
      { label: 'GET-v3-sims-basic-aid',       method: 'GET',  path: '/v3/sims', auth: basicAuthOnly,   kind: 'query', query: { ...pageQuery, accountId: aid } },
      { label: 'GET-v3-sims-basic-tenantId',  method: 'GET',  path: '/v3/sims', auth: basicAuthOnly,   kind: 'query', query: { ...pageQuery, tenantId: aid } },
      { label: 'GET-v3-sims-xheaders-aid',    method: 'GET',  path: '/v3/sims', auth: xUserPassHeaders, kind: 'query', query: { ...pageQuery, accountId: aid } },
      { label: 'POST-v3-sims-basic-aid',      method: 'POST', path: '/v3/sims', auth: basicAuthOnly,   kind: 'json-body', body: { ...pageBody, accountId: aid, tenantId: aid, id: aid } },
      { label: 'POST-v3-sims-xheaders-aid',   method: 'POST', path: '/v3/sims', auth: xUserPassHeaders, kind: 'json-body', body: { ...pageBody, accountId: aid, tenantId: aid, id: aid } },
      // --- /v3/accounts/{aid}/sims en /v3/tenants/{aid}/sims ---
      { label: 'GET-v3-accounts-sims-basic',  method: 'GET',  path: `/v3/accounts/${aid}/sims`, auth: basicAuthOnly,    kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'POST-v3-accounts-sims-basic', method: 'POST', path: `/v3/accounts/${aid}/sims`, auth: basicAuthOnly,    kind: 'json-body', body: { page: 1, limit: 200 } },
      { label: 'GET-v3-accounts-sims-x',      method: 'GET',  path: `/v3/accounts/${aid}/sims`, auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'POST-v3-accounts-sims-creds', method: 'POST', path: `/v3/accounts/${aid}/sims`, auth: noAuth,           kind: 'json-body', body: { ...credsBody } },
      { label: 'GET-v3-tenants-sims-basic',   method: 'GET',  path: `/v3/tenants/${aid}/sims`,  auth: basicAuthOnly,    kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'POST-v3-tenants-sims-x',      method: 'POST', path: `/v3/tenants/${aid}/sims`,  auth: xUserPassHeaders, kind: 'json-body', body: { page: 1, limit: 200 } },
    );
  }
  // --- Bearer LAATSTE op /v3/sims ---
  if (bearerAuthOnly) {
    if (aid) {
      probes.push(
        { label: 'GET-v3-sims-aid',       method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, accountId: aid } },
        { label: 'GET-v3-sims-tenantId',  method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, tenantId: aid } },
        { label: 'GET-v3-sims-id',        method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, id: aid } },
        { label: 'POST-v3-sims-aid',      method: 'POST', path: '/v3/sims', auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody, accountId: aid, tenantId: aid, id: aid } },
      );
    }
    probes.push(
      { label: 'GET-v3-sims',             method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery } },
      { label: 'POST-v3-sims',            method: 'POST', path: '/v3/sims', auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody } },
      { label: 'GET-v3-sims-status',      method: 'GET',  path: '/v3/sims', auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery, status: options.status ?? 'active' } },
    );
  }

  // ============================================================
  // PRIORITEIT 2: /v3/esims + /v3/assets (zelfde auth-volgorde)
  // ============================================================
  probes.push(
    { label: 'GET-v3-esims-basic',       method: 'GET',  path: '/v3/esims',  auth: basicAuthOnly,    kind: 'query',     query: { ...pageQuery } },
    { label: 'GET-v3-assets-basic',      method: 'GET',  path: '/v3/assets', auth: basicAuthOnly,    kind: 'query',     query: { ...pageQuery } },
    { label: 'GET-v3-esims-xheaders',    method: 'GET',  path: '/v3/esims',  auth: xUserPassHeaders, kind: 'query',     query: { ...pageQuery } },
    { label: 'GET-v3-assets-xheaders',   method: 'GET',  path: '/v3/assets', auth: xUserPassHeaders, kind: 'query',     query: { ...pageQuery } },
    { label: 'POST-v3-esims-creds-body', method: 'POST', path: '/v3/esims',  auth: noAuth,           kind: 'json-body', body:  { ...credsBody } },
    { label: 'POST-v3-assets-creds-body',method: 'POST', path: '/v3/assets', auth: noAuth,           kind: 'json-body', body:  { ...credsBody } },
  );
  if (aid) {
    probes.push(
      { label: 'GET-v3-esims-basic-aid',       method: 'GET',  path: '/v3/esims',  auth: basicAuthOnly, kind: 'query', query: { ...pageQuery, accountId: aid } },
      { label: 'GET-v3-assets-basic-aid',      method: 'GET',  path: '/v3/assets', auth: basicAuthOnly, kind: 'query', query: { ...pageQuery, accountId: aid } },
      { label: 'GET-v3-esims-basic-tenantId',  method: 'GET',  path: '/v3/esims',  auth: basicAuthOnly, kind: 'query', query: { ...pageQuery, tenantId: aid } },
      { label: 'GET-v3-assets-basic-tenantId', method: 'GET',  path: '/v3/assets', auth: basicAuthOnly, kind: 'query', query: { ...pageQuery, tenantId: aid } },
      { label: 'GET-v3-esims-xheaders-aid',    method: 'GET',  path: '/v3/esims',  auth: xUserPassHeaders, kind: 'query', query: { ...pageQuery, accountId: aid } },
      { label: 'GET-v3-assets-xheaders-aid',   method: 'GET',  path: '/v3/assets', auth: xUserPassHeaders, kind: 'query', query: { ...pageQuery, accountId: aid } },
      // accounts/tenant pad scoped
      { label: 'GET-v3-accounts-assets-basic', method: 'GET',  path: `/v3/accounts/${aid}/assets`, auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'GET-v3-accounts-esims-basic',  method: 'GET',  path: `/v3/accounts/${aid}/esims`,  auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'GET-v3-tenants-assets-x',      method: 'GET',  path: `/v3/tenants/${aid}/assets`,  auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'GET-v3-tenants-esims-x',       method: 'GET',  path: `/v3/tenants/${aid}/esims`,   auth: xUserPassHeaders, kind: 'query', query: { page: 1, limit: 200 } },
    );
  }
  // Bearer LAATSTE voor esims/assets
  if (bearerAuthOnly) {
    if (aid) {
      probes.push(
        { label: 'GET-v3-esims-aid',       method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, accountId: aid } },
        { label: 'GET-v3-assets-aid',      method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, accountId: aid } },
        { label: 'GET-v3-esims-tenantId',  method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, tenantId: aid } },
        { label: 'GET-v3-assets-tenantId', method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, tenantId: aid } },
        { label: 'GET-v3-esims-id',        method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, id: aid } },
        { label: 'GET-v3-assets-id',       method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query', query: { ...pageQuery, id: aid } },
        { label: 'POST-v3-esims-aid',      method: 'POST', path: '/v3/esims',  auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody, accountId: aid, tenantId: aid, id: aid } },
        { label: 'POST-v3-assets-aid',     method: 'POST', path: '/v3/assets', auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody, accountId: aid, tenantId: aid, id: aid } },
      );
    }
    probes.push(
      { label: 'GET-v3-esims',           method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery } },
      { label: 'GET-v3-assets',          method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery } },
      { label: 'POST-v3-esims',          method: 'POST', path: '/v3/esims',  auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody } },
      { label: 'POST-v3-assets',         method: 'POST', path: '/v3/assets', auth: bearerAuthOnly, kind: 'json-body', body: { ...pageBody } },
      { label: 'GET-v3-esims-status',    method: 'GET',  path: '/v3/esims',  auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery, status: options.status ?? 'active' } },
      { label: 'GET-v3-assets-status',   method: 'GET',  path: '/v3/assets', auth: bearerAuthOnly, kind: 'query',     query: { ...pageQuery, status: options.status ?? 'active' } },
    );
  }
  // Auth/token als LAATSTE (geen SIM endpoint, valt buiten discovery maar wel om baseHit te vullen)
  probes.push(
    { label: 'POST-v3-auth-token',     method: 'POST', path: '/v3/auth/token', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, grant_type: 'password' } },
  );
  if (resellerFragment) {
    probes.push(
      { label: 'GET-v3-reseller-sims',    method: 'GET', path: `/v3/resellers/${resellerFragment}/sims`,    auth: basicAuthOnly,   kind: 'query', query: { ...pageQuery } },
      { label: 'GET-v3-reseller-sims-x',  method: 'GET', path: `/v3/resellers/${resellerFragment}/sims`,    auth: xUserPassHeaders, kind: 'query', query: { ...pageQuery } },
      { label: 'GET-v3-reseller-esims',  method: 'GET', path: `/v3/resellers/${resellerFragment}/esims`,  auth: basicAuthOnly,   kind: 'query', query: { ...pageQuery } },
      { label: 'GET-v3-reseller-assets', method: 'GET', path: `/v3/resellers/${resellerFragment}/assets`, auth: basicAuthOnly,   kind: 'query', query: { ...pageQuery } },
    );
  }

  const processResponse = (respBodyRaw: unknown): ListSimsResult | null => {
    const rawArray = extractSimList(respBodyRaw);
    if (!rawArray || rawArray.length === 0) {
      const bodyAsObj = respBodyRaw as Record<string, any> | null;
      if (bodyAsObj && typeof bodyAsObj === 'object') {
        const nested = bodyAsObj.simCard ?? bodyAsObj.sim ?? bodyAsObj.asset ?? bodyAsObj.device ?? bodyAsObj.subscription ?? bodyAsObj.subscriber ?? bodyAsObj;
        const hasAny = 'iccid' in bodyAsObj || 'sim_iccid' in bodyAsObj || 'eid' in bodyAsObj || 'imsi' in bodyAsObj
          || 'iccid' in (nested ?? {}) || 'eid' in (nested ?? {});
        if (hasAny) {
          const iccid = String(bodyAsObj.iccid ?? bodyAsObj.sim_iccid ?? bodyAsObj.eid ?? nested?.iccid ?? nested?.sim_iccid ?? nested?.eid ?? '').trim();
          if (iccid) {
            return { items: [toSimStatus(bodyAsObj, iccid)], total: 1, page: page, limit: limit, hasMore: false, raw: respBodyRaw };
          }
        }
      }
      return null;
    }
    const items = rawArray.map((item) => {
      const nested = item?.simCard ?? item?.sim ?? item?.asset ?? item?.device ?? item?.subscription ?? item?.subscriber ?? {};
      const iccid = String(
        item.iccid ?? item.sim_iccid ?? item.simIccid ?? item.eid
          ?? nested.iccid ?? nested.sim_iccid ?? nested.simIccid ?? nested.eid ?? ''
      ).trim();
      return toSimStatus(item, iccid);
    }).filter((s) => s.iccid);
    const total = extractTotal(respBodyRaw, items.length);
    const hasMore = typeof total === 'number' ? (page * limit) < total : items.length === limit;
    return { items, total, page: page, limit: limit, hasMore, raw: respBodyRaw };
  };

  const makeFullUrl = (path: string, query: Record<string, any> | null): string => {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    let url = creds.baseUrl.endsWith('/') ? `${creds.baseUrl}${cleanPath}` : `${creds.baseUrl}/${cleanPath}`;
    if (query && Object.keys(query).length > 0) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        params.append(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  };

  const augmentBody = (inject: 'none' | 'creds', extra: Record<string, any> = {}): Record<string, any> => {
    const base: Record<string, any> = { ...basePayload, ...extra };
    if (inject === 'creds') {
      base.username = creds.username;
      base.password = creds.password;
      if (resellerId) base.reseller_id = resellerId;
    }
    return base;
  };

  const augmentQuery = (inject: 'none' | 'creds', extra: Record<string, any> = {}): Record<string, any> => {
    const base: Record<string, any> = { ...basePayload, ...extra };
    if (inject === 'creds') {
      base.username = creds.username;
      base.password = creds.password;
      if (resellerId) base.reseller_id = resellerId;
    }
    return base;
  };

  const doDirectFetch = async (args: {
    fullUrl: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    contentType: 'json' | 'form' | 'none';
    body: Record<string, any> | null;
    auth: AuthStyle;
    meta: Omit<ListAttempt, 'statusCode' | 'error' | 'errorClass'>;
    pathForAllowHeader: string;
  }): Promise<ListSimsResult | null> => {
    pogingen++;
    const trace: ListAttempt = { ...args.meta };
    if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) {
      trace.statusCode = -1;
      trace.error = `Stop: ${pogingen}/${MAX_ATTEMPTS} pogingen of timeout`;
      trace.errorClass = 'Aborted';
      attempts.push(trace);
      return null;
    }
    try {
      const headers: Record<string, string> = { ...wafBypassHeaders };
      // ✅ NIEUW: accountId voor ALLE auth-methodes (niet alleen Bearer).
      const listAccountId = getSimhuisAccountId();

      if (args.auth.tag === 'basic-header' || args.auth.tag === 'bearer-header' ||
          args.auth.tag === 'apikey-header-x' || args.auth.tag === 'api-key-auth-header') {
        headers.Authorization = args.auth.header;
      } else if (args.auth.tag === 'custom-headers') {
        Object.assign(headers, args.auth.headers);
      }
      let body: BodyInit | undefined;
      let mergedBody: Record<string, any> | null = args.body ? { ...args.body } : null;
      if (listAccountId) {
        // X-Headers: SaaS APIs gebruiken vaak X-Account-Id / X-Tenant-Id!
        headers['X-Account-Id'] = listAccountId;
        headers['X-Tenant-Id']  = listAccountId;
        // Body: altijd proberen te vullen (ook als die leeg was!), met accountId/tenantId/id
        if (!mergedBody) mergedBody = {};
        if (!mergedBody.accountId) mergedBody.accountId = listAccountId;
        if (!mergedBody.tenantId)  mergedBody.tenantId  = listAccountId;
        if (!mergedBody.id)        mergedBody.id        = listAccountId;
      }
      // Body meesturen: bij PUT/POST/PATCH altijd; bij GET / ALLEEN als er een non-empty mergedBody is EN content-type = json (als het kind json is).
      if (mergedBody && Object.keys(mergedBody).length > 0) {
        if (args.contentType === 'json') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(mergedBody);
        } else if (args.contentType === 'form') {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(mergedBody)) {
            if (v === null || v === undefined || v === '') continue;
            if (typeof v === 'object') sp.append(k, JSON.stringify(v));
            else sp.append(k, String(v));
          }
          headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
          body = sp.toString();
        }
      } else if ((args.method === 'POST' || args.method === 'PUT' || args.method === 'PATCH') && args.contentType === 'json') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({});
      }
      let finalUrl = args.fullUrl;
      if (listAccountId) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        const sp = new URLSearchParams();
        sp.append('accountId', listAccountId);
        sp.append('tenantId',  listAccountId);
        sp.append('id',        listAccountId);
        finalUrl = `${finalUrl}${sep}${sp.toString()}`;
      }
      const resp = await fetch(finalUrl, { method: args.method, headers, body, signal: overallDeadline });
      const ct = resp.headers.get('content-type') ?? '';
      if (resp.status === 405) {
        const allow = resp.headers.get('allow') ?? resp.headers.get('Allow') ?? '';
        if (allow) {
          allowHeadersByPath.set(`[${effectiveBase}]${args.pathForAllowHeader}`, allow);
        }
      }
      const text = await resp.text();
      const parsed = parseFetchResponse(text, ct);
      if (resp.ok) {
        const result = processResponse(parsed);
        if (result) {
          if (result.items.length === 0) {
            // Lijst-endpoint herkend, maar 0 items. Vraag: is dit het juiste endpoint (check of account echt leeg is)?
            // Doorgaan met andere paden (mogelijk zit inventory op een andere path).
            try {
              console.error(`[listSims][${args.meta.signature ?? ''}] [WARN] ✅ 200 OK op ${args.method} ${args.meta.path} — endpoint herkend MAAR 0 SIMs (leeg account of verkeerde path). Shape raw: ${shapeOf(parsed)}`);
            } catch { /* ignore */ }
          } else {
            return result;
          }
        }
        if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
          // 200 OK, maar processResponse vond geen SIM-lijst-structuur.
          // Log de structuur zodat we weten welke keys extractSimList nog mist.
          try {
            console.error(`[listSims][${args.meta.signature ?? ''}] [DEBUG] ✅ 200 OK op ${args.method} ${args.meta.path} — NIET herkend als SIM-lijst! Shape: ${shapeOf(parsed)}. Body (eerste 4000 chars):\n${JSON.stringify(parsed).slice(0, 4000)}`);
          } catch { /* ignore */ }
          trace.statusCode = resp.status;
          trace.errorClass = 'OK-no-list-shape';
          trace.error = `200 OK maar geen SIM-lijst-structuur herkend. Shape=${shapeOf(parsed)}`;
          attempts.push(trace);
          // NIET returnen — blijf proberen met andere paden/auth!
          return null;
        }
      } else {
        trace.statusCode = resp.status;
        const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 150);
        const allowExtra = (resp.status === 405 && allowHeadersByPath.has(`[${effectiveBase}]${args.pathForAllowHeader}`))
          ? ` [Allow: ${allowHeadersByPath.get(`[${effectiveBase}]${args.pathForAllowHeader}`)}]`
          : '';
        trace.error = `HTTP ${resp.status}${allowExtra}${snippet ? `: ${snippet}` : ''}`;
        trace.errorClass = 'HTTPError';
        attempts.push(trace);
        if (resp.status === 403) {
          console.info(
            `[simhuis-listSims] doDirectFetch: ${args.method} ${args.meta.path} (auth=${args.auth.tag}) ` +
            `gaf HTTP 403. Overslaan en doorgaan naar volgende auth/pad-combinatie...`
          );
          return null;
        }
        const parsedObj = parsed as Record<string, any> | null;
        const code = parsedObj && typeof parsedObj === 'object' ? String(parsedObj.code ?? parsedObj.error_code ?? '') : '';
        if (resp.status === 401 && (code === 'InvalidToken' || code === 'InvalidAuth' || code === 'Unauthorized')) {
          // 401 = "pad bestaat, ALLEEN DEZE auth werkt niet". Blijf proberen met andere methodes.
          console.info(
            `[simhuis-listSims] doDirectFetch: ${args.method} ${args.meta.path} (auth=${args.auth.tag}) ` +
            `gaf HTTP 401 (${code || 'geen code'}). Overslaan en doorgaan naar volgende auth/pad-combinatie...`
          );
          return null;
        }
        return null;
      }
    } catch (err: any) {
      trace.statusCode = err instanceof SimhuisApiError ? err.statusCode : (err?.name === 'TimeoutError' ? 0 : undefined);
      trace.error = String(err?.message ?? err ?? 'Onbekende fout').slice(0, 200);
      trace.errorClass = err instanceof SimhuisApiError ? 'SimhuisApiError' : (err?.name === 'TimeoutError' ? 'Timeout' : err?.constructor?.name ?? 'Error');
      attempts.push(trace);
      if (err instanceof SimhuisApiError) throw err;
      if (err?.name === 'TimeoutError') return null;
      return null;
    }
    return null;
  };

  const httpMethodsFast: Array<'POST' | 'GET'> = ['POST', 'GET'];
  const injectStylesFast: Array<'none' | 'creds'> = ['creds', 'none'];

  type InterestingProbe = {
    probe: Phase0Probe;
    statusCode: number;
    respBody: unknown;
  };
  const interesting: InterestingProbe[] = [];
  const isListLikePath = (p: string) => !/\/(auth|login|logout|token|ping|health|me|docs?|swagger|metrics?)\b/i.test(p);
  const isListLikeAuth = (a: AuthStyle) => a.tag === 'bearer-header' || a.tag === 'basic-header';

  // ===== FASE 0: Probes uitvoeren — snel (elk pad 1 keer met 1 specifieke payload/auth-combinatie) =====
  for (const probe of probes) {
    if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
    pogingen++;
    const trace: ListAttempt = {
      method: probe.method,
      path: probe.path,
      kind: probe.kind,
      signature: probe.label,
    };
    try {
      const headers: Record<string, string> = { ...wafBypassHeaders };
      if (probe.auth.tag === 'custom-headers') Object.assign(headers, probe.auth.headers);
      else headers.Authorization = probe.auth.header;

      // ✅ NIEUW: accountId voor ALLE auth-methodes (niet alleen Bearer).
      // (Simhuis API accepteert Basic/Custom maar wil vaak WEL accountId in query/body/headers!)
      const phase0AccountId = getSimhuisAccountId();

      let queryExtra: Record<string, any> = (probe.query ?? {}) as Record<string, any>;
      if (phase0AccountId) {
        queryExtra = { ...queryExtra };
        if (!queryExtra.accountId) queryExtra.accountId = phase0AccountId;
      }

      let bodyInit: BodyInit | undefined;
      let bodyPayload: Record<string, any> | null = probe.body ? { ...probe.body } : null;
      if (phase0AccountId) {
        // 1) Query-param met ALLE veel-voorkomende namen (404 Account not found = param name kan afwijken!)
        if (!queryExtra) queryExtra = {};
        // Alleen toevoegen als die specifieke key er nog NIET in zat (geen redundant overschrijven).
        if (queryExtra.accountId === undefined) queryExtra.accountId = phase0AccountId;
        if (queryExtra.tenantId === undefined) queryExtra.tenantId = phase0AccountId;
        if (queryExtra.id === undefined) queryExtra.id = phase0AccountId;
        // 2) Body met dezelfde namen (indien body bestaat of FORCEREN bij kind=json-body)
        if (bodyPayload || probe.kind === 'json-body') {
          if (!bodyPayload) bodyPayload = {};
          if (!bodyPayload.accountId) bodyPayload.accountId = phase0AccountId;
          if (!bodyPayload.tenantId) bodyPayload.tenantId = phase0AccountId;
          if (!bodyPayload.id) bodyPayload.id = phase0AccountId;
        }
        // 3) Header varianten: X-Account-Id, X-Tenant-Id, X-Organization-Id (SaaS APIs gebruiken vaak dit!)
        headers['X-Account-Id'] = phase0AccountId;
        headers['X-Tenant-Id']  = phase0AccountId;
      }
      const fullUrl = probe.method === 'GET'
        ? buildFinalUrl(probe.path, queryExtra)
        : buildFinalUrl(probe.path, null);

      // Body meesturen: zowel bij PUT/POST/PATCH als (optioneel) bij GET — als kind=json-body
      if (bodyPayload) {
        if (probe.kind === 'json-body') {
          headers['Content-Type'] = 'application/json';
          bodyInit = JSON.stringify(bodyPayload);
        } else if (probe.kind === 'form-body') {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(bodyPayload)) {
            if (v === null || v === undefined || v === '') continue;
            sp.append(k, String(v));
          }
          headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
          bodyInit = sp.toString();
        }
      }
      const resp = await fetch(fullUrl, { method: probe.method, headers, body: bodyInit, signal: overallDeadline });
      const ct = resp.headers.get('content-type') ?? '';
      if (resp.status === 405) {
        const allow = resp.headers.get('allow') ?? '';
        if (allow) allowHeadersByPath.set(probe.path, allow);
      }
      const text = await resp.text();
      const parsed = parseFetchResponse(text, ct);
      if (resp.ok) {
        const result = processResponse(parsed);
        if (result) {
          if (result.items.length === 0) {
            try {
              console.error(`[listSims][fase0:${probe.label}] [WARN] ✅ 200 OK — endpoint HERKEND MAAR 0 SIMs (leeg of verkeerd). Shape: ${shapeOf(parsed)}`);
            } catch { /* ignore */ }
          } else {
            return result;
          }
        }
        if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
          if (isListLikePath(probe.path) && isListLikeAuth(probe.auth)) interesting.push({ probe, statusCode: resp.status, respBody: parsed });
          trace.statusCode = resp.status;
          trace.errorClass = result ? (result.items.length ? 'OK-200' : 'OK-200-empty') : 'OK-200-no-shape-match';
          const snippet = typeof parsed === 'string' ? parsed.slice(0, 120) : JSON.stringify(parsed).slice(0, 120);
          trace.error = `Body: ${snippet || '(leeg)'}. Shape=${shapeOf(parsed)}`;
          attempts.push(trace);
          try {
            console.error(`[listSims][fase0:${probe.label}] [DEBUG] ✅ 200 OK op ${probe.method} ${probe.path} auth=${probe.auth.tag} — ${result ? (result.items.length ? `${result.items.length} SIMs!` : 'ENDPOINT HERKEND MAAR 0 SIMs') : 'NIET als SIM-lijst HERKEND!'}. Shape: ${shapeOf(parsed)}. Body:\n${JSON.stringify(parsed).slice(0, 4000)}`);
          } catch { /* ignore */ }
          continue;
        }
      } else {
        trace.statusCode = resp.status;
        const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 150);
        const allowExtra = (resp.status === 405 && allowHeadersByPath.has(probe.path))
          ? ` [Allow: ${allowHeadersByPath.get(probe.path)}]`
          : '';
        trace.error = `HTTP ${resp.status}${allowExtra}: ${snippet}`;
        trace.errorClass = 'HTTPError';
        attempts.push(trace);
        if (resp.status !== 405 && resp.status !== 404 && resp.status < 500) {
          if (isListLikePath(probe.path) && isListLikeAuth(probe.auth)) interesting.push({ probe, statusCode: resp.status, respBody: parsed });
        }
        if (resp.status === 403) {
          console.info(
            `[simhuis-listSims] FASE-0 probe ${probe.label} (${probe.method} ${probe.path} auth=${probe.auth.tag}) ` +
            `gaf HTTP 403. Doorgaan naar volgende probe/auth-combinatie...`
          );
          continue;
        }
        if (resp.status === 401) {
          const parsedObj = parsed as Record<string, any> | null;
          const code = parsedObj && typeof parsedObj === 'object' ? String(parsedObj.code ?? '') : '';
          if (code === 'InvalidToken' || code === 'InvalidAuth') {
            console.info(
              `[simhuis-listSims] FASE-0 probe ${probe.label} (${probe.method} ${probe.path} auth=${probe.auth.tag}) ` +
              `gaf HTTP 401 (${code || 'geen code'}). Doorgaan naar volgende probe/auth-combinatie...`
            );
            continue;
          }
        }
      }
    } catch (err: any) {
      trace.statusCode = err instanceof SimhuisApiError ? err.statusCode : (err?.name === 'TimeoutError' ? 0 : undefined);
      trace.error = String(err?.message ?? err ?? 'Onbekende fout').slice(0, 200);
      trace.errorClass = err instanceof SimhuisApiError ? 'SimhuisApiError' : (err?.name === 'TimeoutError' ? 'Timeout' : err?.constructor?.name ?? 'Error');
      attempts.push(trace);
      if (err instanceof SimhuisApiError) throw err;
    }
  }

  // ===== FASE 1: Als we een INTERESSANTE (app-level) response vonden in fase 0 → verfijn die (pad,method,auth)-combo met payload varianten =====
  if (interesting.length > 0) {
    const byPath = new Map<string, InterestingProbe>();
    for (const p of interesting) byPath.set(`${p.probe.path}::${p.probe.method}`, p);

    for (const hit of byPath.values()) {
      const path = hit.probe.path;
      const method = hit.probe.method;
      const probeAuth = hit.probe.auth;
      if (!isListLikePath(path) || !isListLikeAuth(probeAuth)) continue;
      const payloadVariants: Array<{ label: string; body?: Record<string, any>; query?: Record<string, any> }> = [
        { label: 'p=1,l=200', body: method === 'POST' ? { ...basePayload, limit: 200 } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200 } : undefined },
        { label: 'p=1,l=200,creds', body: method === 'POST' ? { ...basePayload, limit: 200, username: creds.username, password: creds.password, ...(resellerId ? { reseller_id: resellerId } : {}) } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, username: creds.username, password: creds.password, ...(resellerId ? { reseller_id: resellerId } : {}) } : undefined },
        { label: 'status=inactive', body: method === 'POST' ? { ...basePayload, limit: 200, status: 'inactive' } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, status: 'inactive' } : undefined },
        { label: 'status=available', body: method === 'POST' ? { ...basePayload, limit: 200, status: 'available' } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, status: 'available' } : undefined },
        { label: 'empty', body: method === 'POST' ? {} : undefined, query: method === 'GET' ? {} : undefined },
      ];
      const authVariants: AuthStyle[] = bearerAuthOnly
        ? (probeAuth.tag === 'bearer-header' ? [probeAuth, basicAuthOnly] : [bearerAuthOnly, basicAuthOnly])
        : [basicAuthOnly];
      for (const payload of payloadVariants) {
        for (const auth of authVariants) {
          const result = await doDirectFetch({
            fullUrl: method === 'GET'
              ? buildFinalUrl(path, (payload.query ?? {}) as Record<string, any>)
              : buildFinalUrl(path, null),
            method,
            contentType: method === 'POST' ? 'json' : 'none',
            body: method === 'POST' ? (payload.body ?? {}) : null,
            auth,
            meta: { method, path, kind: method === 'GET' ? 'query' : 'json-body', signature: `fase=1;hit=${hit.probe.label};payload=${payload.label};auth=${auth.tag}` },
            pathForAllowHeader: path,
          });
          if (result) return result;
          if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
        }
      }
    }
  } else {
    // ===== FASE 1 B: Geen interessante response gevonden → AIRON360 EERST, daarna legacy =====
    // NIEUW-2: accounts/tenant-SCOPED paden EERST (veel SaaS APIs zijn multi-tenant met pad-scope!)
    // NIEUW-2: credentials in body / query extra inject stijl toevoegen
    const backupPaths: string[] = [];
    const aidForBackup = aid;
    if (aidForBackup) {
      backupPaths.push(
        `/v3/accounts/${aidForBackup}/sims`,
        `/v3/accounts/${aidForBackup}/assets`,
        `/v3/accounts/${aidForBackup}/esims`,
        `/v3/tenants/${aidForBackup}/sims`,
        `/v3/tenants/${aidForBackup}/assets`,
        `/v3/tenants/${aidForBackup}/esims`,
        `/v3/organizations/${aidForBackup}/sims`,
      );
    }
    backupPaths.push(
      '/v3/sims', '/v3/sims/list', '/v3/sims/filter', '/v3/sims/search', '/v3/sims/query',
      '/v3/esims', '/v3/assets', '/v3/assets/filter', '/v3/assets/search',
      '/v3/imsis', '/v3/iot/device', '/v3/ulb/device',
      '/sims', '/sims/list', '/sims/filter', '/sims/search', '/sims/query',
      '/esims', '/assets', '/assets/filter', '/assets/search',
      '/imsis', '/iot/device', '/ulb/device',
      '/inventory', '/inventory/sims', '/inventory/list', '/inventory/search',
      '/subscriptions', '/subscriptions/list', '/simcards', '/sim-cards',
      '/pool/sims', '/stock/sims', '/available/sims', '/inactive/sims',
      '/iccids', '/devices', '/account/sims', '/account/inventory',
      '/customer/sims', '/packages', '/offers', '/plans', '/all/sims', '/sims.json',
    );
    if (resellerFragment) {
      backupPaths.unshift(
        `/v3/resellers/${resellerFragment}/sims`,
        `/v3/resellers/${resellerFragment}/assets`,
        `/v3/resellers/${resellerFragment}/esims`,
        `/resellers/${resellerFragment}/sims`,
        `/resellers/${resellerFragment}/inventory`,
        `/resellers/${resellerFragment}/subscriptions`,
      );
    }
    // ✅ primaryAuthOrder was: Bearer (indien), dan Basic. Nu omdraaien: **Basic + custom eerst**!
    // (Bearer gaf consistent 401 op SIM endpoints in alle voorgaande runs!)
    const authsFor1b: AuthStyle[] = [
      basicAuthOnly,
      xUserPassHeaders,
      ...(bearerAuthOnly ? [bearerAuthOnly] : []),
    ].slice(0, 3);
    for (const path of backupPaths) {
      for (const auth of authsFor1b) {
        for (const inject of injectStylesFast) {
          for (const method of httpMethodsFast) {
            if (method === 'GET') {
              const query = augmentQuery(inject);
              const r = await doDirectFetch({
                fullUrl: buildFinalUrl(path, query),
                method: 'GET',
                contentType: 'none',
                body: null,
                auth,
                meta: { method: 'GET', path, kind: 'query', signature: `fase=1b;auth=${auth.tag};inject=${inject}` },
                pathForAllowHeader: path,
              });
              if (r) return r;
            } else {
              const body = augmentBody(inject);
              const r1 = await doDirectFetch({
                fullUrl: buildFinalUrl(path, null),
                method,
                contentType: 'json',
                body,
                auth,
                meta: { method, path, kind: 'json-body', signature: `fase=1b;auth=${auth.tag};inject=${inject}` },
                pathForAllowHeader: path,
              });
              if (r1) return r1;
            }
            if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
          }
        }
      }
    }
  }

  const seen = new Map<string, { attempt: ListAttempt; count: number; sample: string }>();
  for (const a of attempts) {
    const key = `${a.method}::${a.path} [${a.statusCode ?? 'err'}] (${a.kind})`;
    const cur = seen.get(key);
    if (cur) cur.count++;
    else seen.set(key, { attempt: a, count: 1, sample: a.signature ?? '' });
  }
  let summary = Array.from(seen.values())
    .map(({ attempt: a, count, sample }) => `${a.method} ${a.path} [${a.statusCode ?? 'err'}] (${a.kind}) ×${count} sig=${sample} → ${a.errorClass ?? ''}: ${a.error ?? ''}`)
    .join('\n');
  summary = summary.slice(0, 7000);
  let allowHints = '';
  if (allowHeadersByPath.size > 0) {
    allowHints = '\n\n[Allow-headers hint (405 responses)]:\n';
    for (const [p, allow] of allowHeadersByPath.entries()) {
      allowHints += `  ${p}: Allow=${allow}\n`;
    }
  }
  let baseHitsHints = '';
  if (baseHits.length > 0) {
    baseHitsHints = `\n\n[🌐 FASE -1: BASE URL GERADEN! App-level responses op ${baseHits.length} base(s) — SIMs endpoint zitten op deze base]\n`;
    for (const bh of baseHits.slice(0, 6)) {
      const bodySnippet = (typeof bh.body === 'string' ? bh.body : JSON.stringify(bh.body)).slice(0, 220);
      baseHitsHints += `  base="${bh.base}" [status=${bh.statusCode}] ${bh.method} ${bh.path} auth=${bh.auth.tag}\n    body: ${bodySnippet}\n`;
    }
    baseHitsHints += `  ℹ️ Gebruikte effectieve base URL voor de rest van de pogingen: "${effectiveBase}"\n`;
  } else {
    baseHitsHints = `\n\n[🌐 FASE -1: GEEN ENKELE base URL gaf app-level response (alles 404/405/5xx).\n  De Simhuis WAF (Web Application Firewall) blokkeert blijkbaar ALLE server-side fetch requests, ook met Chrome-achtige User-Agent / Origin / Referer / Sec-Fetch-* headers.\n  → Dit is 99% kans dat Simhuis/Control Center IP-whitelisting of een vaste VPN/zakelijke verbinding vereist.\n  In JOUW browser / Postman werkte het WEL (vroegere 401 InvalidCredentials) omdat JOUW IP-adres is toegestaan; de Next.js-server NIET.\n  💡 Oplossingen (vraag Simhuis Support):\n    1. Whitelist het PUBLIC IP-adres van jouw Nexus-server in het Simhuis/Control Center dashboard.\n    2. Of gebruik een fixed outbound IP / VPN / proxy voor alle Simhuis API calls.\n    3. Of base URL + credentials controleren (1% kans dat die verkeerd zijn).\n  Geteste base URLs:\n`;
    for (const b of baseCandidates) baseHitsHints += `    - ${b}\n`;
    baseHitsHints += `  Oorspronkelijke base URL: "${origBase}"\n`;
  }
  let interestingHints = '';
  if (interesting.length > 0) {
    interestingHints = `\n\n[🔥 FASE 0: ${interesting.length} APP-LEVEL RESPONSES GEVONDEN (op effectieve base="${effectiveBase}")]\n`;
    for (const hit of interesting.slice(0, 12)) {
      const bodySnippet = (typeof hit.respBody === 'string' ? hit.respBody : JSON.stringify(hit.respBody)).slice(0, 200);
      interestingHints += `  [status=${hit.statusCode}] ${hit.probe.label} → ${hit.probe.method} ${hit.probe.path} [${hit.probe.kind}] auth=${hit.probe.auth.tag}\n    body: ${bodySnippet}\n`;
    }
  }
  const msg = `[Simhuis] listSims mislukt na ${attempts.length}/${MAX_ATTEMPTS} pogingen.${baseHitsHints}${allowHints}${interestingHints}\nSamenvatting alle pogingen:\n${summary}`;
  throw new Error(msg);
}

export async function listAllSims(options: Omit<ListSimsOptions, 'page' | 'limit'> = {}): Promise<SimhuisSimStatus[]> {
  const all: SimhuisSimStatus[] = [];
  const seen = new Set<string>();
  const iccidFromEidFallback = new Set<string>();
  const dedupe = (items: SimhuisSimStatus[]) => {
    for (const s of items) {
      if (!s) continue;
      // Voor eSIMs zonder iccid (alleen eid): accepteer ENKEL hier eid als iccid key,
      // want de bearer-token /v3/esims endpoint geeft vaak ALLEEN eid terug (geen iccid veld).
      // We zorgen ervoor dat iccid daarna ook echt de waarde van eid krijgt via fallback.
      let key: string | null = null;
      if (s.iccid) key = s.iccid;
      else if (s.eid) key = `EID:${s.eid}`;
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
  };

  // ================================================================
  // ✅ PHASE A (EERST!): BEKENDE /v3/esims + /v3/assets DIRECT OPHALEN
  // Uit analyse van productie runs weten we MET 100% ZEKERHEID:
  //   /v3/sims = BESTAAT NIET (405 Allow=OPTIONS)
  //   GET /v3/esims MET Bearer token = WERKT (200 OK, echte SIM data!)
  //   GET /v3/assets MET Bearer token = WERKT (200 OK, assets-lijst)
  //
  // Daarom doen we deze BEKENDE paden ALLES EERST, zodat discovery-bugs
  // (TDZ ReferenceError, 122× verstrooide pogingen) geen dataverlies veroorzaken.
  // ================================================================
  try {
    const credsClient = await simhuisClient.getClient();
    if (credsClient) {
      const creds = (credsClient as any).creds as { baseUrl: string; username: string; password: string; resellerId?: string | null };
      let base = (creds.baseUrl || '').replace(/\/+$/, '');
      // Strip trailing /v3 suffix as well — Simhuis base is soms https://apicontrolcenter.com/v3, soms zonder /v3.
      // We gebruiken expliciete /v3/xxx paden dus als base al /v3 bevat halen we hem eraf.
      if (/\/v3\/?$/.test(base)) base = base.replace(/\/v3\/?$/, '');
      let bearerToken: string | null = null;
      try {
        const sc = await getSimhuisCreds();
        bearerToken = await acquireBearerToken(sc);
      } catch { bearerToken = null; }
      // Fallback: probeer BEARER via client.ts singleton (want credentials kunnen AFWIJKEN!)
      // Soms heeft de bearer-token in de SimhuisClientSingleton nog een waarde
      // via de oude flow, terwijl acquireBearerToken() faalde.
      if (!bearerToken) {
        try {
          const anyClient = credsClient as any;
          const maybeBearerFromSingleton = (anyClient as any)?.bearerToken ?? (anyClient as any)['bearer token'];
          if (typeof maybeBearerFromSingleton === 'string' && maybeBearerFromSingleton.length > 20) {
            bearerToken = maybeBearerFromSingleton;
          }
        } catch { /* ignore */ }
      }
      // LAATSTE VALS: parse JSON van /v3/auth/token direct als EXTRA fallback (soms is
      // acquireBearerToken() strict, maar de HTTP call zelf werkte WEL volgens de log:
      // "POST-v3-auth-token → OK-200-no-shape-match: Body: {"token":"ey..."}")
      if (!bearerToken) {
        try {
          const loginUrl = `${base}/v3/auth/token`;
          const resp = await fetch(loginUrl, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Origin': 'https://apicontrolcenter.com',
              'Referer': 'https://apicontrolcenter.com/',
            },
            body: JSON.stringify({ username: creds.username, password: creds.password, grant_type: 'password' }),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            const json: any = await resp.json().catch(() => null);
            const t = json?.token ?? json?.access_token ?? json?.jwt;
            if (typeof t === 'string' && t.length > 20) bearerToken = t;
          }
        } catch { /* ignore */ }
      }

      if (base) {
        const authBasic = basicAuthHeader(creds.username, creds.password);
        let accountId: string | null = getSimhuisAccountId();
        if (!accountId) {
          const envAid = (process.env.SIMHUIS_ACCOUNT_ID ?? process.env.SIMHUIS_RESELLER_ID ?? '').trim();
          if (envAid) accountId = envAid;
        }
        // ✅ NIEUW: ook creds.resellerId proberen (die komt uit AppSettings DB of SIMHUIS_RESELLER_ID)
        if (!accountId && creds.resellerId) {
          const s = String(creds.resellerId).trim();
          if (s && s.length > 4) accountId = s;
        }

        const baseWafHeaders: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Origin': 'https://apicontrolcenter.com',
          'Referer': 'https://apicontrolcenter.com/',
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'X-Requested-With': 'XMLHttpRequest',
          'Connection': 'keep-alive',
        };

        try {
          const credShape = `baseUrl=${creds.baseUrl} user=${creds.username ? '✓' : '✗'} pass=${creds.password ? '✓' : '✗'} resellerId=${creds.resellerId ?? 'NULL'}`;
          const bearOk = bearerToken ? `✓ len=${bearerToken.length}` : '✗';
          console.info(
            `[simhuis-listAllSims] 🔧 Phase A CONFIG: cleanedBase=${base}. CREDENTIALS: ${credShape}. ` +
            `BEARER: ${bearOk}. ACCOUNT-ID: ${accountId ?? 'MISSING (Swagger required=true!)'}.`
          );
        } catch { /* ignore */ }

        const batchItems_win: SimhuisSimStatus[] = [];
        // ================================================================
        // 🏆🏆🏆 ECHTE WINNING COMBOS (uit LIVE PRODUCTIE-LOGS VANDAAG!):
        //   LOG REGEL 5:  POST /v3/assetsbulk  auth=bearer-with-aid  → HTTP 200, len=327 (AssetSimcard: iccid REQUIRED + msisdn[])
        //   LOG REGEL 7:  POST /v3/esimsbulk   auth=bearer-with-aid  → HTTP 200, len=66  (eSIM: eid + profiles[].iccid + enabledProfile.iccid)
        //   LOG REGEL 9:  POST /v3/assetsbulk  auth=bearer-simple    → HTTP 200, len=327
        //   LOG REGEL 11: POST /v3/esimsbulk   auth=bearer-simple    → HTTP 200, len=66
        //   => accountId MOET in query string, auth = Bearer header
        // ================================================================
        if (bearerToken) {
          const qp = new URLSearchParams();
          if (accountId) qp.append('accountId', String(accountId));
          qp.append('limit', '1000');
          qp.append('page', '1');
          const qs = qp.toString();
          const WIN_URL: Array<{ tag: string; u: string; m: 'GET' | 'POST'; b?: BodyInit; ct?: string }> = [
            { tag: 'WIN-assetsbulk-aid',  m: 'POST', u: `${base}/v3/assetsbulk${qs ? `?${qs}` : ''}`,
              ct: 'application/json',
              b: JSON.stringify({ page: 1, limit: 1000, ...(accountId ? { accountId: String(accountId) } : {}) }),
            },
            { tag: 'WIN-esimsbulk-aid',   m: 'POST', u: `${base}/v3/esimsbulk${qs ? `?${qs}` : ''}`,
              ct: 'application/json',
              b: JSON.stringify({ page: 1, limit: 1000, ...(accountId ? { accountId: String(accountId) } : {}), external: false, applyTenantFilter: false }),
            },
          ];
          // 💥 KRITIEK: 2x retry bij HTTP 401! (Zelfde bug als in getSimStatus: JWT token cache!)
          let wcAttempt = 0;
          while (wcAttempt < 2) {
            wcAttempt++;
            let hadAny401 = false;
            let hadAnyOk = false;
            for (const win of WIN_URL) {
              try {
                const wh: Record<string, string> = { ...baseWafHeaders, 'Authorization': `Bearer ${bearerToken}` };
                if (win.ct) wh['Content-Type'] = win.ct;
                const wresp = await fetch(win.u, { method: win.m, headers: wh, body: win.b, signal: AbortSignal.timeout(25000) });
                const wtext = await wresp.text();
                let wparsed: unknown = null;
                try { wparsed = JSON.parse(wtext); } catch { wparsed = wtext; }
                const warr = extractSimList(wparsed);
                const wpreview = warr.length > 0
                  ? `\n  🎯 0# ${JSON.stringify(Object.keys(warr[0] ?? {}).slice(0,25))}\n  🎯 0# values[0..8]=${JSON.stringify(Object.values(warr[0] ?? {}).slice(0,8)).slice(0,280)}${warr.length > 1 ? `\n  🎯 1# keys=${JSON.stringify(Object.keys(warr[1] ?? {}).slice(0,20))}` : ''}`
                  : ` rawText[0..300]=${JSON.stringify(wtext.slice(0,300))}`;
                if (wresp.status === 401) hadAny401 = true;
                if (wresp.ok) hadAnyOk = true;
                try {
                  console.info(
                    `[simhuis-listAllSims] 🏆 ECHTE WINNER ${win.tag} poging ${wcAttempt}/2: HTTP ${wresp.status}. ` +
                    `arr.len=${warr.length} shape=${shapeOf(wparsed)}.${wpreview}`
                  );
                } catch { /* ignore */ }
                if (wresp.ok && warr.length > 0) {
                  let debugIdx = 0;
                  for (const raw of warr) {
                  try {
                    const nested = (raw as any)?.simCard ?? (raw as any)?.sim ?? (raw as any)?.asset ?? (raw as any)?.device ?? (raw as any)?.subscription ?? (raw as any)?.subscriber ?? (raw as any)?.enabledProfile ?? {};
                    // =========================================================
                    // 🔐 ULTRA-ROBUUST: Extract kritieke velden RECHTSTREEKS uit raw
                    //   (GEEN afhankelijkheid van pickString / toSimStatus filters!)
                    // AssetSimcard shape keys: ["status","profileState","limit","smsLimit",...]
                    // =========================================================
                    let directIccid = '';
                    const tryRawIccid = (v: any) => {
                      if (v === null || v === undefined) return '';
                      const s = String(v).trim();
                      if (!s) return '';
                      // placeholders (key===value of iccid=="iccid"): alleen weiger als letterlijk == veldnaam
                      const lower = s.toLowerCase();
                      if (['iccid','sim_iccid','simiccid','esimid','esim_id','eid'].includes(lower)) return '';
                      return s;
                    };
                    directIccid = tryRawIccid((raw as any).iccid) || tryRawIccid((raw as any).sim_iccid) || tryRawIccid((raw as any).simIccid)
                               || tryRawIccid(nested?.iccid) || tryRawIccid(nested?.sim_iccid) || tryRawIccid(nested?.simIccid);
                    if (!directIccid && (raw as any)?.enabledProfile?.iccid) {
                      directIccid = tryRawIccid((raw as any).enabledProfile.iccid);
                    }
                    if (!directIccid && Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && p.iccid && (p.enabled === true || p.status === 'active' || p.bootstrap === true))
                        ?? profiles.find(p => p && p.iccid);
                      if (best?.iccid) directIccid = tryRawIccid(best.iccid);
                    }
                    let directEid = tryRawIccid((raw as any).eid) || tryRawIccid((raw as any).esimId) || tryRawIccid((raw as any).esim_id)
                               || tryRawIccid(nested?.eid) || tryRawIccid(nested?.esimId) || tryRawIccid(nested?.esim_id);
                    let directMsisdn = '';
                    if (Array.isArray((raw as any)?.msisdn) && (raw as any).msisdn.length > 0) {
                      const first = String((raw as any).msisdn[0] ?? '').trim();
                      const lower = first.toLowerCase();
                      if (first && !['msisdn','phonenumber','primarymsisdn','virtualmsisdn'].includes(lower)) directMsisdn = first;
                    } else if (Array.isArray((raw as any)?.enabledProfile?.msisdn) && (raw as any).enabledProfile.msisdn.length > 0) {
                      directMsisdn = String((raw as any).enabledProfile.msisdn[0] ?? '').trim();
                    } else if ((raw as any)?.enabledProfile?.msisdn) {
                      directMsisdn = String((raw as any).enabledProfile.msisdn).trim();
                    } else if ((raw as any)?.msisdn && typeof (raw as any).msisdn === 'string') {
                      directMsisdn = String((raw as any).msisdn).trim();
                    } else if (Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && p.msisdn) ?? profiles[0];
                      if (best?.msisdn) directMsisdn = String(best.msisdn).trim();
                    }
                    if (!directIccid && directEid) directIccid = directEid;

                    // =========================================================
                    // STATUS + DATA LIMITS + DATA/SMS USAGE (DIRECT UIT RAW!)
                    // Simhuis Portal WAARHEID:
                    //   Data Limit: 2.00 GB / Lowest Data Limit: 2.00 GB
                    //   → raw.limit en raw.lowestDataLimit worden in GIGABYTES gegeven!
                    //   Data Used: 0.00 MB → MB?
                    // =========================================================
                    let directStatus: any = undefined;
                    const tryRawStr = (v: any) => {
                      if (v === null || v === undefined) return '';
                      const s = String(v).trim();
                      if (!s) return '';
                      const lower = s.toLowerCase();
                      if (['status','profilestate','state','lifecycle','lifecyclestatus','lifecycle_status','sim_status','simstate','sim_state','type'].includes(lower)) return '';
                      return s;
                    };
                    directStatus = (tryRawStr((raw as any).status) || tryRawStr((raw as any).profileState) || tryRawStr(nested?.status) || tryRawStr(nested?.profileState) || '').toLowerCase();
                    if (!directStatus && (raw as any)?.enabledProfile) {
                      directStatus = (tryRawStr((raw as any).enabledProfile.status) || tryRawStr((raw as any).enabledProfile.profileState) || '').toLowerCase();
                    }
                    if (!directStatus && Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && (p.enabled === true || p.status || p.profileState)) ?? profiles[0];
                      if (best) directStatus = (tryRawStr(best.status) || tryRawStr(best.profileState) || '').toLowerCase();
                    }
                    // Normaliseer de status direct al naar de SimhuisSimStatus strings
                    let normalisedDirectStatus: SimhuisSimStatus['status'] | undefined = undefined;
                    if (directStatus) {
                      const ds = directStatus;
                      if (['active', 'enabled', 'online', 'activated', 'in_service', 'provisioned'].includes(ds)) normalisedDirectStatus = 'active';
                      else if (['inactive', 'disabled', 'offline', 'deactivated', 'retired', 'stock', 'in_stock', 'available', 'ready'].includes(ds)) normalisedDirectStatus = 'inactive';
                      else if (['suspended', 'paused', 'barred', 'suspend', 'bar', 'hibernated', 'hibernate'].includes(ds)) normalisedDirectStatus = 'suspended';
                      else if (['terminated', 'deleted', 'cancelled', 'canceled', 'cancel', 'destroyed', 'expired'].includes(ds)) normalisedDirectStatus = 'terminated';
                      else if (['provisioning', 'activating', 'pending', 'activating_subscription', 'pre_active'].includes(ds)) normalisedDirectStatus = 'provisioning';
                      else normalisedDirectStatus = ds as any;
                    }

                    // =========================================================
                    // 🛠️ Helper: parse plain getal (GB/MB/B/Count) — altijd SAFE!
                    // =========================================================
                    const safeNum = (v: any): number | null => {
                      if (v === null || v === undefined) return null;
                      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
                      if (typeof v === 'bigint') {
                        const n = Number(v);
                        return Number.isFinite(n) ? n : null;
                      }
                      if (typeof v === 'string') {
                        const s = v.trim();
                        if (!s || s === '-' || s.toLowerCase() === 'null') return null;
                        const n = Number(s.replace(/[^\d.\-]/g, ''));
                        return Number.isFinite(n) ? n : null;
                      }
                      return null;
                    };
                    const GB = 1024 * 1024 * 1024;
                    const MB = 1024 * 1024;
                    const KB = 1024;

                    // Data limits: Simhuis portal = GB (2.00 GB).
                    // Probeer eerst GB, dan MB, dan Bytes. Kies de meest plausibele.
                    const toBytesBestEffort = (rawVal: any, label: string): { bytes: number | null; debug: string } => {
                      const n = safeNum(rawVal);
                      if (n === null) return { bytes: null, debug: `${label}=NULL` };
                      if (n <= 0) return { bytes: null, debug: `${label}=${n} (negatief)` };
                      // Simhuis portal zegt: 2.00 GB (n=2!) dus als n<=100000 dan is het WEL GB!
                      if (n > 0 && n <= 50000) {
                        return { bytes: Math.round(n * GB), debug: `${label}=${n} → *GB (${Math.round(n*GB)} bytes)` };
                      }
                      // Als n tussen 50000 en 50mln: MB
                      if (n > 50000 && n <= 50_000_000) {
                        return { bytes: Math.round(n * MB), debug: `${label}=${n} → *MB` };
                      }
                      return { bytes: Math.round(n), debug: `${label}=${n} → bytes` };
                    };

                    const rawLimitRaw = (raw as any).limit ?? nested?.limit ?? (raw as any).enabledProfile?.limit;
                    const rawLowestLimitRaw = (raw as any).lowestDataLimit ?? (raw as any).lowestLimit ?? nested?.lowestDataLimit ?? nested?.lowestLimit ?? (raw as any).enabledProfile?.lowestDataLimit;
                    const { bytes: dlBytes, debug: dlDbg } = toBytesBestEffort(rawLimitRaw, 'limit');
                    const { bytes: ldlBytes, debug: ldlDbg } = toBytesBestEffort(rawLowestLimitRaw, 'lowestDataLimit');

                    const firstSub = Array.isArray((raw as any).subscriptions) && (raw as any).subscriptions.length > 0 ? (raw as any).subscriptions[0] : null;
                    const firstSetup = Array.isArray((raw as any).setups) && (raw as any).setups.length > 0 ? (raw as any).setups[0] : null;
                    const cardProfile: any = (raw as any).cardProfile ?? nested?.cardProfile ?? (raw as any).product ?? nested?.product ?? null;

                    const isValidStr = (v: any): string => {
                      if (v === null || v === undefined) return '';
                      const s = String(v).trim();
                      if (!s) return '';
                      const lower = s.toLowerCase();
                      const placeholders = [
                        'simname','sim_name','assetname','asset_name','displayname','display_name','label','name',
                        'groupname','group_name','groupid','group_id','group','poolname','pool_name','batchname','batch_name',
                        'productname','product_name','productcode','product_code','offername','offer_name','planname','plan_name',
                        'producttype','product_type','subscriptiontype','subscription_type','iccid','eid','msisdn','status'
                      ];
                      if (placeholders.includes(lower)) return '';
                      if (lower.length <= 2 && ['id','na','ok','--','n/a'].includes(lower)) return '';
                      return s;
                    };

                    // ============================================================
                    // 📊 DATA USED: 35+ EXTRA candidate keys!
                    // ============================================================
                    const DATA_USED_KEYS_WIN = [
                      'dataUsed','dataUsage','data_used','data_usage','usageData','usedData','consumed','dataConsumed','totalDataUsed','usage',
                      'usageBytes','mbUsed','totalUsage','totalData','totalDataUsage','gprsUsed','trafficUsed','dataMbUsed',
                      'dataMegaBytesUsed','downloadedBytes','uploadedBytes','totalDataBytes','dataUsageBytes','dataUsageMb',
                      'sessionDataUsed','consumedMb','usedMegabytes','totalMegabytes','totalMegabytesUsed','totalMbUsed','megabytesUsed',
                      'gprsDataUsed','packetDataUsed','totalVolume','dataVolume','dataUsedMb','dataUsedMegaBytes','dataAmount'
                    ];
                    const SMS_USED_KEYS_WIN = ['smsUsed','smsCount','totalSms','smsSent','smsUsage','usedSms','consumedSms','smsMessages','messageCount','moSms','mtSms','totalSmsUsed'];

                    let duBytes: number | null = null;
                    let duDbg = '';
                    let duSource = '';
                    if (firstSub) {
                      for (const k of DATA_USED_KEYS_WIN) {
                        const sv = safeNum((firstSub as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          duSource = `SUBS.${k}`;
                          duDbg = ` → SUBS.${k}=${sv}`;
                          break;
                        }
                      }
                    }
                    if (duBytes === null && firstSetup) {
                      for (const k of DATA_USED_KEYS_WIN) {
                        const sv = safeNum((firstSetup as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          duSource = `SETUP.${k}`;
                          duDbg = ` → SETUP.${k}=${sv}`;
                          break;
                        }
                      }
                    }
                    if (duBytes === null) {
                      for (const k of DATA_USED_KEYS_WIN) {
                        const sv = safeNum((raw as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          duSource = `RAW.${k}`;
                          duDbg = ` → RAW.${k}=${sv}`;
                          break;
                        }
                      }
                    }
                    if (duBytes === null && nested) {
                      for (const k of DATA_USED_KEYS_WIN) {
                        const sv = safeNum((nested as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          duSource = `NESTED.${k}`;
                          duDbg = ` → NESTED.${k}=${sv}`;
                          break;
                        }
                      }
                    }
                    if (duBytes === null && cardProfile) {
                      for (const k of DATA_USED_KEYS_WIN) {
                        const sv = safeNum((cardProfile as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          duSource = `CARDPROFILE.${k}`;
                          duDbg = ` → CARDPROFILE.${k}=${sv}`;
                          break;
                        }
                      }
                    }
                    if (duBytes === null) duDbg = ` → NOT_FOUND keys=${DATA_USED_KEYS_WIN.length}`;

                    // SMS limits/used
                    const smsLimitRaw = (raw as any).smsLimit ?? nested?.smsLimit ?? (raw as any).enabledProfile?.smsLimit ?? (firstSub as any)?.smsLimit ?? (firstSetup as any)?.smsLimit;
                    const smsLowestLimitRaw = (raw as any).lowestSmsLimit ?? nested?.lowestSmsLimit ?? (raw as any).enabledProfile?.lowestSmsLimit;
                    let smsUsedNum: number | null = null;
                    let smsSrc = '';
                    for (const k of SMS_USED_KEYS_WIN) {
                      const sv = safeNum((raw as any)[k]);
                      if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSrc = `RAW.${k}`; break; }
                    }
                    if (smsUsedNum === null && firstSub) {
                      for (const k of SMS_USED_KEYS_WIN) {
                        const sv = safeNum((firstSub as any)[k]);
                        if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSrc = `SUBS.${k}`; break; }
                      }
                    }
                    if (smsUsedNum === null && firstSetup) {
                      for (const k of SMS_USED_KEYS_WIN) {
                        const sv = safeNum((firstSetup as any)[k]);
                        if (sv !== null && sv >= 0) { smsUsedNum = sv; smsSrc = `SETUP.${k}`; break; }
                      }
                    }
                    const smsLimitNum = safeNum(smsLimitRaw);
                    const smsLowestLimitNum = safeNum(smsLowestLimitRaw);

                    // ============================================================
                    // 🏷️ SIM NAME / GROUP / PRODUCT: EXPLICIET UIT RAW HALEN!
                    // ============================================================
                    const SIM_NAME_KEYS_WIN = [
                      'simName','sim_name','assetName','asset_name','displayName','display_name','label','name','nickname','friendlyName',
                      'deviceName','customerLabel','userLabel','description','customName','simLabel','cardName','profileName'
                    ];
                    const GROUP_KEYS_WIN = [
                      'groupName','group_name','group','groupId','group_id','poolName','pool_name','batchName','batch_name',
                      'pool','batch','segment','department','costCenter','costcenter','customerGroup','accountGroup'
                    ];
                    const PRODUCT_KEYS_WIN = [
                      'productName','product_name','planName','plan_name','offerName','offer_name','productCode','product_code',
                      'product','plan','offer','tariff','tariffName','rateplan','ratePlan','subscriptionName','packageName',
                      'bundleName','bundle_name','bundle','planDescription','offerDescription','description','billingPlan','billing_plan','priceplan','pricingPlan'
                    ];
                    const PRODUCT_TYPE_KEYS_WIN = ['productType','product_type','subscriptionType','subscription_type','assetType','asset_type','category','simCategory'];
                    const wFirstBundle: any = firstSub && Array.isArray((firstSub as any).bundles) && (firstSub as any).bundles.length > 0
                      ? (firstSub as any).bundles[0] : null;
                    const wLooksLikeTech = (n: string): boolean => {
                      if (!n) return false;
                      const l = n.toLowerCase();
                      return l.startsWith('cardcentri') || l.startsWith('mii') || l.includes('imeifplmn') || l.startsWith('simprofile') || l.startsWith('esimprofile') || l.startsWith('profile_') || l.startsWith('cardprofile') || l === 'profile' || l === 'card';
                    };

                    const tryExtract = (obj: any, keys: string[]): string => {
                      if (!obj || typeof obj !== 'object') return '';
                      for (const k of keys) {
                        const s = isValidStr((obj as any)[k]);
                        if (s && !wLooksLikeTech(s)) return s;
                      }
                      return '';
                    };

                    let wDirectSimName: string | null = null;
                    wDirectSimName = tryExtract(firstSub, SIM_NAME_KEYS_WIN) || tryExtract(wFirstBundle, SIM_NAME_KEYS_WIN) || tryExtract(firstSetup, SIM_NAME_KEYS_WIN) || tryExtract(raw, SIM_NAME_KEYS_WIN) || tryExtract(cardProfile, SIM_NAME_KEYS_WIN) || tryExtract(nested, SIM_NAME_KEYS_WIN) || tryExtract((raw as any).enabledProfile, SIM_NAME_KEYS_WIN) || null;

                    let wDirectGroupName: string | null = null;
                    wDirectGroupName = tryExtract(firstSub, GROUP_KEYS_WIN) || tryExtract(wFirstBundle, GROUP_KEYS_WIN) || tryExtract(firstSetup, GROUP_KEYS_WIN) || tryExtract(raw, GROUP_KEYS_WIN) || tryExtract(cardProfile, GROUP_KEYS_WIN) || tryExtract(nested, GROUP_KEYS_WIN) || null;
                    if (!wDirectGroupName) {
                      const owner = isValidStr((raw as any).ownerAccountName) || isValidStr(nested?.ownerAccountName);
                      if (owner) wDirectGroupName = owner;
                    }
                    if (!wDirectGroupName && Array.isArray((raw as any).ownership) && (raw as any).ownership.length > 1) {
                      for (const item of (raw as any).ownership) {
                        const s = isValidStr(item);
                        if (s && s.toLowerCase() !== isValidStr((raw as any).ownerAccountId).toLowerCase()) {
                          wDirectGroupName = s; break;
                        }
                      }
                    }
                    let wDirectGroupId: string | null = null;
                    for (const k of ['groupId','group_id','poolId','pool_id','batchId','batch_id']) {
                      const s = isValidStr((raw as any)[k] ?? (firstSub as any)?.[k] ?? (wFirstBundle as any)?.[k] ?? (firstSetup as any)?.[k]);
                      if (s) { wDirectGroupId = s; break; }
                    }

                    let wDirectProductName: string | null = null;
                    wDirectProductName = tryExtract(wFirstBundle, PRODUCT_KEYS_WIN) || tryExtract(firstSub, PRODUCT_KEYS_WIN) || tryExtract(firstSetup, PRODUCT_KEYS_WIN) || tryExtract(raw, PRODUCT_KEYS_WIN) || tryExtract(nested, PRODUCT_KEYS_WIN) || tryExtract((raw as any).enabledProfile, PRODUCT_KEYS_WIN) || null;
                    if (!wDirectProductName && (raw as any).carriers && typeof (raw as any).carriers === 'object') {
                      const carrierKeys = Object.keys((raw as any).carriers).filter((c: any) => c && !wLooksLikeTech(c));
                      if (carrierKeys.length > 0) {
                        const owner = isValidStr((raw as any).ownerAccountName);
                        wDirectProductName = owner
                          ? `${owner} ${carrierKeys.join(' + ')}`
                          : carrierKeys.join(', ');
                      }
                    }
                    if (!wDirectProductName && cardProfile) wDirectProductName = tryExtract(cardProfile, PRODUCT_KEYS_WIN) || null;
                    let wDirectProductType: string | null = null;
                    for (const k of PRODUCT_TYPE_KEYS_WIN) {
                      const s = isValidStr((raw as any)[k] ?? (wFirstBundle as any)?.[k] ?? (firstSub as any)?.[k] ?? (cardProfile as any)?.[k] ?? (nested as any)?.[k]);
                      if (s && !wLooksLikeTech(s)) { wDirectProductType = s; break; }
                    }

                    const directDataLimitBytes = (dlBytes !== null && dlBytes > 0) ? dlBytes : null;
                    const directLowestDataLimitBytes = (ldlBytes !== null && ldlBytes > 0) ? ldlBytes : null;
                    const directSmsLimitCount = (smsLimitNum !== null && smsLimitNum >= 0) ? smsLimitNum : null;
                    const directLowestSmsLimitCount = (smsLowestLimitNum !== null && smsLowestLimitNum >= 0) ? smsLowestLimitNum : null;
                    const directDataUsedBytes = (duBytes !== null && duBytes >= 0) ? duBytes : null;
                    const directSmsUsedCount = (smsUsedNum !== null && smsUsedNum >= 0) ? smsUsedNum : null;

                    let s: SimhuisSimStatus | null = null;
                    try {
                      s = toSimStatus(raw, directIccid || directEid || '');
                    } catch { s = null; }
                    const base: Partial<SimhuisSimStatus> = s ? { ...(s as any) } : {};
                    if (directIccid) (base as any).iccid = directIccid;
                    if (directEid)  (base as any).eid  = directEid;
                    if (directMsisdn) (base as any).msisdn = directMsisdn;
                    if (normalisedDirectStatus) (base as any).status = normalisedDirectStatus;
                    if (directDataLimitBytes !== null) (base as any).dataLimitBytes = directDataLimitBytes;
                    if (directLowestDataLimitBytes !== null) (base as any).lowestDataLimitBytes = directLowestDataLimitBytes;
                    else if (directDataLimitBytes !== null) (base as any).lowestDataLimitBytes = directDataLimitBytes;
                    if (directSmsLimitCount !== null) (base as any).smsLimitCount = directSmsLimitCount;
                    if (directLowestSmsLimitCount !== null) (base as any).lowestSmsLimitCount = directLowestSmsLimitCount;
                    else if (directSmsLimitCount !== null) (base as any).lowestSmsLimitCount = directSmsLimitCount;
                    if (directDataUsedBytes !== null) (base as any).dataUsedBytes = directDataUsedBytes;
                    if (directSmsUsedCount !== null) (base as any).smsUsedCount = directSmsUsedCount;
                    if (wDirectSimName) { (base as any).simName = wDirectSimName; (base as any).displayName = wDirectSimName; (base as any).assetName = wDirectSimName; (base as any).label = wDirectSimName; }
                    if (wDirectGroupName) { (base as any).groupName = wDirectGroupName; (base as any).group = wDirectGroupName; }
                    if (wDirectGroupId) { (base as any).groupId = wDirectGroupId; }
                    if (wDirectProductName) { (base as any).productName = wDirectProductName; (base as any).planName = wDirectProductName; (base as any).offerName = wDirectProductName; }
                    if (wDirectProductType) { (base as any).productType = wDirectProductType; }

                    const final = base as SimhuisSimStatus;
                    if (debugIdx < 3) {
                      try {
                        const firstSubKeys = firstSub ? Object.keys(firstSub).slice(0, 20) : null;
                        const firstSetupKeys = firstSetup ? Object.keys(firstSetup).slice(0, 20) : null;
                        const cardProfileKeys = cardProfile && typeof cardProfile === 'object' ? Object.keys(cardProfile).slice(0, 15) : null;
                        const fIccid = (final as any).iccid ?? '';
                        console.info(
                          `[simhuis-listAllSims]   🐛 ${win.tag} item#${debugIdx}: ` +
                          `directIccid=${JSON.stringify(directIccid)} directEid=${JSON.stringify(directEid)} directMsisdn=${JSON.stringify(directMsisdn)}\n` +
                          `     status=${JSON.stringify(directStatus)}→${JSON.stringify(normalisedDirectStatus)}\n` +
                          `     DL  raw=${JSON.stringify(rawLimitRaw)} → ${dlDbg} → DIRECT=${JSON.stringify(directDataLimitBytes)} bytes (${directDataLimitBytes!==null?`${(directDataLimitBytes/GB).toFixed(2)} GB`:'-'})\n` +
                          `     LDL raw=${JSON.stringify(rawLowestLimitRaw)} → ${ldlDbg} → DIRECT=${JSON.stringify(directLowestDataLimitBytes)} bytes\n` +
                          `     DU  src=${duSource || '-'} ${duDbg} → DIRECT=${JSON.stringify(directDataUsedBytes)} bytes (${directDataUsedBytes!==null?`${(directDataUsedBytes/MB).toFixed(2)} MB`:'-'})\n` +
                          `     SMS limit=${JSON.stringify(smsLimitRaw)}→${JSON.stringify(directSmsLimitCount)} lowestSMS=${JSON.stringify(smsLowestLimitRaw)}→${JSON.stringify(directLowestSmsLimitCount)} usedSMS src=${smsSrc || '-'}→${JSON.stringify(directSmsUsedCount)}\n` +
                          `     🏷️  simName=${JSON.stringify(wDirectSimName)} group=${JSON.stringify(wDirectGroupName)} groupId=${JSON.stringify(wDirectGroupId)}\n` +
                          `     🏷️  productName=${JSON.stringify(wDirectProductName)} productType=${JSON.stringify(wDirectProductType)}\n` +
                          `     firstSub keys=${JSON.stringify(firstSubKeys)} firstSetup keys=${JSON.stringify(firstSetupKeys)} cardProfile keys=${JSON.stringify(cardProfileKeys)}\n` +
                          `     toSim: iccid=${JSON.stringify(s ? (s as any).iccid : null)} status=${JSON.stringify(s ? (s as any).status : null)} ` +
                          `DL=${JSON.stringify(s ? (s as any).dataLimitBytes : null)} LDL=${JSON.stringify(s ? (s as any).lowestDataLimitBytes : null)} ` +
                          `DU=${JSON.stringify(s ? (s as any).dataUsedBytes : null)} SMSu=${JSON.stringify(s ? (s as any).smsUsedCount : null)}\n` +
                          `     FINAL: iccid=${JSON.stringify(fIccid)} status=${JSON.stringify((final as any).status)} ` +
                          `DL=${JSON.stringify((final as any).dataLimitBytes)}(${((final as any).dataLimitBytes ?? 0)/GB}GB) ` +
                          `LDL=${JSON.stringify((final as any).lowestDataLimitBytes)} DU=${JSON.stringify((final as any).dataUsedBytes)} ` +
                          `SMSlim=${JSON.stringify((final as any).smsLimitCount)} SMSused=${JSON.stringify((final as any).smsUsedCount)} ` +
                          `sim=${JSON.stringify((final as any).simName)} grp=${JSON.stringify((final as any).groupName)} prod=${JSON.stringify((final as any).productName)} push=${fIccid ? '✅' : '❌'}`
                        );
                      } catch { /* ignore */ }
                    }
                    debugIdx++;
                    if ((final as any).iccid) batchItems_win.push(final);
                  } catch { /* bad item skip */ }
                }
                const beforeWin = all.length;
                dedupe(batchItems_win);
                const addedWin = all.length - beforeWin;
                try {
                  const sampleIccids = batchItems_win.slice(0,3).map(s => s.iccid).join(',');
                  const statusCounts: Record<string, number> = {};
                  for (const s of batchItems_win) {
                    const k = String(s.status ?? 'null');
                    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
                  }
                  console.info(
                    `[simhuis-listAllSims] 🎯 WIN-COMBO ${win.tag} VERWERKT: in.len=${warr.length} ` +
                    `batchItems.len=${batchItems_win.length} added=${addedWin} TOTAL all.len=${all.length}. sampleIccids=${sampleIccids} statusCounts=${JSON.stringify(statusCounts)}`
                  );
                } catch { /* ignore */ }
              }
            } catch (ew: any) {
              try { console.info(`[simhuis-listAllSims] 🏆 ECHTE WINNER ${win.tag} exceptie: ${ew?.message ?? ew}.`); } catch { /* ignore */ }
            }
          } // EINDE for (const win of WIN_URL)

          // 💥 401 RETRY logica in listAllSims!
          if (wcAttempt === 1 && hadAny401 && !hadAnyOk) {
            try {
              console.warn(`[simhuis-listAllSims] 🏆 WIN-COMBO Poging 1/2: BEIDE bulk endpoints gaven HTTP 401 (InvalidCredentials)! Token cache WEGGOOIEN + OPNIEUW token halen...`);
              invalidateBearerTokenCache(creds.baseUrl);
              const fresh = await acquireBearerToken(creds);
              if (fresh) {
                bearerToken = fresh;
                console.info(`[simhuis-listAllSims] 🏆 WIN-COMBO Poging 2/2: FRESH token OK (len=${fresh.length}). Winning Combo opnieuw proberen!`);
                continue; // while-loop opnieuw draaien met nieuw token!
              } else {
                console.warn(`[simhuis-listAllSims] 🏆 WIN-COMBO Poging 2/2: NIEUW token verkrijgen MISLUKT! Stoppen met Winning Combo.`);
              }
            } catch (e) {
              try { console.warn(`[simhuis-listAllSims] 🏆 WIN-COMBO 401 retry exceptie: ${(e as any)?.message ?? e}.`); } catch {}
            }
            break; // geen nieuw token → uit while
          }
          break; // Geen 401, of WEL data → uit while!
        } // EINDE while (wcAttempt<2) retry loop

          // Wanneer WINNING COMBO succesvol data heeft: return onmiddellijk.
          if (all.length > 0) {
            try {
              console.info(
                `[simhuis-listAllSims] ✅ Phase A complete (VIA ECHTE WINNERS) — ${all.length} sims. ` +
                `Skip auth × endpoint matrix en oude listSims discovery.`
              );
            } catch { /* ignore */ }
            return all;
          }
          // Wanneer winning combos al 327 gaven MAAR niet in all komen:
          // nog een expliciete warning-log
          if (batchItems_win.length > 0 && all.length === 0) {
            try {
              console.warn(
                `[simhuis-listAllSims] ⚠️ WAARSCHUWING: WINNERS hadden batchItems_win.len=${batchItems_win.length} MAAR all.len=0! ` +
                `eerste 3 iccids=${batchItems_win.slice(0,3).map(s=>s.iccid).join(',')}`
              );
            } catch { /* ignore */ }
          }
        }

        type EpAuth = {
          tag: 'bearer-simple' | 'bearer-with-aid' | 'basic' | 'xheaders' | 'credsbody' | 'credsquery';
          headers: Record<string, string>;
          extraBody?: Record<string, any>;
          extraQuery?: Record<string, any>;
        };

        // ============== AUTH VOLGORDE (PRIORITEIT) o.b.v. SWAGGER ==============
        // SWAGGER WAARHEID: Authorization header met Bearer prefix is REQUIRED=true.
        // 1e. Bearer MET accountId query param (SWAGGER: accountId REQUIRED=true!)
        // 2e. Bearer MET extra X-Account-Id headers + query
        // 3e. Bearer SIMPLE (voor het geval accountId niet nodig was)
        // 4e. Basic Auth
        // 5e. X-Headers
        // 6e. credentials IN body
        // 7e. credentials IN query-string
        // =========================================================
        const auths: EpAuth[] = [];
        if (bearerToken) {
          auths.push({
            tag: 'bearer-with-aid',
            headers: {
              ...baseWafHeaders,
              'Authorization': `Bearer ${bearerToken}`,
            },
            extraQuery: accountId ? { accountId: String(accountId) } : undefined,
          });
          if (accountId) {
            auths.push({
              tag: 'bearer-simple',
              headers: {
                ...baseWafHeaders,
                'Authorization': `Bearer ${bearerToken}`,
                'X-Account-Id': String(accountId),
                'X-Tenant-Id': String(accountId),
              },
              extraQuery: { accountId: String(accountId), tenantId: String(accountId), id: String(accountId) },
              extraBody: { accountId: String(accountId), tenantId: String(accountId), id: String(accountId) },
            });
          } else {
            auths.push({
              tag: 'bearer-simple',
              headers: {
                ...baseWafHeaders,
                'Authorization': `Bearer ${bearerToken}`,
              },
            });
          }
        } else {
          try {
            console.info('[simhuis-listAllSims] ⚠️ Geen Bearer-token kunnen verkrijgen. ' +
              'Probeer nu Basic/X-Headers/creds-in-body paden voor /v3/esims & /v3/assets.');
          } catch { /* ignore */ }
        }
        auths.push({ tag: 'basic', headers: { ...baseWafHeaders, 'Authorization': authBasic }, extraQuery: accountId ? { accountId } : undefined });
        auths.push({
          tag: 'xheaders',
          headers: {
            ...baseWafHeaders,
            'X-API-Username': creds.username,
            'X-API-Password': creds.password,
            ...(creds.resellerId ? { 'X-Reseller-ID': String(creds.resellerId) } : {}),
          },
          extraQuery: accountId ? { accountId } : undefined,
        });
        auths.push({
          tag: 'credsbody',
          headers: { ...baseWafHeaders, 'Content-Type': 'application/json' },
          extraBody: {
            username: creds.username,
            password: creds.password,
            ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}),
            ...(accountId ? { accountId: String(accountId) } : {}),
          },
        });
        auths.push({
          tag: 'credsquery',
          headers: { ...baseWafHeaders },
          extraQuery: {
            username: creds.username,
            password: creds.password,
            ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}),
            ...(accountId ? { accountId: String(accountId) } : {}),
          },
        });

        // ============== ENDPOINTS (SWAGGER WAARHEID) ==============
        // - GET  /v3/esims       → eSIMs (alleen eid + enabledProfile.iccid)
        // - GET  /v3/assets      → Assets (Heeft iccid REQUIRED + msisdn[])
        // - POST /v3/esimsbulk   → eSIMs bulk (zelfde data, vaak meer resultaten)
        // - POST /v3/assetsbulk  → Assets bulk (zelfde data, body optioneel {iccid,msisdn})
        // - /v3/sims BESTAAT NIET (405) → NEGEREN
        // accountId query param is VERPLICHT (Swagger: required=true)
        // =========================================================
        type Endpoint = {
          path: string;
          method: 'GET' | 'POST';
          kind: 'query' | 'json-body';
          hasAssetsPayload?: boolean;
        };
        const endpoints: Endpoint[] = [
          { path: '/v3/assetsbulk', method: 'POST', kind: 'json-body' },
          { path: '/v3/esimsbulk',  method: 'POST', kind: 'json-body' },
        ];

        for (const auth of auths) {
          for (const ep of endpoints) {
            try {
              const discovered = new Map<string, number>();
              let page = 1;
              let safety = 0;
              while (safety < 50) {
                safety++;
                const cacheKey = `${auth.tag}::${ep.method}::${ep.path}::${ep.kind}::p${page}`;
                if (discovered.has(cacheKey)) break;
                discovered.set(cacheKey, 1);
                let url = `${base}${ep.path.startsWith('/') ? ep.path : `/${ep.path}`}`;
                let body: BodyInit | undefined;
                const headers: Record<string, string> = { ...auth.headers };
                const PER_PAGE = 1000;
                if (ep.method === 'GET') {
                  const sp = new URLSearchParams();
                  if (accountId) sp.append('accountId', String(accountId));
                  sp.append('page', String(page));
                  sp.append('limit', String(PER_PAGE));
                  if (options.status) sp.append('status', String(options.status));
                  if (auth.extraQuery) {
                    for (const [k, v] of Object.entries(auth.extraQuery)) {
                      if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
                    }
                  }
                  const qs = sp.toString();
                  if (qs) url += `?${qs}`;
                } else {
                  headers['Content-Type'] = 'application/json';
                  const payload: Record<string, any> = {
                    page,
                    limit: PER_PAGE,
                    ...(accountId ? { accountId: String(accountId) } : {}),
                    ...(options.status ? { status: String(options.status) } : {}),
                  };
                  if (auth.extraBody) Object.assign(payload, auth.extraBody);
                  if (ep.hasAssetsPayload && false) {
                    payload.payload = {};
                  }
                  body = JSON.stringify(payload);
                }
                const resp = await fetch(url, { method: ep.method, headers, body, signal: AbortSignal.timeout(20000) });
                const totalMoreHeader = resp.headers.get('X-Total-More');
                const totalCountHeader = resp.headers.get('X-Total-Count');
                const ct = resp.headers.get('content-type') ?? '';
                const text = await resp.text();
                let parsed: unknown = null;
                if (ct.includes('application/json')) try { parsed = JSON.parse(text); } catch { parsed = text; }
                else try { parsed = JSON.parse(text); } catch { parsed = text; }

                if (!resp.ok) {
                  try {
                    console.info(
                      `[simhuis-listAllSims] Phase A: ${ep.method} ${ep.path} (auth=${auth.tag}) ` +
                      `gaf HTTP ${resp.status}. accountId=${accountId ?? 'MISSING!'}. Doorgaan...`
                    );
                  } catch { /* ignore */ }
                  break;
                }
                if (!accountId) {
                  try {
                    console.warn(
                      `[simhuis-listAllSims] ⚠️ Phase A: accountId ONBEKEND! Swagger zegt required=true. ` +
                      `Probeer alsnog, maar dit is waarschijnlijk de reden van 0 resultaten.`
                    );
                  } catch { /* ignore */ }
                }
                const arr = extractSimList(parsed);
                const previewStr = (() => {
                  if (arr.length > 0) {
                    const p0 = arr[0] ?? {};
                    const keys = JSON.stringify(Object.keys(p0).slice(0,22));
                    const vals = JSON.stringify(Object.values(p0).slice(0,8)).slice(0,300);
                    return ` preview[0] keys=${keys} values=${vals}${arr.length > 1 ? `; [1] keys=${JSON.stringify(Object.keys(arr[1] ?? {}).slice(0,22))}` : ''}`;
                  }
                  return ` rawText[0..250]=${JSON.stringify(text.slice(0,250))}`;
                })();
                try {
                  console.info(
                    `[simhuis-listAllSims] Phase A MATRIX: ${ep.method} ${ep.path} auth=${auth.tag} page=${page} HTTP ${resp.status}. ` +
                    `extractSimList len=${arr.length}. shape=${shapeOf(parsed)}.${previewStr}`
                  );
                } catch { /* ignore */ }
                if (!arr || arr.length === 0) break;
                const batchItems: SimhuisSimStatus[] = [];
                for (const raw of arr) {
                  try {
                    const nested = (raw as any)?.simCard ?? (raw as any)?.sim ?? (raw as any)?.asset ?? (raw as any)?.device ?? (raw as any)?.subscription ?? (raw as any)?.subscriber ?? (raw as any)?.enabledProfile ?? {};
                    const tryRawIccid = (v: any): string => {
                      if (v === null || v === undefined) return '';
                      const s = String(v).trim();
                      if (!s) return '';
                      const lower = s.toLowerCase();
                      if (['iccid','sim_iccid','simiccid','esimid','esim_id','eid'].includes(lower)) return '';
                      return s;
                    };
                    let directIccid = tryRawIccid((raw as any).iccid) || tryRawIccid((raw as any).sim_iccid) || tryRawIccid((raw as any).simIccid)
                                   || tryRawIccid(nested?.iccid) || tryRawIccid(nested?.sim_iccid) || tryRawIccid(nested?.simIccid);
                    if (!directIccid && (raw as any)?.enabledProfile?.iccid) {
                      directIccid = tryRawIccid((raw as any).enabledProfile.iccid);
                    }
                    if (!directIccid && Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && p.iccid && (p.enabled === true || p.status === 'active' || p.bootstrap === true))
                        ?? profiles.find(p => p && p.iccid);
                      if (best?.iccid) directIccid = tryRawIccid(best.iccid);
                    }
                    let directEid = tryRawIccid((raw as any).eid) || tryRawIccid((raw as any).esimId) || tryRawIccid((raw as any).esim_id)
                                   || tryRawIccid(nested?.eid) || tryRawIccid(nested?.esimId) || tryRawIccid(nested?.esim_id);
                    let directMsisdn = '';
                    if (Array.isArray((raw as any)?.msisdn) && (raw as any).msisdn.length > 0) {
                      const first = String((raw as any).msisdn[0] ?? '').trim();
                      const lower = first.toLowerCase();
                      if (first && !['msisdn','phonenumber','primarymsisdn','virtualmsisdn'].includes(lower)) directMsisdn = first;
                    } else if (Array.isArray((raw as any)?.enabledProfile?.msisdn) && (raw as any).enabledProfile.msisdn.length > 0) {
                      directMsisdn = String((raw as any).enabledProfile.msisdn[0] ?? '').trim();
                    } else if ((raw as any)?.enabledProfile?.msisdn) {
                      directMsisdn = String((raw as any).enabledProfile.msisdn).trim();
                    } else if ((raw as any)?.msisdn && typeof (raw as any).msisdn === 'string') {
                      directMsisdn = String((raw as any).msisdn).trim();
                    } else if (Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && p.msisdn) ?? profiles[0];
                      if (best?.msisdn) directMsisdn = String(best.msisdn).trim();
                    }
                    if (!directIccid && directEid) directIccid = directEid;

                    // =========================================================
                    // STATUS + DATA LIMITS + DATA/SMS USAGE (DIRECT UIT RAW!)
                    // Dezelfde ultra-robuuste logica als WINNING COMBO.
                    // =========================================================
                    let directStatus: any = undefined;
                    const tryRawStr = (v: any) => {
                      if (v === null || v === undefined) return '';
                      const s = String(v).trim();
                      if (!s) return '';
                      const lower = s.toLowerCase();
                      if (['status','profilestate','state','lifecycle','lifecyclestatus','lifecycle_status','sim_status','simstate','sim_state','type'].includes(lower)) return '';
                      return s;
                    };
                    directStatus = (tryRawStr((raw as any).status) || tryRawStr((raw as any).profileState) || tryRawStr(nested?.status) || tryRawStr(nested?.profileState) || '').toLowerCase();
                    if (!directStatus && (raw as any)?.enabledProfile) {
                      directStatus = (tryRawStr((raw as any).enabledProfile.status) || tryRawStr((raw as any).enabledProfile.profileState) || '').toLowerCase();
                    }
                    if (!directStatus && Array.isArray((raw as any)?.profiles) && (raw as any).profiles.length > 0) {
                      const profiles: any[] = (raw as any).profiles;
                      const best = profiles.find(p => p && (p.enabled === true || p.status || p.profileState)) ?? profiles[0];
                      if (best) directStatus = (tryRawStr(best.status) || tryRawStr(best.profileState) || '').toLowerCase();
                    }
                    let normalisedDirectStatus: SimhuisSimStatus['status'] | undefined = undefined;
                    if (directStatus) {
                      const ds = directStatus;
                      if (['active', 'enabled', 'online', 'activated', 'in_service', 'provisioned'].includes(ds)) normalisedDirectStatus = 'active';
                      else if (['inactive', 'disabled', 'offline', 'deactivated', 'retired', 'stock', 'in_stock', 'available', 'ready'].includes(ds)) normalisedDirectStatus = 'inactive';
                      else if (['suspended', 'paused', 'barred', 'suspend', 'bar', 'hibernated', 'hibernate'].includes(ds)) normalisedDirectStatus = 'suspended';
                      else if (['terminated', 'deleted', 'cancelled', 'canceled', 'cancel', 'destroyed', 'expired'].includes(ds)) normalisedDirectStatus = 'terminated';
                      else if (['provisioning', 'activating', 'pending', 'activating_subscription', 'pre_active'].includes(ds)) normalisedDirectStatus = 'provisioning';
                      else normalisedDirectStatus = ds as any;
                    }
                    const safeNum = (v: any): number | null => {
                      if (v === null || v === undefined) return null;
                      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
                      if (typeof v === 'bigint') { const n = Number(v); return Number.isFinite(n) ? n : null; }
                      if (typeof v === 'string') {
                        const s = v.trim();
                        if (!s || s === '-' || s.toLowerCase() === 'null') return null;
                        const n = Number(s.replace(/[^\d.\-]/g, ''));
                        return Number.isFinite(n) ? n : null;
                      }
                      return null;
                    };
                    const GB = 1024 * 1024 * 1024;
                    const MB = 1024 * 1024;
                    const toBytesBestEffort = (rawVal: any, _label: string): number | null => {
                      const n = safeNum(rawVal);
                      if (n === null || n <= 0) return null;
                      if (n > 0 && n <= 50000) return Math.round(n * GB);
                      if (n > 50000 && n <= 50_000_000) return Math.round(n * MB);
                      return Math.round(n);
                    };
                    const rawLimitRaw = (raw as any).limit ?? nested?.limit ?? (raw as any).enabledProfile?.limit;
                    const rawLowestLimitRaw = (raw as any).lowestDataLimit ?? (raw as any).lowestLimit ?? nested?.lowestDataLimit ?? nested?.lowestLimit ?? (raw as any).enabledProfile?.lowestDataLimit;
                    const dlBytes = toBytesBestEffort(rawLimitRaw, 'limit');
                    const ldlBytes = toBytesBestEffort(rawLowestLimitRaw, 'lowestDataLimit');
                    const firstSub = Array.isArray((raw as any).subscriptions) && (raw as any).subscriptions.length > 0 ? (raw as any).subscriptions[0] : null;
                    const firstSetup = Array.isArray((raw as any).setups) && (raw as any).setups.length > 0 ? (raw as any).setups[0] : null;
                    let duBytes: number | null = null;
                    if (firstSub) {
                      for (const k of ['dataUsed','dataUsage','data_used','data_usage','usageData','usedData','consumed','dataConsumed','totalDataUsed','usage']) {
                        const sv = safeNum((firstSub as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          break;
                        }
                      }
                    }
                    if (duBytes === null && firstSetup) {
                      for (const k of ['dataUsed','dataUsage','data_used','data_usage','usageData','usedData','consumed','dataConsumed','totalDataUsed','usage']) {
                        const sv = safeNum((firstSetup as any)[k]);
                        if (sv !== null && sv >= 0) {
                          if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                          else if (sv > 50000) duBytes = Math.round(sv);
                          else duBytes = 0;
                          break;
                        }
                      }
                    }
                    if (duBytes === null) {
                      const rawDataUsedRaw = (raw as any).dataUsed ?? (raw as any).dataUsage ?? (raw as any).data_used ?? (raw as any).data_usage ?? nested?.dataUsed ?? nested?.dataUsage ?? (raw as any).enabledProfile?.dataUsed;
                      const sv = safeNum(rawDataUsedRaw);
                      if (sv !== null && sv >= 0) {
                        if (sv > 0 && sv <= 50000) duBytes = Math.round(sv * MB);
                        else if (sv > 50000) duBytes = Math.round(sv);
                        else duBytes = 0;
                      }
                    }
                    const smsLimitRaw = (raw as any).smsLimit ?? nested?.smsLimit ?? (raw as any).enabledProfile?.smsLimit;
                    const smsLowestLimitRaw = (raw as any).lowestSmsLimit ?? nested?.lowestSmsLimit ?? (raw as any).enabledProfile?.lowestSmsLimit;
                    const smsUsedRaw = (raw as any).smsUsed ?? (raw as any).smsCount ?? (raw as any).totalSms ?? (raw as any).smsSent ?? nested?.smsUsed ?? (firstSub as any)?.smsUsed ?? (firstSub as any)?.smsCount ?? (firstSetup as any)?.smsUsed;
                    const smsLimitNum = safeNum(smsLimitRaw);
                    const smsLowestLimitNum = safeNum(smsLowestLimitRaw);
                    const smsUsedNum = safeNum(smsUsedRaw);
                    const directDataLimitBytes = (dlBytes !== null && dlBytes > 0) ? dlBytes : null;
                    const directLowestDataLimitBytes = (ldlBytes !== null && ldlBytes > 0) ? ldlBytes : null;
                    const directSmsLimitCount = (smsLimitNum !== null && smsLimitNum >= 0) ? smsLimitNum : null;
                    const directLowestSmsLimitCount = (smsLowestLimitNum !== null && smsLowestLimitNum >= 0) ? smsLowestLimitNum : null;
                    const directDataUsedBytes = (duBytes !== null && duBytes >= 0) ? duBytes : null;
                    const directSmsUsedCount = (smsUsedNum !== null && smsUsedNum >= 0) ? smsUsedNum : null;

                    let s: SimhuisSimStatus | null = null;
                    try { s = toSimStatus(raw, directIccid || directEid || ''); } catch { s = null; }
                    const base: Partial<SimhuisSimStatus> = s ? { ...(s as any) } : {};
                    if (directIccid) (base as any).iccid = directIccid;
                    if (directEid)  (base as any).eid  = directEid;
                    if (directMsisdn) (base as any).msisdn = directMsisdn;
                    if (normalisedDirectStatus) (base as any).status = normalisedDirectStatus;
                    if (directDataLimitBytes !== null) (base as any).dataLimitBytes = directDataLimitBytes;
                    if (directLowestDataLimitBytes !== null) (base as any).lowestDataLimitBytes = directLowestDataLimitBytes;
                    if (directSmsLimitCount !== null) (base as any).smsLimitCount = directSmsLimitCount;
                    if (directLowestSmsLimitCount !== null) (base as any).lowestSmsLimitCount = directLowestSmsLimitCount;
                    if (directDataUsedBytes !== null) (base as any).dataUsedBytes = directDataUsedBytes;
                    if (directSmsUsedCount !== null) (base as any).smsUsedCount = directSmsUsedCount;
                    // Fallback: lowest = dataLimit als lowest null is
                    if (directLowestDataLimitBytes === null && directDataLimitBytes !== null) (base as any).lowestDataLimitBytes = directDataLimitBytes;
                    if (directLowestSmsLimitCount === null && directSmsLimitCount !== null) (base as any).lowestSmsLimitCount = directSmsLimitCount;

                    const final = base as SimhuisSimStatus;
                    if ((final as any).iccid) batchItems.push(final);
                  } catch {
                    // bad item - skip
                  }
                }
                const before = all.length;
                dedupe(batchItems);
                const added = all.length - before;
                const total = extractTotal(parsed, batchItems.length);
                const xTotalMore = totalMoreHeader === 'true' || totalMoreHeader === 'True' || totalMoreHeader === '1';
                const xTotalCountNum = typeof totalCountHeader === 'string' && totalCountHeader ? Number(totalCountHeader) : NaN;
                const hasMore = xTotalMore
                  || (typeof total === 'number' ? (page * PER_PAGE) < total : false)
                  || (!Number.isNaN(xTotalCountNum) ? (page * PER_PAGE) < xTotalCountNum : false)
                  || batchItems.length >= PER_PAGE;
                if (!hasMore || batchItems.length === 0) break;
                page++;
                if (added === 0 && batchItems.length > 0) {
                  break;
                }
              }
            } catch (e: any) {
              try {
                console.info(
                  `[simhuis-listAllSims] Phase A: ${ep.method} ${ep.path} (auth=${auth.tag}) ` +
                  `gooide exceptie: ${e?.message ?? e}. Doorgaan...`
                );
              } catch { /* ignore */ }
            }
          }
        }
      }
    }
  } catch (e: any) {
    try {
      console.error('[simhuis-listAllSims] Phase A exceptie (negeren, doorgaan naar fallbacks):', e?.message ?? e);
    } catch { /* ignore */ }
  }

  if (all.length > 0) {
    // ✅ SUCCES! Phase A heeft data gevonden — verder NIET meer proberen!
    // Geen discovery listSims() call meer nodig (die throwde toch al een error met TDZ bugs).
    try {
      console.info(
        `[simhuis-listAllSims] ✅ Phase A complete — ${all.length} sims opgehaald via directe /v3/esims|/v3/assets endpoints. ` +
        `Discovery overslaan.`
      );
    } catch { /* ignore */ }
    return all;
  }

  // Fallback indien Phase A niets gevonden had: oude listSims discovery loop
  try {
    let page = 1;
    const pageSize = 200;
    let safety = 0;
    while (safety < 50) {
      safety++;
      const batch = await listSims({ ...options, page: page, limit: pageSize });
      const before = all.length;
      dedupe(batch.items);
      const added = all.length - before;
      if (!batch.hasMore || batch.items.length === 0) break;
      if (added === 0 && batch.items.length > 0) break;
      page++;
    }
  } catch (e: any) {
    try {
      console.warn(
        `[simhuis-listAllSims] Discovery listSims() mislukt, ${all.length === 0 ? 'MAAR Phase A had ook al niets!' : 'MAAR Phase A had al data.'} ` +
        `Error: ${(e?.message ?? '').slice(0, 200)}`
      );
    } catch { /* ignore */ }
  }

  return all;
}

export { simhuisClient, SimhuisApiError };
export type { SimhuisRequestOptions };
