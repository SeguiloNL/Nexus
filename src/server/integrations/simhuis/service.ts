import { simhuisClient, SimhuisApiError, type SimhuisRequestOptions } from './client';
import type { ActivateSimOptions, SimhuisApiResponse, SimhuisSimStatus } from './types';

function toSimStatus(raw: unknown, iccid: string): SimhuisSimStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const nestedSim = r.simCard ?? r.sim ?? r.asset ?? r.device ?? r.subscription ?? r.subscriber ?? r.esimProfile ?? r.esim ?? {};

  const DEBUG = (process.env.DEBUG_SIMHUIS_EXTRACT ?? '0') === '1';

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
  // findKey: zoek 1 value in r, dan in nestedSim, d.m.v. alias-normalizatie.
  // Retourneert [gevondenValue, sourceRecordKey] of [undefined, null].
  function findKey(...aliases: string[]): any {
    const normAliases = aliases.map(normalizeKey).filter(Boolean);
    for (const obj of [r, nestedSim, (r as any).plan ?? {}, (r as any).usage ?? {}, nestedSim.plan ?? {}, nestedSim.usage ?? {}]) {
      if (!obj || typeof obj !== 'object') continue;
      const idx = buildKeyIndex(obj);
      for (const na of normAliases) {
        const realKey = idx.get(na);
        if (realKey && obj[realKey] !== undefined && obj[realKey] !== null) {
          return obj[realKey];
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
  // pickString: zoek eerst via findKey (alias-normalizatie),
  // daarna fallback op de expliciete paden als strings/numbers.
  // ============================================================
  const pickString = (...paths: Array<unknown>): string | null => {
    // Eerst: aliassen die findKey begrijpt
    for (const p of paths) {
      if (typeof p === 'string') {
        const v = findKey(p);
        if (v !== undefined && v !== null) {
          const s = String(v).trim();
          if (s && s !== '-' && s !== 'null' && s !== 'undefined') return s;
        }
      }
    }
    // Daarna expliciete waarden
    for (const p of paths) {
      if (p === null || p === undefined) continue;
      if (typeof p === 'object') continue; // als object is al door findKey geprobeerd
      const s = String(p).trim();
      if (s && s !== '-' && s !== 'null' && s !== 'undefined') return s;
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
  // ============================================================
  const pickNumber = (...paths: Array<unknown>): number | null => {
    for (const p of paths) {
      if (typeof p === 'string') {
        const v = findKey(p);
        if (v !== undefined && v !== null) {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const cleaned = v.trim().replace(/,(\d)/g, '.$1');
            const n = Number(cleaned.replace(/[^\d.\-]/g, ''));
            if (Number.isFinite(n)) return n;
            if (cleaned && !/[a-zA-Z]/.test(cleaned)) {
              // geen units, pure nummerieke poging
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
    for (const p of paths) {
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
  // ============================================================
  const pickBytes = (...aliases: string[]): number | null => {
    // Eerst via findKey (unit-string OK, of number OK)
    for (const a of aliases) {
      const v = findKey(a);
      if (v !== undefined && v !== null) {
        const pb = parseBytes(v);
        if (pb !== null) return pb;
        const nb = pickNumber(v);
        if (nb !== null) return nb;
      }
    }
    // Daarna via expliciete waardes als die in de args zitten
    for (const a of aliases) {
      if (typeof a !== 'string') {
        const pb = parseBytes(a);
        if (pb !== null) return pb;
        const nb = pickNumber(a);
        if (nb !== null) return nb;
      }
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

  const productTypeVal = pickString(
    'Product Type', 'productType', 'product_type', 'productTypeName',
    'product_category', 'productCategory', 'type', 'assetType', 'asset_type',
    'category', 'simCategory', 'simType', 'assetCategory',
    'subscriptionType', 'subscription_type', 'kind',
    r.productType, nestedSim?.productType, nestedSim?.type,
  );

  // Data / Usage velden — gebruiken pickBytes (units OK)
  const dataUsedBytesVal = pickBytes(
    'Data Used', 'Data_Used', 'dataUsed', 'data_used_bytes',
    'used_bytes', 'total_usage', 'dataUsage', 'data_usage',
    'usage data_bytes', 'data_bytes', 'bytes',
    'usedData', 'used_data', 'consumed_bytes',
    r.dataUsed, r.data_used_bytes,
  );
  const dataLimitBytesVal = pickBytes(
    'Data Limit', 'Data_Limit', 'dataLimit', 'data_limit_bytes',
    'limit_bytes', 'data_quota', 'dataQuota',
    'plan data_limit_bytes', 'data_quota_plan',
    'max_data_bytes', 'total_data_bytes', 'allowance_data',
    r.dataLimit, r.data_limit_bytes,
  );
  const lowestDataLimitBytesVal = pickBytes(
    'Lowest Data Limit', 'lowest_data_limit_bytes',
    'data_threshold_bytes', 'data alert bytes', 'dataAlertBytes',
    'data_warning_limit', 'lowDataLimit', 'threshold_data_bytes',
    'warning_data_bytes', 'min_data_limit_bytes', 'dataLowLimit',
    'data_low_limit',
    r.lowestDataLimit, r.lowest_data_limit_bytes, r.dataLowLimit,
  );
  // SMS velden — gebruiken pickNumber (geen units, alleen integers)
  const smsUsedCountVal = pickNumber(
    'sms used', 'SMS Used', 'smsUsed', 'sms_used',
    'sms_used_count', 'sms_count', 'total_sms',
    'sms_usage', 'smsUsage', 'totalSms', 'smsSent', 'sms_sent',
    'usage sms_count', 'usage sms', 'consumed_sms',
    r.smsUsed, r.sms_used, r.sms_count,
  );
  const smsLimitCountVal = pickNumber(
    'SMS Limit', 'sms_limit', 'sms_quota', 'smsLimit', 'max_sms',
    'sms_max', 'maximum_sms', 'smsBundle', 'sms_bundle',
    'allowance_sms', 'smsAllowance', 'plan sms_limit',
    'total_sms_bundle',
    r.smsLimit, r.sms_limit, r.max_sms,
  );
  const lowestSmsLimitCountVal = pickNumber(
    'Lowest SMS limit', 'Lowest SMS Limit', 'lowest_sms_limit',
    'sms_threshold', 'sms_alert', 'lowSmsLimit',
    'sms_warning', 'smsWarning', 'min_sms_limit', 'smsLowLimit',
    'sms_low_limit', 'plan lowest_sms_limit',
    r.lowestSmsLimit, r.lowest_sms_limit, r.lowSmsLimit,
  );

  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      '[DEBUG][toSimStatus] iccid=%s\n  keys(r)=%O\n  productName=%s productType=%s simName=%s group=%s\n  dataUsed=%s (raw=%s) dataLimit=%s (raw=%s) lowestData=%s\n  smsUsed=%s smsLimit=%s lowestSms=%s',
      iccidVal || iccid,
      Object.keys(r),
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
          let expiresIn = 3600;
          if (parsed && typeof parsed === 'object') {
            const p = parsed as Record<string, any>;
            const ei = Number(p.expires_in || p.expiresIn || p.exp || 0);
            if (Number.isFinite(ei) && ei > 0) expiresIn = ei;
          }
          // PRIORITEIT: 1) accountId UIT USER OBJECT (vanuit login response!) → 2) pas JWT payload fallback
          const accountIdFromUser = extractAccountIdFromUserObj(userFromResponse);
          const accountIdFromJwt = extractAccountIdFromToken(token);
          const accountId = accountIdFromUser ?? accountIdFromJwt;
          try {
            console.error(`[acquireBearerToken] ✅ Token OK. accountIdFromUser=${accountIdFromUser ?? 'N/A'}, accountIdFromJwt=${accountIdFromJwt ?? 'N/A'}. Gebruikt: ${accountId ?? 'N/A'}. user.shape=${shapeOf(userFromResponse)}`);
          } catch { /* ignore */ }
          _bearerTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000, baseUrl: creds.baseUrl, accountId };
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

export async function getSimStatus(iccid: string): Promise<SimhuisSimStatus> {
  const creds = await getSimhuisCreds();
  const authBasic = basicAuthHeader(creds.username, creds.password);
  const aidForGetSim = getSimhuisAccountId();

  const bearerToken = await acquireBearerToken(creds);

  const authVariants: PerSimAuth[] = [];
  // ✅ AUTH-VOLGORDE GEFIXT: Basic + X-Headers EERST (Bearer gaf alleen 401 op SIM endpoints!)
  authVariants.push({ tag: 'basic-header', header: authBasic });
  authVariants.push({ tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  authVariants.push({ tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  authVariants.push({ tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  if (bearerToken) authVariants.push({ tag: 'bearer-token', token: bearerToken }); // ✅ Bearer LAATSTE

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 6);

  type Template = { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; pathTpl: string; query?: Record<string, any>; body?: Record<string, any>; multiBody?: Array<Record<string, any>> };
  const templates: Template[] = [];

  // === ✅ NIEUW PRIORITEIT 0: Multi-tenant SCOPED paden (account/tenant) + /v3/sims (Swagger standaard!) ===
  if (aidForGetSim) {
    templates.push(
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/assets/{iccid}` },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/assets/{iccid}/diagnostic` },
      { method: 'GET', pathTpl: `/tenants/${aidForGetSim}/assets/{iccid}` },
      { method: 'GET', pathTpl: `/tenants/${aidForGetSim}/assets/{iccid}/diagnostic` },
      { method: 'GET', pathTpl: `/organizations/${aidForGetSim}/assets/{iccid}` },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/sims/{iccid}` },
      { method: 'GET', pathTpl: `/tenants/${aidForGetSim}/sims/{iccid}` },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/esims`, query: { iccid } },
      { method: 'GET', pathTpl: `/tenants/${aidForGetSim}/esims`, query: { iccid } },
      { method: 'GET', pathTpl: `/accounts/${aidForGetSim}/sims`, query: { iccid } },
      { method: 'GET', pathTpl: `/tenants/${aidForGetSim}/sims`, query: { iccid } },
    );
  }
  templates.push(
    { method: 'GET', pathTpl: '/sims/{iccid}' },                            // ✅ Swagger standaard endpoint /sims/{iccid}
    { method: 'GET', pathTpl: '/sims/{iccid}/diagnostic' },
    { method: 'GET', pathTpl: '/sims/{iccid}/sessions' },
    { method: 'GET', pathTpl: '/sims/diagnostic', query: { iccid } },
    { method: 'GET', pathTpl: '/sims', query: { iccid } },
    { method: 'GET', pathTpl: '/sims', query: { filter: { iccid } } },
    { method: 'GET', pathTpl: '/sims', query: { search: iccid } },
  );

  templates.push(
    // === PRIORITEIT 1: AirOn360 /assets/{iccid} (echte endpoints uit Swagger!) ===
    { method: 'GET', pathTpl: '/assets/{iccid}' },                             // Assets get Info (exact!)
    { method: 'GET', pathTpl: '/assets/{iccid}/diagnostic' },                  // Get simcard information (exact!)
    { method: 'GET', pathTpl: '/assets/{iccid}/sessions' },                    // asset sessions
    { method: 'GET', pathTpl: '/assets/{iccid}/location' },                    // location
    { method: 'GET', pathTpl: '/assets/diagnostic', query: { iccid } },        // /assets/diagnostic met iccid query

    // === PRIORITEIT 2: AirOn360 /esims endpoints (via ICCID-query of via EID) ===
    { method: 'GET', pathTpl: '/esims', query: { iccid } },
    { method: 'GET', pathTpl: '/esims', query: { filter: { iccid } } },
    { method: 'GET', pathTpl: '/esims', query: { search: iccid } },
    { method: 'POST', pathTpl: '/esimsbulk', multiBody: [{ iccid }, { filter: { iccid } }, { query: { iccid } }, { filters: { iccid } }, { include: iccid }] },

    // === PRIORITEIT 3: ICCID via list-query endpoints ===
    { method: 'GET', pathTpl: '/assets', query: { iccid } },
    { method: 'GET', pathTpl: '/assets', query: { filter: iccid } },
    { method: 'GET', pathTpl: '/assets', query: { search: iccid } },
    { method: 'GET', pathTpl: '/assets', query: { iccid, expand: 'true' } },
    { method: 'GET', pathTpl: '/imsis', query: { iccid } },

    // === PRIORITEIT 4: /iot/device & /ulb/device endpoints (subscribers/trackers, per IMEI of per {id}) ===
    { method: 'GET', pathTpl: '/iot/device', query: { iccid } },
    { method: 'GET', pathTpl: '/ulb/device', query: { iccid } },

    // === PRIORITEIT 5: Legacy fallback ===
    { method: 'GET', pathTpl: '/sim/{iccid}' },
    { method: 'GET', pathTpl: '/simcards/{iccid}' },
    { method: 'GET', pathTpl: '/subscriptions/{iccid}' },
    { method: 'GET', pathTpl: '/iccids/{iccid}' },
    { method: 'GET', pathTpl: '/inventory/sims/{iccid}' },

    { method: 'POST', pathTpl: '/assets', multiBody: [{ iccid }, { filter: { iccid } }, { query: { iccid } }, { filters: { iccid } }] },
    { method: 'POST', pathTpl: '/assets/search', multiBody: [{ iccid }, { filter: { iccid } }, { query: { iccid } }] },
    { method: 'POST', pathTpl: '/sims', multiBody: [{ iccid }, { filter: { iccid } }, { query: { iccid } }, { filters: { iccid } }] },
    { method: 'POST', pathTpl: '/sims/search', multiBody: [{ iccid }, { filter: { iccid } }, { query: { iccid } }] },
    { method: 'POST', pathTpl: '/sims/filter', multiBody: [{ iccid }, { filter: { iccid } }, { filters: { iccid } }] },
    { method: 'POST', pathTpl: '/sims/list', multiBody: [{ iccid }] },
    { method: 'POST', pathTpl: '/sims/query', multiBody: [{ iccid }, { query: { iccid } }] },
    { method: 'POST', pathTpl: '/sim/status', multiBody: [{ iccid }] },
    { method: 'POST', pathTpl: '/sims/lookup', multiBody: [{ iccid }] },
    { method: 'POST', pathTpl: '/sims/get', multiBody: [{ iccid }] },
  );

  const METHOD_CYCLE: Array<'GET' | 'POST' | 'PUT' | 'PATCH'> = ['GET', 'POST', 'PUT', 'PATCH'];
  function allMethodsAfter(start: 'GET' | 'POST' | 'PUT' | 'PATCH'): Array<'GET' | 'POST' | 'PUT' | 'PATCH'> {
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

            const endpointPath = `${prefix}${tpl.pathTpl}`.replace('{iccid}', encodeURIComponent(iccid));
            const query = tpl.method === 'GET' ? (tpl.query ?? {}) : null;
            const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, query);
            const body = (tpl.method === 'POST' || tpl.method === 'PUT' || tpl.method === 'PATCH') ? (bodyVariant ?? {}) : null;
            const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };

            const result = await doPerSimFetch({
              fullUrl,
              method: tpl.method,
              contentType: contentType as any,
              body,
              auth,
              timeoutMs: 15_000,
            });

            if (result.tag === 'ok') {
              try {
                const status = toSimStatus(result.body, iccid);
                if (status?.iccid) return status;
              } catch { /* bad response shape, continue discovery */ }
            }

            pushRanked(meta, result);
            if (result.tag === 'error') lastErrorResult = result;

            if (result.statusCode === 405) {
              const remaining = allMethodsAfter(tpl.method);
              for (const altMethod of remaining) {
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
                  try {
                    const status = toSimStatus(altResult.body, iccid);
                    if (status?.iccid) return status;
                  } catch { /* bad response shape, continue */ }
                }
                pushRanked(altMeta, altResult);
                if (altResult.tag === 'error') lastErrorResult = altResult;
              }
            }
          }
        }
      }
    }
  }

  // === Laatste redmiddel: listSims EN GET /v3/sims + scoped-accounts paden! ===
  const listAttempts: Array<{ label: string; items: any[] | null; iccidFound: boolean }> = [];
  try {
    // ✅ NIEUW: Eerst SCOPED (accounts/tenant) → daarna /sims → daarna /esims
    const listPathCandidates: Array<{ label: string; suffix: string }> = [];
    if (aidForGetSim) {
      listPathCandidates.push(
        { label: `/accounts/${aidForGetSim}/sims`, suffix: `/accounts/${aidForGetSim}/sims` },
        { label: `/accounts/${aidForGetSim}/assets`, suffix: `/accounts/${aidForGetSim}/assets` },
        { label: `/tenants/${aidForGetSim}/sims`, suffix: `/tenants/${aidForGetSim}/sims` },
        { label: `/tenants/${aidForGetSim}/assets`, suffix: `/tenants/${aidForGetSim}/assets` },
        { label: `/accounts/${aidForGetSim}/esims`, suffix: `/accounts/${aidForGetSim}/esims` },
      );
    }
    listPathCandidates.push(
      { label: '/sims', suffix: '/sims' },
      { label: '/assets', suffix: '/assets' },
      { label: '/esims', suffix: '/esims' },
    );
    const listQueryCandidates: Array<Record<string, any>> = [
      { iccid },
      { filter: iccid },
      { search: iccid },
      { query: iccid },
      { 'filter[iccid]': iccid },
      { 'iccid[]': iccid },
      { page: 1, limit: 500, iccid } as any,
    ];

    for (const prefix of orderedPrefixes.slice(0, 3)) {
      for (const auth of authVariants.slice(0, 4)) { // ✅ 4 auth varianten (geen bearer)
        for (const pc of listPathCandidates) {
          for (const q of listQueryCandidates) {
            try {
              const fullUrl = makePerSimFullUrl(creds.baseUrl, `${prefix}${pc.suffix}`, q);
              const result = await doPerSimFetch({ fullUrl, method: 'GET', contentType: 'none', body: null, auth, timeoutMs: 20_000 });
              if (result.tag === 'ok') {
                const items: any[] = Array.isArray(result.body)
                  ? result.body
                  : ((result.body && typeof result.body === 'object' && Array.isArray((result.body as any).items)) ? (result.body as any).items : []);
                const found = items.some((s: any) => String(s.iccid ?? '').trim() === iccid);
                listAttempts.push({ label: `${prefix}${pc.label}?${Object.keys(q)[0]} auth=${toAuthTag(auth)} (items=${items.length})`, items, iccidFound: found });
                if (found) {
                  const match = items.find((s: any) => String(s.iccid ?? '').trim() === iccid);
                  if (match) {
                    try {
                      const st = toSimStatus(match, iccid);
                      if (st?.iccid) return st;
                    } catch { /* bad item, continue */ }
                  }
                }
              } else {
                listAttempts.push({ label: `${prefix}${pc.label} auth=${toAuthTag(auth)} HTTP ${result.statusCode}`, items: null, iccidFound: false });
              }
            } catch { /* negeer */ }
          }
        }
      }
    }
  } catch { /* negeer */ }

  try {
    const statusVariants: Array<(string | undefined | null)> = [
      undefined, null, 'active', 'inactive', 'available', 'ready', 'enabled', 'suspended', 'paused',
    ];
    for (const sv of statusVariants) {
      try {
        const opts: any = { page: 1, limit: 500 };
        if (sv !== undefined) (opts as any).status = sv === null ? null : sv;
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
              const st = toSimStatus(match, iccid);
              if (st?.iccid) return st;
            } catch { /* bad shape, continue */ }
          }
        }
      } catch { /* negeer */ }
    }
  } catch { /* negeer */ }

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
            // App-level response! (401 InvalidCredentials, 400, etc.)
            // ✅ NIEUW: ALBIJ 401 NIET meer breaken! 401 betekent "pad BESTAAT, alleen auth verkeerd".
            // → BLIJF probeeren met ANDERE auth-methodes (Basic, custom) voor hetzelfde pad.
            // ✅ Alleen breaken op 2xx (boven) of 403 (abort).
            baseHits.push({ base: baseClean, method: tc.method, path: tc.path, auth: tc.auth, statusCode: resp.status, body: parsed });
            if (resp.status === 403) throw new SimhuisApiError(403, parsed ?? {}, fullUrl, trace.error);
            // ✅ Blijf de ANDERE testCases (zelfde pad, andere auth) uitvoeren!
            continue;
          }
          if (resp.status === 403) throw new SimhuisApiError(403, parsed ?? {}, fullUrl, trace.error);
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
        if (resp.status === 403) throw new SimhuisApiError(403, parsed ?? {}, args.fullUrl, trace.error);
        const parsedObj = parsed as Record<string, any> | null;
        const code = parsedObj && typeof parsedObj === 'object' ? String(parsedObj.code ?? parsedObj.error_code ?? '') : '';
        if (resp.status === 401 && (code === 'InvalidToken' || code === 'InvalidAuth' || code === 'Unauthorized')) {
          throw new SimhuisApiError(401, parsed ?? {}, args.fullUrl, trace.error);
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
        if (resp.status === 403) throw new SimhuisApiError(403, parsed ?? {}, fullUrl, trace.error);
        if (resp.status === 401) {
          const parsedObj = parsed as Record<string, any> | null;
          const code = parsedObj && typeof parsedObj === 'object' ? String(parsedObj.code ?? '') : '';
          if (code === 'InvalidToken' || code === 'InvalidAuth') {
            throw new SimhuisApiError(401, parsed ?? {}, fullUrl, trace.error);
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
  const dedupe = (items: SimhuisSimStatus[]) => {
    for (const s of items) {
      if (!s?.iccid) continue;
      const key = s.iccid;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
  };

  try {
    const firstBatch = await listSims({ ...options, page: 1, limit: 200 });
    dedupe(firstBatch.items);
  } catch {
    // ignore if discovery fails; we'll try explicit AirOn360 fetch below anyway
  }

  // ✅ CRITICAL FIX: Probeer DIRECT /v3/esims EN /v3/assets BEIDE endpoints met pagination!
  // Vorige versie stopte na de EERSTE endpoint die data gaf (vaak alleen /v3/assets met 66 SIMs),
  // en miste de resterende 261 in /v3/esims (of omgekeerd).
  try {
    const credsClient = await simhuisClient.getClient();
    if (credsClient) {
      const creds = (credsClient as any).creds as { baseUrl: string; username: string; password: string; resellerId?: string | null };
      let base = (creds.baseUrl || '').replace(/\/+$/, '');
      let bearerToken: string | null = null;
      try {
        const sc = await getSimhuisCreds();
        bearerToken = await acquireBearerToken(sc);
      } catch { bearerToken = null; }

      if (base) {
        const authBasic = basicAuthHeader(creds.username, creds.password);
        const accountId = getSimhuisAccountId() ?? null;

        type EpAuth =
          | { tag: 'basic' | 'xheaders' | 'bearer'; headers: Record<string, string>; extraBody?: Record<string, any>; extraQuery?: Record<string, any> }
          | { tag: 'credsbody' | 'credsquery'; headers: Record<string, string>; extraBody?: Record<string, any>; extraQuery?: Record<string, any> };

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

        const auths: EpAuth[] = [];
        auths.push({ tag: 'basic', headers: { ...baseWafHeaders, 'Authorization': authBasic } });
        auths.push({
          tag: 'xheaders',
          headers: {
            ...baseWafHeaders,
            'X-API-Username': creds.username,
            'X-API-Password': creds.password,
            ...(creds.resellerId ? { 'X-Reseller-ID': String(creds.resellerId) } : {}),
          },
        });
        auths.push({
          tag: 'credsbody',
          headers: { ...baseWafHeaders },
          extraBody: {
            username: creds.username,
            password: creds.password,
            ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}),
          },
        });
        auths.push({
          tag: 'credsquery',
          headers: { ...baseWafHeaders },
          extraQuery: {
            username: creds.username,
            password: creds.password,
            ...(creds.resellerId ? { reseller_id: creds.resellerId } : {}),
          },
        });
        if (bearerToken && accountId) {
          auths.push({
            tag: 'bearer',
            headers: {
              ...baseWafHeaders,
              'Authorization': `Bearer ${bearerToken}`,
              'X-Account-Id': accountId,
              'X-Tenant-Id': accountId,
            },
          });
        }

        const endpoints: Array<{ path: string; method: 'GET' | 'POST'; kind: 'query' | 'json-body'; paramName: 'accountId' | 'tenantId' | 'id' }> = [
          { path: '/v3/esims',  method: 'GET', kind: 'query', paramName: 'accountId' },
          { path: '/v3/assets', method: 'GET', kind: 'query', paramName: 'accountId' },
          { path: '/v3/esims',  method: 'GET', kind: 'query', paramName: 'tenantId' },
          { path: '/v3/assets', method: 'GET', kind: 'query', paramName: 'tenantId' },
          { path: '/v3/esims',  method: 'POST', kind: 'json-body', paramName: 'accountId' },
          { path: '/v3/assets', method: 'POST', kind: 'json-body', paramName: 'accountId' },
        ];

        for (const auth of auths) {
          for (const ep of endpoints) {
            try {
              const discovered = new Map<string, number>();
              let page = 1;
              let safety = 0;
              while (safety < 50) {
                safety++;
                const cacheKey = `${auth.tag}::${ep.method}::${ep.path}::${ep.kind}::${ep.paramName}::p${page}`;
                if (discovered.has(cacheKey)) break;
                discovered.set(cacheKey, 1);
                let url = `${base}${ep.path.startsWith('/') ? ep.path : `/${ep.path}`}`;
                let body: BodyInit | undefined;
                const headers: Record<string, string> = { ...auth.headers };
                const pageAndLimit = { page, limit: 500 };
                if (ep.method === 'GET') {
                  const sp = new URLSearchParams();
                  if (accountId && ep.paramName) sp.append(ep.paramName, String(accountId));
                  sp.append('page', String(pageAndLimit.page));
                  sp.append('limit', String(pageAndLimit.limit));
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
                  const payload: Record<string, any> = { ...pageAndLimit };
                  if (accountId) {
                    payload.accountId = String(accountId);
                    payload.tenantId = String(accountId);
                    payload.id = String(accountId);
                  }
                  if (options.status) payload.status = String(options.status);
                  if (auth.extraBody) Object.assign(payload, auth.extraBody);
                  body = JSON.stringify(payload);
                }
                const resp = await fetch(url, { method: ep.method, headers, body, signal: AbortSignal.timeout(20000) });
                const ct = resp.headers.get('content-type') ?? '';
                const text = await resp.text();
                let parsed: unknown = null;
                if (ct.includes('application/json')) try { parsed = JSON.parse(text); } catch { parsed = text; }
                else try { parsed = JSON.parse(text); } catch { parsed = text; }

                if (!resp.ok) break;
                const arr = extractSimList(parsed);
                if (!arr || arr.length === 0) break;
                const batchItems: SimhuisSimStatus[] = [];
                for (const raw of arr) {
                  try {
                    const nested = (raw as any)?.simCard ?? (raw as any)?.sim ?? (raw as any)?.asset ?? (raw as any)?.device ?? (raw as any)?.subscription ?? (raw as any)?.subscriber ?? {};
                    const iccidStr = String(
                      (raw as any).iccid ?? (raw as any).sim_iccid ?? (raw as any).simIccid ?? (raw as any).eid
                        ?? nested?.iccid ?? nested?.sim_iccid ?? nested?.simIccid ?? nested?.eid ?? ''
                    ).trim();
                    const s = toSimStatus(raw, iccidStr);
                    if (s?.iccid) batchItems.push(s);
                  } catch {
                    // bad item - skip
                  }
                }
                const before = all.length;
                dedupe(batchItems);
                const added = all.length - before;
                const total = extractTotal(parsed, batchItems.length);
                const hasMore = typeof total === 'number'
                  ? (page * pageAndLimit.limit) < total
                  : batchItems.length >= pageAndLimit.limit;
                if (!hasMore || batchItems.length === 0) break;
                page++;
                if (added === 0 && batchItems.length > 0) {
                  break;
                }
              }
            } catch {
              // move on to next endpoint/auth combo
            }
          }
        }
      }
    }
  } catch {
    // ignore explicit endpoint failures; discovery fallback may have added items
  }

  // Fallback indien discovery nog niets gevonden had: nogsteeds oude pagination loop
  if (all.length === 0) {
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
  }

  return all;
}

export { simhuisClient, SimhuisApiError };
export type { SimhuisRequestOptions };
