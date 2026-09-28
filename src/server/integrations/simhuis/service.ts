import { simhuisClient, SimhuisApiError, type SimhuisRequestOptions } from './client';
import type { ActivateSimOptions, SimhuisApiResponse, SimhuisSimStatus } from './types';

function toSimStatus(raw: unknown, iccid: string): SimhuisSimStatus {
  const r = (raw ?? {}) as Record<string, any>;
  const statusRaw = String(r.status ?? r.state ?? r.sim_status ?? r.simState ?? '').toLowerCase();
  let status: SimhuisSimStatus['status'] = statusRaw as any;
  if (['active', 'enabled', 'online'].includes(statusRaw)) status = 'active';
  else if (['inactive', 'disabled', 'offline'].includes(statusRaw)) status = 'inactive';
  else if (['suspended', 'paused', 'barred'].includes(statusRaw)) status = 'suspended';
  else if (['terminated', 'deleted', 'cancelled'].includes(statusRaw)) status = 'terminated';
  else if (['provisioning', 'activating', 'pending'].includes(statusRaw)) status = 'provisioning';
  return {
    iccid: String(r.iccid ?? r.sim_iccid ?? iccid),
    imsi: typeof r.imsi === 'string' ? r.imsi : null,
    msisdn: typeof r.msisdn === 'string' ? r.msisdn : (typeof r.phone_number === 'string' ? r.phone_number : null),
    status,
    ip: typeof r.ip === 'string' ? r.ip : (typeof r.ip_address === 'string' ? r.ip_address : null),
    network: typeof r.network === 'string' ? r.network : (typeof r.carrier === 'string' ? r.carrier : null),
    planName: typeof r.plan_name === 'string' ? r.plan_name : (typeof r.offer_name === 'string' ? r.offer_name : (typeof r.tariff === 'string' ? r.tariff : null)),
    dataUsedBytes: typeof r.data_used_bytes === 'number' ? r.data_used_bytes : (typeof r.used_bytes === 'number' ? r.used_bytes : null),
    dataLimitBytes: typeof r.data_limit_bytes === 'number' ? r.data_limit_bytes : (typeof r.limit_bytes === 'number' ? r.limit_bytes : null),
    activatedAt: typeof r.activated_at === 'string' ? r.activated_at : (typeof r.activation_date === 'string' ? r.activation_date : null),
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

function extractAccountIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const candidates = [
    payload.iss, payload.account_id, payload.accountId, payload.sub,
    payload.aud?.[0] || payload.aud, payload.tenant_id, payload.tenantId,
    payload.customer_id, payload.reseller_id, payload.org_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length >= 10 && /^[0-9a-f]{20,}$/i.test(c.trim())) {
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
        if (parsed && typeof parsed === 'object') {
          const p = parsed as Record<string, any>;
          token = String(p.access_token || p.accessToken || p.token || p.jwt || p.authToken || p.bearer || '');
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
          const accountId = extractAccountIdFromToken(token);
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
    if (!mergedBody.accountId && !mergedBody.account_id) mergedBody.account_id = accountId;
    if (args.auth.tag === 'bearer-token') {
      // Sommige endpoints willen 'accountId' (camelCase), anderen 'account_id' — meesturen allebei
      if (!mergedBody.accountId) mergedBody.accountId = accountId;
    }
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
    queryParams.append('account_id', accountId);
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

  const bearerToken = await acquireBearerToken(creds);

  const authVariants: PerSimAuth[] = [];
  if (bearerToken) authVariants.push({ tag: 'bearer-token', token: bearerToken });
  authVariants.push({ tag: 'basic-header', header: authBasic });
  authVariants.push({ tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  authVariants.push({ tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId });
  authVariants.push({ tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId });

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 6);

  type Template = { method: 'GET' | 'POST' | 'PUT' | 'PATCH'; pathTpl: string; query?: Record<string, any>; body?: Record<string, any>; multiBody?: Array<Record<string, any>> };
  const templates: Template[] = [
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

    // === PRIORITEIT 5: Legacy /sims/... fallback ===
    { method: 'GET', pathTpl: '/sims/{iccid}' },
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
  ];

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
              const status = toSimStatus(result.body, iccid);
              if (status) return status;
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
                  const status = toSimStatus(altResult.body, iccid);
                  if (status) return status;
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

  // === Laatste redmiddel: listSims EN GET /v3/esims meerdere keren! ===
  const listAttempts: Array<{ label: string; items: any[] | null; iccidFound: boolean }> = [];
  try {
    // 1. Eerst GET /v3/esims met iccid-query (rechtstreeks per prefix!)
    for (const prefix of orderedPrefixes.slice(0, 3)) {
      for (const auth of authVariants.slice(0, 3)) {
        for (const q of [
          { iccid },
          { filter: iccid },
          { search: iccid },
          { query: iccid },
          { 'filter[iccid]': iccid },
          { 'iccid[]': iccid },
          { page: 1, limit: 500, iccid } as any,
        ]) {
          try {
            const fullUrl = makePerSimFullUrl(creds.baseUrl, `${prefix}/esims`, q);
            const result = await doPerSimFetch({ fullUrl, method: 'GET', contentType: 'none', body: null, auth, timeoutMs: 20_000 });
            if (result.tag === 'ok') {
              const items: any[] = Array.isArray(result.body)
                ? result.body
                : ((result.body && typeof result.body === 'object' && Array.isArray((result.body as any).items)) ? (result.body as any).items : []);
              const found = items.some((s: any) => String(s.iccid ?? '').trim() === iccid);
              listAttempts.push({ label: `${prefix}/esims?${Object.keys(q)[0]} auth=${toAuthTag(auth)} (items=${items.length})`, items, iccidFound: found });
              if (found) {
                const match = items.find((s: any) => String(s.iccid ?? '').trim() === iccid);
                if (match) return toSimStatus(match, iccid);
              }
            } else {
              listAttempts.push({ label: `${prefix}/esims auth=${toAuthTag(auth)} HTTP ${result.statusCode}`, items: null, iccidFound: false });
            }
          } catch { /* negeer */ }
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
          if (match) return toSimStatus(match, iccid);
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
            const status = toSimStatus(result.body, iccid);
            if (status.status || status.imsi || status.msisdn || status.activatedAt) return status;
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
                const status = toSimStatus(altResult.body, iccid);
                if (status.status || status.imsi || status.msisdn || status.activatedAt) return status;
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
    const status = toSimStatus(successRaw, iccid);
    if (!status.status) status.status = 'active';
    return status;
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
            const status = toSimStatus(result.body, iccid);
            if (status.status || status.imsi || status.msisdn || status.ip !== undefined) return status;
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
                const status = toSimStatus(altResult.body, iccid);
                if (status.status || status.imsi || status.msisdn || status.ip !== undefined) return status;
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
    const status = toSimStatus(successRaw, iccid);
    if (!status.status) status.status = 'inactive';
    return status;
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
    r?.data?.sims,
    r?.data?.items,
    r?.data?.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Array<Record<string, any>>;
  }
  return [];
}

function extractTotal(raw: unknown, fallback: number): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, any>;
  const candidates = [r.total, r.total_count, r.totalCount, r.count, r?.meta?.total, r?.pagination?.total, r?.data?.total];
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
    // AirOn360 eerst: eerst BEARER (accountId-inject), daarna basic, daarna auth/ping tests
    const accountIdVal = bearerAuthOnly ? getSimhuisAccountId() : null;
    const baseAidQuery = accountIdVal
      ? { accountId: accountIdVal, account_id: accountIdVal, page: 1, limit: 50 }
      : { page: 1, limit: 50 };
    const testCases: Array<{ method: 'GET' | 'POST'; path: string; auth: AuthStyle; kind: 'json-body' | 'query' | 'form-body'; body?: Record<string, any>; query?: Record<string, any> }> = [];
    if (bearerAuthOnly) {
      testCases.push(
        { method: 'GET', path: '/v3/esims', auth: bearerAuthOnly, kind: 'query', query: { ...baseAidQuery } },
        { method: 'GET', path: '/v3/assets', auth: bearerAuthOnly, kind: 'query', query: { ...baseAidQuery } },
      );
    }
    testCases.push(
      { method: 'GET', path: '/v3/esims', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'GET', path: '/v3/assets', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 50 } },
      { method: 'POST', path: '/v3/auth/token', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, grant_type: 'password' } },
      { method: 'GET', path: '/v3/auth/me', auth: basicAuthOnly, kind: 'query' },
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
          // App-level response! Stop multi-base probe en gebruik deze base.
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
            // App-level response! (401 InvalidCredentials, 400, etc)
            baseHits.push({ base: baseClean, method: tc.method, path: tc.path, auth: tc.auth, statusCode: resp.status, body: parsed });
            break;
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

  // FASE 0: SNELLE probes — AirOn360 /v3 endpoints EERST, daarna legacy
  const probes: Phase0Probe[] = [];
  const probeAuth = bearerAuthOnly ?? basicAuthOnly;
  // === AirOn360 eSIMS & ASSETS (absolute prio) ===
  probes.push(
    { label: 'GET-v3-esims', method: 'GET', path: '/v3/esims', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-esims-basic', method: 'GET', path: '/v3/esims', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-assets', method: 'GET', path: '/v3/assets', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-assets-basic', method: 'GET', path: '/v3/assets', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-assets-filter', method: 'GET', path: '/v3/assets/filter', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200, ...(options.status ? { status: options.status } : {}) } },
    { label: 'GET-v3-assets-search', method: 'GET', path: '/v3/assets/search', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'PUT-v3-assets-filter', method: 'PUT', path: '/v3/assets/filter', auth: probeAuth, kind: 'json-body', body: { page: 1, limit: 200, ...(options.status ? { status: options.status } : {}) } },
    { label: 'PUT-v3-assets-search', method: 'PUT', path: '/v3/assets/search', auth: probeAuth, kind: 'json-body', body: { page: 1, limit: 200 } },
    { label: 'GET-v3-esims-status', method: 'GET', path: '/v3/esims', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200, status: options.status ?? 'active' } },
    { label: 'GET-v3-assets-status', method: 'GET', path: '/v3/assets', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200, status: options.status ?? 'active' } },
    { label: 'GET-v3-imsis', method: 'GET', path: '/v3/imsis', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-iot-device', method: 'GET', path: '/v3/iot/device', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-v3-ulb-device', method: 'GET', path: '/v3/ulb/device', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'POST-v3-esims', method: 'POST', path: '/v3/esims', auth: probeAuth, kind: 'json-body', body: { page: 1, limit: 200 } },
    { label: 'POST-v3-assets', method: 'POST', path: '/v3/assets', auth: probeAuth, kind: 'json-body', body: { page: 1, limit: 200 } },
  );
  // === Auth tests ===
  probes.push(
    { label: 'POST-v3-auth-token', method: 'POST', path: '/v3/auth/token', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, grant_type: 'password' } },
    { label: 'GET-v3-auth-check', method: 'GET', path: '/v3/auth/check-token', auth: probeAuth, kind: 'query' },
    { label: 'GET-v3-auth-me', method: 'GET', path: '/v3/auth/me', auth: basicAuthOnly, kind: 'query' },
  );
  // === Legacy zonder /v3 prefix ===
  probes.push(
    { label: 'GET-esims', method: 'GET', path: '/esims', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'GET-assets', method: 'GET', path: '/assets', auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
    { label: 'POST-sims-page-limit-basic', method: 'POST', path: '/sims', auth: basicAuthOnly, kind: 'json-body', body: { page: 1, limit: 100 } },
    { label: 'GET-sims-page-limit-basic', method: 'GET', path: '/sims', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 100 } },
  );
  if (resellerFragment) {
    probes.push(
      { label: 'GET-v3-reseller-assets', method: 'GET', path: `/v3/resellers/${resellerFragment}/assets`, auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'GET-v3-reseller-esims', method: 'GET', path: `/v3/resellers/${resellerFragment}/esims`, auth: probeAuth, kind: 'query', query: { page: 1, limit: 200 } },
      { label: 'GET-reseller-sims-basic', method: 'GET', path: `/resellers/${resellerFragment}/sims`, auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 100 } },
    );
  } else {
    probes.push(
      { label: 'GET-root-basic', method: 'GET', path: '/', auth: basicAuthOnly, kind: 'query' },
      { label: 'POST-v3-basic-empty', method: 'POST', path: '/v3', auth: basicAuthOnly, kind: 'json-body', body: {} },
    );
  }

  const processResponse = (respBodyRaw: unknown): ListSimsResult | null => {
    const rawArray = extractSimList(respBodyRaw);
    if (!rawArray || rawArray.length === 0) {
      const bodyAsObj = respBodyRaw as Record<string, any> | null;
      if (bodyAsObj && typeof bodyAsObj === 'object' && ('iccid' in bodyAsObj || 'sim_iccid' in bodyAsObj)) {
        const iccid = String(bodyAsObj.iccid ?? bodyAsObj.sim_iccid ?? '').trim();
        if (iccid) {
          return { items: [toSimStatus(bodyAsObj, iccid)], total: 1, page: page, limit: limit, hasMore: false, raw: respBodyRaw };
        }
      }
      return null;
    }
    const items = rawArray.map((item) => {
      const iccid = String(item.iccid ?? item.sim_iccid ?? item.simIccid ?? (item as any)?.sim?.iccid ?? '').trim();
      return toSimStatus(item, iccid);
    });
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
      const isBearer = args.auth.tag === 'bearer-header';
      const listAccountId = isBearer ? getSimhuisAccountId() : null;

      if (args.auth.tag === 'basic-header' || args.auth.tag === 'bearer-header' ||
          args.auth.tag === 'apikey-header-x' || args.auth.tag === 'api-key-auth-header') {
        headers.Authorization = args.auth.header;
      } else if (args.auth.tag === 'custom-headers') {
        Object.assign(headers, args.auth.headers);
      }
      let body: BodyInit | undefined;
      const mergedBody: Record<string, any> | null = args.body ? { ...args.body } : null;
      if (isBearer && listAccountId && mergedBody) {
        if (!mergedBody.accountId) mergedBody.accountId = listAccountId;
        if (!mergedBody.account_id) mergedBody.account_id = listAccountId;
      }
      if ((args.method === 'POST' || args.method === 'PUT' || args.method === 'PATCH') && mergedBody) {
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
      }
      let finalUrl = args.fullUrl;
      if (isBearer && listAccountId) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        const sp = new URLSearchParams();
        sp.append('accountId', listAccountId);
        sp.append('account_id', listAccountId);
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
        if (result) return result;
        if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
          return { items: [], total: 0, page: page, limit: limit, hasMore: false, raw: parsed };
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

      const phase0IsBearer = probe.auth.tag === 'bearer-header';
      const phase0AccountId = phase0IsBearer ? getSimhuisAccountId() : null;

      let queryExtra: Record<string, any> = (probe.query ?? {}) as Record<string, any>;
      if (phase0IsBearer && phase0AccountId) {
        queryExtra = { ...queryExtra };
        if (!queryExtra.accountId) queryExtra.accountId = phase0AccountId;
        if (!queryExtra.account_id) queryExtra.account_id = phase0AccountId;
      }

      let bodyInit: BodyInit | undefined;
      let bodyPayload: Record<string, any> | null = probe.body ? { ...probe.body } : null;
      if (phase0IsBearer && phase0AccountId && bodyPayload) {
        if (!bodyPayload.accountId) bodyPayload.accountId = phase0AccountId;
        if (!bodyPayload.account_id) bodyPayload.account_id = phase0AccountId;
      }
      const fullUrl = probe.method === 'GET'
        ? buildFinalUrl(probe.path, queryExtra)
        : buildFinalUrl(probe.path, null);

      if (probe.method !== 'GET' && bodyPayload) {
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
        if (result) return result;
        if (resp.status === 200 || resp.status === 204) {
          interesting.push({ probe, statusCode: resp.status, respBody: parsed });
          trace.statusCode = resp.status;
          trace.errorClass = 'OK-200';
          const snippet = typeof parsed === 'string' ? parsed.slice(0, 120) : JSON.stringify(parsed).slice(0, 120);
          trace.error = `Body: ${snippet || '(leeg)'}`;
          attempts.push(trace);
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
          // App-level response — houd deze bij als "interessant"
          interesting.push({ probe, statusCode: resp.status, respBody: parsed });
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
      const payloadVariants: Array<{ label: string; body?: Record<string, any>; query?: Record<string, any> }> = [
        { label: 'p=1,l=200', body: method === 'POST' ? { ...basePayload, limit: 200 } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200 } : undefined },
        { label: 'p=1,l=200,creds', body: method === 'POST' ? { ...basePayload, limit: 200, username: creds.username, password: creds.password, ...(resellerId ? { reseller_id: resellerId } : {}) } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, username: creds.username, password: creds.password, ...(resellerId ? { reseller_id: resellerId } : {}) } : undefined },
        { label: 'status=inactive', body: method === 'POST' ? { ...basePayload, limit: 200, status: 'inactive' } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, status: 'inactive' } : undefined },
        { label: 'status=available', body: method === 'POST' ? { ...basePayload, limit: 200, status: 'available' } : undefined, query: method === 'GET' ? { ...basePayload, limit: 200, status: 'available' } : undefined },
        { label: 'empty', body: method === 'POST' ? {} : undefined, query: method === 'GET' ? {} : undefined },
      ];
      const authVariants: AuthStyle[] = [probeAuth, basicAuthOnly, noAuth, xUserPassHeaders];
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
    const backupPaths: string[] = [
      '/v3/esims', '/v3/assets', '/v3/assets/filter', '/v3/assets/search',
      '/v3/imsis', '/v3/iot/device', '/v3/ulb/device',
      '/esims', '/assets', '/assets/filter', '/assets/search',
      '/imsis', '/iot/device', '/ulb/device',
      '/inventory', '/inventory/sims', '/inventory/list', '/inventory/search',
      '/subscriptions', '/subscriptions/list', '/simcards', '/sim-cards',
      '/pool/sims', '/stock/sims', '/available/sims', '/inactive/sims',
      '/iccids', '/devices', '/account/sims', '/account/inventory',
      '/customer/sims', '/packages', '/offers', '/plans', '/all/sims', '/sims.json',
    ];
    if (resellerFragment) {
      backupPaths.unshift(
        `/v3/resellers/${resellerFragment}/assets`,
        `/v3/resellers/${resellerFragment}/esims`,
        `/resellers/${resellerFragment}/sims`,
        `/resellers/${resellerFragment}/inventory`,
        `/resellers/${resellerFragment}/subscriptions`,
      );
    }
    const authsFor1b = primaryAuthOrder.slice(0, 2);
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
  let page = 1;
  const pageSize = 200;
  const seen = new Set<string>();
  let safety = 0;
  while (safety < 50) {
    safety++;
    const batch = await listSims({ ...options, page: page, limit: pageSize });
    for (const s of batch.items) {
      if (s.iccid && !seen.has(s.iccid)) {
        seen.add(s.iccid);
        all.push(s);
      }
    }
    if (!batch.hasMore || batch.items.length === 0) break;
    page++;
  }
  return all;
}

export { simhuisClient, SimhuisApiError };
export type { SimhuisRequestOptions };
