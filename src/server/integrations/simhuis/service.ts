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
  const prefixes = new Set<string>(['']);
  prefixes.add('/api');
  prefixes.add('/api/v1');
  prefixes.add('/api/v2');
  prefixes.add('/v1');
  prefixes.add('/v2');
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
  if (args.auth.tag === 'basic-header') {
    headers.Authorization = args.auth.header;
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
  if (args.auth.tag === 'creds-query') {
    const sep = finalUrl.includes('?') ? '&' : '?';
    const sp = new URLSearchParams();
    sp.append('username', args.auth.username);
    sp.append('password', args.auth.password);
    if (args.auth.resellerId) sp.append('reseller_id', String(args.auth.resellerId));
    finalUrl = `${finalUrl}${sep}${sp.toString()}`;
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

  const authVariantsFirst: PerSimAuth[] = [
    { tag: 'basic-header', header: authBasic },
    { tag: 'creds-body', username: creds.username, password: creds.password, resellerId: creds.resellerId },
  ];
  const authVariantsThen: PerSimAuth[] = [
    { tag: 'creds-query', username: creds.username, password: creds.password, resellerId: creds.resellerId },
    { tag: 'x-custom-headers', username: creds.username, password: creds.password, resellerId: creds.resellerId },
  ];

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 4);

  // BELANGRIJK: volgorde is gebaseerd op echte 405-hints uit de praktijk:
  // GET /sims/{iccid} gaf 405 MethodNotAllowed ("GET is not allowed") → dus eerst POST op dezelfde URL proberen!
  type Template = { method: 'GET' | 'POST'; pathTpl: string; query?: Record<string, any>; body?: Record<string, any> };
  const templates: Template[] = [
    // Hoogste prioriteit: /sims/{iccid} als POST (GET gaf 405)
    { method: 'POST', pathTpl: '/sims/{iccid}', body: { iccid } },
    { method: 'POST', pathTpl: '/sim/{iccid}', body: { iccid } },
    { method: 'POST', pathTpl: '/sims', body: { iccid } },
    { method: 'POST', pathTpl: '/simcards/{iccid}', body: { iccid } },
    { method: 'POST', pathTpl: '/iccids/{iccid}', body: { iccid } },
    // Daarna de search/status endpoints
    { method: 'POST', pathTpl: '/sims/search', body: { iccid } },
    { method: 'POST', pathTpl: '/sim/status', body: { iccid } },
    { method: 'POST', pathTpl: '/subscriptions/{iccid}', body: { iccid } },
    { method: 'POST', pathTpl: '/inventory/sims/{iccid}', body: { iccid } },
    // Als laatste fallback: GET varianten (die gaven 405, maar wie weet voor andere prefixes)
    { method: 'GET', pathTpl: '/sims/{iccid}' },
    { method: 'GET', pathTpl: '/sim/{iccid}' },
    { method: 'GET', pathTpl: '/sims', query: { iccid } },
    { method: 'GET', pathTpl: '/simcards/{iccid}' },
    { method: 'GET', pathTpl: '/iccids/{iccid}' },
    { method: 'GET', pathTpl: '/inventory/sims/{iccid}' },
    { method: 'GET', pathTpl: '/subscriptions/{iccid}' },
  ];

  function alternativeMethodFor405(method: 'GET' | 'POST' | 'PUT' | 'PATCH'): 'GET' | 'POST' | 'PUT' | 'PATCH' {
    if (method === 'GET') return 'POST';
    if (method === 'POST') return 'GET';
    if (method === 'PUT') return 'POST';
    return 'POST';
  }

  function pushRanked(meta: PerSimAttemptMeta, result: PerSimAttemptResult) {
    if (result.tag === 'ok') return;
    const score = attemptRankScore(result.statusCode, result.error ?? null);
    rankedAttempts.push({
      meta,
      statusCode: result.statusCode,
      error: result.error ?? null,
      score,
    });
  }

  function topRanked(n: number): RankedAttempt[] {
    return [...rankedAttempts].sort((a, b) => b.score - a.score).slice(0, n);
  }

  const allAuthVariants = [...authVariantsFirst, ...authVariantsThen];

  // Eerst LEEGE prefix (geen /api/v1), omdat /sims/{iccid} zonder prefix al 405 gaf = endpoint bestaat!
  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const aEmpty = a === '' ? 0 : 1;
    const bEmpty = b === '' ? 0 : 1;
    return aEmpty - bEmpty;
  });

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      for (const auth of allAuthVariants) {
        const contentTypes = tpl.method === 'GET'
          ? (['none'] as const)
          : (['json', 'form'] as const);

        for (const contentType of contentTypes) {
          if (tpl.method === 'GET' && auth.tag === 'creds-body') continue;

          const endpointPath = `${prefix}${tpl.pathTpl}`.replace('{iccid}', encodeURIComponent(iccid));
          const fullUrl = makePerSimFullUrl(
            creds.baseUrl,
            endpointPath,
            tpl.method === 'GET' ? (tpl.query ?? {}) : null,
          );
          const body = tpl.method === 'POST' ? (tpl.body ?? {}) : null;
          const meta: PerSimAttemptMeta = {
            endpointPath,
            method: tpl.method,
            authTag: toAuthTag(auth),
            contentType,
          };

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
            return status;
          }

          pushRanked(meta, result);
          if (result.tag === 'error') lastErrorResult = result;

          // === MAGIE: 405 MethodNotAllowed → direct de andere methode proberen op dezelfde URL! ===
          if (result.statusCode === 405) {
            const altMethod = alternativeMethodFor405(tpl.method) as 'GET' | 'POST';
            if (altMethod !== tpl.method && !(altMethod === 'GET' && auth.tag === 'creds-body')) {
              const altContentType: 'json' | 'form' | 'none' = altMethod === 'GET' ? 'none' : 'json';
              const altQuery = altMethod === 'GET' ? { iccid, ...(tpl.query ?? {}) } : null;
              const altBody = altMethod === 'POST' ? { iccid, ...(tpl.body ?? {}) } : null;
              const altFullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, altQuery);
              const altMeta: PerSimAttemptMeta = {
                endpointPath,
                method: altMethod,
                authTag: toAuthTag(auth),
                contentType: altContentType,
              };
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
                return status;
              }
              pushRanked(altMeta, altResult);
              if (altResult.tag === 'error') lastErrorResult = altResult;
            }
          }
        }
      }
    }
  }

  const top = topRanked(3);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 180)}` : ''}`,
      ).join('\n')
    : '  (geen pogingen geregistreerd)';

  if (lastErrorResult) {
    const raw = lastErrorResult.raw ?? (top[0] ? undefined : undefined);
    const statusCode = lastErrorResult.statusCode || (top[0]?.statusCode ?? 500);
    throw new SimhuisApiError(
      statusCode,
      raw ?? null,
      creds.baseUrl,
      `[Simhuis] getSimStatus mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
    );
  }

  throw new Error(
    `[Simhuis] getSimStatus mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
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

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;
  let successRaw: unknown = null;
  let successFound = false;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 4);
  const iccid = options.iccid;

  type Template = { method: 'POST' | 'PUT' | 'PATCH'; pathTpl: string; body: Record<string, unknown> };
  const templates: Template[] = [
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
  function altMethodFor405(method: 'POST' | 'PUT' | 'PATCH'): 'POST' | 'PUT' | 'PATCH' {
    if (method === 'POST') return 'PUT';
    return 'POST';
  }

  // Eerst LEEGE prefix (geen /api/v1), omdat /sims/{iccid} zonder prefix al 405 gaf = endpoint bestaat!
  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const aEmpty = a === '' ? 0 : 1;
    const bEmpty = b === '' ? 0 : 1;
    return aEmpty - bEmpty;
  });

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      for (const auth of allAuthVariants) {
        const contentTypes: Array<'json' | 'form'> = ['json', 'form'];
        for (const contentType of contentTypes) {
          const endpointPath = `${prefix}${tpl.pathTpl}`.replace('{iccid}', encodeURIComponent(iccid));
          const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, null);
          const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };
          const result = await doPerSimFetch({
            fullUrl,
            method: tpl.method,
            contentType,
            body: tpl.body,
            auth,
            timeoutMs: 25_000,
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

          // 405 → direct andere methode proberen op dezelfde URL
          if (result.statusCode === 405) {
            const altMethod = altMethodFor405(tpl.method);
            if (altMethod !== tpl.method) {
              const altMeta: PerSimAttemptMeta = { endpointPath, method: altMethod, authTag: toAuthTag(auth), contentType };
              const altResult = await doPerSimFetch({
                fullUrl,
                method: altMethod,
                contentType,
                body: { ...tpl.body },
                auth,
                timeoutMs: 25_000,
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

  const top = topRanked(3);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 180)}` : ''}`,
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
      `[Simhuis] activateSim mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
    );
  }
  throw new Error(
    `[Simhuis] activateSim mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
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

  const rankedAttempts: RankedAttempt[] = [];
  let lastErrorResult: PerSimAttemptResult | null = null;
  let successRaw: unknown = null;
  let successFound = false;

  const prefixes = getSimhuisPathPrefixes(creds.endpoints.sims).slice(0, 4);

  type Template = { method: 'POST' | 'PUT' | 'PATCH'; pathTpl: string; body: Record<string, unknown> };
  const templates: Template[] = [
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
  function altMethodFor405(method: 'POST' | 'PUT' | 'PATCH'): 'POST' | 'PUT' | 'PATCH' {
    if (method === 'POST') return 'PUT';
    return 'POST';
  }

  // Eerst LEEGE prefix (geen /api/v1), omdat /sims/{iccid} zonder prefix al 405 gaf = endpoint bestaat!
  const orderedPrefixes = [...prefixes].sort((a, b) => {
    const aEmpty = a === '' ? 0 : 1;
    const bEmpty = b === '' ? 0 : 1;
    return aEmpty - bEmpty;
  });

  for (const prefix of orderedPrefixes) {
    for (const tpl of templates) {
      for (const auth of allAuthVariants) {
        const contentTypes: Array<'json' | 'form'> = ['json', 'form'];
        for (const contentType of contentTypes) {
          const endpointPath = `${prefix}${tpl.pathTpl}`.replace('{iccid}', encodeURIComponent(iccid));
          const fullUrl = makePerSimFullUrl(creds.baseUrl, endpointPath, null);
          const meta: PerSimAttemptMeta = { endpointPath, method: tpl.method, authTag: toAuthTag(auth), contentType };
          const result = await doPerSimFetch({
            fullUrl,
            method: tpl.method,
            contentType,
            body: tpl.body,
            auth,
            timeoutMs: 25_000,
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

          // 405 → direct andere methode proberen op dezelfde URL
          if (result.statusCode === 405) {
            const altMethod = altMethodFor405(tpl.method);
            if (altMethod !== tpl.method) {
              const altMeta: PerSimAttemptMeta = { endpointPath, method: altMethod, authTag: toAuthTag(auth), contentType };
              const altResult = await doPerSimFetch({
                fullUrl,
                method: altMethod,
                contentType,
                body: { ...tpl.body },
                auth,
                timeoutMs: 25_000,
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

  const top = topRanked(3);
  const topStr = top.length
    ? top.map(
        (t) =>
          `  - [${t.score}pt] HTTP ${t.statusCode} | ${t.meta.method} ${t.meta.endpointPath} | auth=${t.meta.authTag} | ctype=${t.meta.contentType}${t.error ? ` → ${t.error.slice(0, 180)}` : ''}`,
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
      `[Simhuis] deactivateSim mislukt voor ICCID ${iccid}. Server-side fout: ${lastErrorResult.error}\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
    );
  }
  throw new Error(
    `[Simhuis] deactivateSim mislukt voor ICCID ${iccid}. Alle endpoints gaven 404/405/400/401/403; onvoldoende match.\n\nTop-3 meest veelbelovende pogingen:\n${topStr}`,
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
  const MAX_ATTEMPTS = 80;
  let pogingen = 0;
  const overallDeadline = AbortSignal.timeout(45000);
  const allowHeadersByPath = new Map<string, string>();
  const authBasic = basicAuthHeader(creds.username, creds.password);

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
  const noAuth: AuthStyle = { tag: 'custom-headers', headers: {} };
  const xUserPassHeaders: AuthStyle = {
    tag: 'custom-headers',
    headers: {
      'X-API-Username': creds.username,
      'X-API-Password': creds.password,
      ...(resellerId ? { 'X-Reseller-ID': String(resellerId) } : {}),
    },
  };

  const resellerFragment = resellerId ? encodeURIComponent(String(resellerId)) : null;

  // ===== FASE -1: MULTI-BASE PROBE — probeer eerst 6 waarschijnlijke base URLs met 3 tests per base =====
  // Want: historische sessie gaf WEL app-level response op POST /v3/sims, NU alles 405 Allow: OPTIONS.
  // Dus base URL is waarschijnlijk verkeerd ingesteld in GUI.
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
    // 3 tests per base: POST /sims basic met {page:1,limit:100}, POST /auth/login noauth, GET / basic
    const testCases: Array<{ method: 'GET' | 'POST'; path: string; auth: AuthStyle; kind: 'json-body' | 'query' | 'form-body'; body?: Record<string, any>; query?: Record<string, any> }> = [
      { method: 'POST', path: '/sims', auth: basicAuthOnly, kind: 'json-body', body: { page: 1, limit: 100 } },
      { method: 'POST', path: '/auth/login', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password } },
      { method: 'GET', path: '/auth/me', auth: basicAuthOnly, kind: 'query' },
    ];
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
    method: 'GET' | 'POST';
    path: string;
    auth: AuthStyle;
    kind: 'query' | 'json-body' | 'form-body';
    body?: Record<string, any>;
    query?: Record<string, any>;
  };

  // FASE 0: 20 SNELLE probes (max 5 seconden) — alleen de KENNIS opdoen welke (path,method,auth) combinaties uberhaupt de app bereiken (geen Allow:OPTIONS 405).
  // Dit is informatiever dan 100+ wilde pogingen.
  const probes: Phase0Probe[] = [
    { label: 'POST-login-json-noauth', method: 'POST', path: '/auth/login', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password } },
    { label: 'POST-login-form-noauth', method: 'POST', path: '/auth/login', auth: noAuth, kind: 'form-body', body: { username: creds.username, password: creds.password } },
    { label: 'POST-login-json-noauth', method: 'POST', path: '/login', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password } },
    { label: 'POST-login-form-noauth', method: 'POST', path: '/login', auth: noAuth, kind: 'form-body', body: { username: creds.username, password: creds.password } },
    { label: 'POST-token-json-noauth', method: 'POST', path: '/token', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, grant_type: 'password' } },
    { label: 'GET-auth-me-basic', method: 'GET', path: '/auth/me', auth: basicAuthOnly, kind: 'query' },
    { label: 'GET-me-basic', method: 'GET', path: '/me', auth: basicAuthOnly, kind: 'query' },
    { label: 'POST-sims-empty-body-basic', method: 'POST', path: '/sims', auth: basicAuthOnly, kind: 'json-body', body: {} },
    { label: 'POST-sims-page-limit-basic', method: 'POST', path: '/sims', auth: basicAuthOnly, kind: 'json-body', body: { page: 1, limit: 100 } },
    { label: 'GET-sims-page-limit-basic', method: 'GET', path: '/sims', auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 100 } },
    { label: 'POST-sims-creds-body-noauth', method: 'POST', path: '/sims', auth: noAuth, kind: 'json-body', body: { username: creds.username, password: creds.password, page: 1, limit: 100 } },
    { label: 'POST-sims-creds-body-xheaders', method: 'POST', path: '/sims', auth: xUserPassHeaders, kind: 'json-body', body: { page: 1, limit: 100 } },
    { label: 'POST-sims-reseller-creds-body-basic', method: 'POST', path: '/sims', auth: basicAuthOnly, kind: 'json-body', body: { username: creds.username, password: creds.password, page: 1, limit: 100 } },
  ];
  if (resellerFragment) {
    probes.push(
      { label: 'GET-reseller-sims-basic', method: 'GET', path: `/resellers/${resellerFragment}/sims`, auth: basicAuthOnly, kind: 'query', query: { page: 1, limit: 100 } },
      { label: 'POST-reseller-sims-basic', method: 'POST', path: `/resellers/${resellerFragment}/sims`, auth: basicAuthOnly, kind: 'json-body', body: { page: 1, limit: 100 } },
      { label: 'GET-reseller-sims-noauth-credsquery', method: 'GET', path: `/resellers/${resellerFragment}/sims`, auth: noAuth, kind: 'query', query: { username: creds.username, password: creds.password, page: 1, limit: 100 } },
    );
  } else {
    probes.push(
      { label: 'GET-root-basic', method: 'GET', path: '/', auth: basicAuthOnly, kind: 'query' },
      { label: 'POST-root-basic-empty', method: 'POST', path: '/', auth: basicAuthOnly, kind: 'json-body', body: {} },
      { label: 'POST-v3-basic-empty', method: 'POST', path: '/', auth: basicAuthOnly, kind: 'json-body', body: {} },
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
      if (args.auth.tag === 'basic-header' || args.auth.tag === 'bearer-header' ||
          args.auth.tag === 'apikey-header-x' || args.auth.tag === 'api-key-auth-header') {
        headers.Authorization = args.auth.header;
      } else if (args.auth.tag === 'custom-headers') {
        Object.assign(headers, args.auth.headers);
      }
      let body: BodyInit | undefined;
      if ((args.method === 'POST' || args.method === 'PUT' || args.method === 'PATCH') && args.body) {
        if (args.contentType === 'json') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(args.body);
        } else if (args.contentType === 'form') {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(args.body)) {
            if (v === null || v === undefined || v === '') continue;
            if (typeof v === 'object') sp.append(k, JSON.stringify(v));
            else sp.append(k, String(v));
          }
          headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
          body = sp.toString();
        }
      }
      const resp = await fetch(args.fullUrl, { method: args.method, headers, body, signal: overallDeadline });
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

      let bodyInit: BodyInit | undefined;
      const fullUrl = probe.method === 'GET'
        ? buildFinalUrl(probe.path, (probe.query ?? {}) as Record<string, any>)
        : buildFinalUrl(probe.path, null);

      if (probe.method === 'POST' && probe.body) {
        if (probe.kind === 'json-body') {
          headers['Content-Type'] = 'application/json';
          bodyInit = JSON.stringify(probe.body);
        } else if (probe.kind === 'form-body') {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(probe.body)) {
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
    // ===== FASE 1 B: Geen interessante response gevonden → classic fallback naar 22 kansrijke (reseller+inventory+subscription) paden met basic auth =====
    const backupPaths: string[] = [
      '/inventory', '/inventory/sims', '/inventory/list', '/inventory/search',
      '/subscriptions', '/subscriptions/list', '/simcards', '/sim-cards',
      '/pool/sims', '/stock/sims', '/available/sims', '/inactive/sims',
      '/iccids', '/devices', '/account/sims', '/account/inventory',
      '/customer/sims', '/packages', '/offers', '/plans', '/all/sims', '/sims.json',
    ];
    if (resellerFragment) {
      backupPaths.unshift(
        `/resellers/${resellerFragment}/sims`,
        `/resellers/${resellerFragment}/inventory`,
        `/resellers/${resellerFragment}/subscriptions`,
      );
    }
    for (const path of backupPaths) {
      for (const inject of injectStylesFast) {
        for (const method of httpMethodsFast) {
          if (method === 'GET') {
            const query = augmentQuery(inject);
            const r = await doDirectFetch({
              fullUrl: buildFinalUrl(path, query),
              method: 'GET',
              contentType: 'none',
              body: null,
              auth: basicAuthOnly,
              meta: { method: 'GET', path, kind: 'query', signature: `fase=1b;auth=basic;inject=${inject}` },
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
              auth: basicAuthOnly,
              meta: { method, path, kind: 'json-body', signature: `fase=1b;auth=basic;inject=${inject}` },
              pathForAllowHeader: path,
            });
            if (r1) return r1;
          }
          if (pogingen > MAX_ATTEMPTS || overallDeadline.aborted) break;
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
