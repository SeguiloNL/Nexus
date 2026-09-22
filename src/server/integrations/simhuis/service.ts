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

export async function getSimStatus(iccid: string): Promise<SimhuisSimStatus> {
  const client = (await simhuisClient.getClient())!;
  const paths = [
    `${client.endpoints.sims}/${encodeURIComponent(iccid)}`,
    `${client.endpoints.sims}?iccid=${encodeURIComponent(iccid)}`,
    `/sim/${encodeURIComponent(iccid)}`,
  ];
  let lastErr: unknown = null;
  for (const path of paths) {
    try {
      const resp = await doRequest<unknown>(path, { method: 'GET' });
      return toSimStatus(resp, iccid);
    } catch (err) {
      lastErr = err;
      if (err instanceof SimhuisApiError) {
        if (err.statusCode === 404 || err.statusCode === 405) continue;
      }
      throw err;
    }
  }
  if (lastErr instanceof SimhuisApiError && lastErr.statusCode === 404) {
    return { iccid, status: null, raw: null };
  }
  throw lastErr ?? new Error(`[Simhuis] getSimStatus failed for ICCID ${iccid}`);
}

export async function activateSim(options: ActivateSimOptions): Promise<SimhuisSimStatus> {
  const client = (await simhuisClient.getClient())!;
  const resellerId = options.resellerId ?? client.resellerId;
  const bodyBase: Record<string, unknown> = {};
  if (options.offerId) bodyBase.offer_id = options.offerId;
  if (options.planId) bodyBase.plan_id = options.planId;
  if (resellerId) bodyBase.reseller_id = resellerId;
  if (options.customerRef) bodyBase.customer_ref = options.customerRef;
  if (options.iccid) bodyBase.iccid = options.iccid;

  const baseBodyWithIccid = { ...bodyBase, iccid: options.iccid };

  const attempts = [
    {
      path: `${client.endpoints.sims}/${encodeURIComponent(options.iccid)}${client.endpoints.simActivate}`,
      method: 'POST' as const,
      body: bodyBase,
    },
    {
      path: `${client.endpoints.sims}/activate`,
      method: 'POST' as const,
      body: baseBodyWithIccid,
    },
    {
      path: `/sim/${encodeURIComponent(options.iccid)}/activate`,
      method: 'POST' as const,
      body: bodyBase,
    },
    {
      path: `${client.endpoints.sims}/${encodeURIComponent(options.iccid)}`,
      method: 'PUT' as const,
      body: { ...bodyBase, status: 'active' },
    },
  ];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const resp = await doRequest<unknown>(attempt.path, { method: attempt.method, body: attempt.body });
      return toSimStatus(resp, options.iccid);
    } catch (err) {
      lastErr = err;
      if (err instanceof SimhuisApiError) {
        if (err.statusCode === 404 || err.statusCode === 405 || err.statusCode === 400) {
          continue;
        }
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`[Simhuis] activateSim failed for ICCID ${options.iccid}`);
}

export async function deactivateSim(iccid: string): Promise<SimhuisSimStatus> {
  const client = (await simhuisClient.getClient())!;
  const attempts = [
    {
      path: `${client.endpoints.sims}/${encodeURIComponent(iccid)}${client.endpoints.simDeactivate}`,
      method: 'POST' as const,
      body: { iccid },
    },
    {
      path: `${client.endpoints.sims}/deactivate`,
      method: 'POST' as const,
      body: { iccid },
    },
    {
      path: `/sim/${encodeURIComponent(iccid)}/deactivate`,
      method: 'POST' as const,
      body: { iccid },
    },
    {
      path: `${client.endpoints.sims}/${encodeURIComponent(iccid)}`,
      method: 'PUT' as const,
      body: { iccid, status: 'inactive' },
    },
  ];

  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const resp = await doRequest<unknown>(attempt.path, { method: attempt.method, body: attempt.body });
      return toSimStatus(resp, iccid);
    } catch (err) {
      lastErr = err;
      if (err instanceof SimhuisApiError) {
        if (err.statusCode === 404 || err.statusCode === 405 || err.statusCode === 400) {
          continue;
        }
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(`[Simhuis] deactivateSim failed for ICCID ${iccid}`);
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
  const MAX_ATTEMPTS = 120;
  let pogingen = 0;
  const overallDeadline = AbortSignal.timeout(30000);
  const allowHeadersByPath = new Map<string, string>();

  const authBasic = basicAuthHeader(creds.username, creds.password);
  const authStylesFast: AuthStyle[] = [
    { tag: 'basic-header', header: authBasic },
    {
      tag: 'custom-headers',
      headers: {
        'X-API-Username': creds.username,
        'X-API-Password': creds.password,
        ...(resellerId ? { 'X-Reseller-ID': String(resellerId) } : {}),
      },
    },
  ];

  const resellerFragment = resellerId ? encodeURIComponent(String(resellerId)) : null;

  const listStylePaths: string[] = [
    '/inventory',
    '/inventory/sims',
    '/inventory/list',
    '/inventory/search',
    '/subscriptions',
    '/subscriptions/list',
    '/subscriptions/search',
    '/simcards',
    '/sim-cards',
    '/simcards/list',
    '/pool/sims',
    '/stock/sims',
    '/available/sims',
    '/available-sims',
    '/inactive/sims',
    '/iccids',
    '/iccids/list',
    '/devices',
    '/devices/sims',
    '/account/sims',
    '/account/inventory',
    '/customer/sims',
    '/customer/inventory',
    '/users/sims',
    '/packages',
    '/packages/sims',
    '/offers',
    '/offers/sims',
    '/plans',
    '/plans/sims',
    '/tariffs/sims',
    '/resellers/sims',
    '/reseller/sims',
    '/all/sims',
    '/sims.json',
    '/inventory.json',
    '/subscriptions.json',
  ];
  if (resellerFragment) {
    listStylePaths.unshift(
      `/resellers/${resellerFragment}/sims`,
      `/resellers/${resellerFragment}/inventory`,
      `/resellers/${resellerFragment}/subscriptions`,
      `/resellers/${resellerFragment}/simcards`,
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
      const headers: Record<string, string> = { Accept: 'application/json' };
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
          allowHeadersByPath.set(args.pathForAllowHeader, allow);
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
        const allowExtra = (resp.status === 405 && allowHeadersByPath.has(args.pathForAllowHeader))
          ? ` [Allow: ${allowHeadersByPath.get(args.pathForAllowHeader)}]`
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

  // Fase 1 (snelle dekking): 38 paden × 2 auths × 2 injects × 2 methods × 2 kinds ≈ 240 worst-case → stoppen bij 120
  // Vindt hopelijk snel een 200, 201 of 204 response met een array of data-lijst.
  for (const path of listStylePaths) {
    for (const auth of authStylesFast) {
      for (const inject of injectStylesFast) {
        for (const method of httpMethodsFast) {
          if (method === 'GET') {
            const query = augmentQuery(inject);
            const r = await doDirectFetch({
              fullUrl: makeFullUrl(path, query),
              method: 'GET',
              contentType: 'none',
              body: null,
              auth,
              meta: { method: 'GET', path, kind: 'query', signature: `auth=${auth.tag};inject=${inject}` },
              pathForAllowHeader: path,
            });
            if (r) return r;
          } else {
            const body = augmentBody(inject);
            const r1 = await doDirectFetch({
              fullUrl: makeFullUrl(path, null),
              method,
              contentType: 'json',
              body,
              auth,
              meta: { method, path, kind: 'json-body', signature: `auth=${auth.tag};inject=${inject}` },
              pathForAllowHeader: path,
            });
            if (r1) return r1;
            const r2 = await doDirectFetch({
              fullUrl: makeFullUrl(path, null),
              method,
              contentType: 'form',
              body,
              auth,
              meta: { method, path, kind: 'form-body', signature: `auth=${auth.tag};inject=${inject}` },
              pathForAllowHeader: path,
            });
            if (r2) return r2;
          }
        }
      }
    }
  }

  // Fase 2 (laatste redmiddel): Bearer en ApiKey varianten op de 6 meest kansrijke paden
  const fallbackAuths: AuthStyle[] = [
    { tag: 'bearer-header', header: `Bearer ${creds.password}` },
    { tag: 'api-key-auth-header', header: `ApiKey ${creds.username}:${creds.password}` },
    { tag: 'apikey-header-x', header: `x-api-key ${creds.password}` },
    {
      tag: 'custom-headers',
      headers: {
        Authorization: authBasic,
        ...(resellerId ? { 'X-Reseller-ID': String(resellerId) } : {}),
      },
    },
  ];
  const backupPaths = listStylePaths.slice(0, 6);
  for (const path of backupPaths) {
    for (const auth of fallbackAuths) {
      for (const inject of injectStylesFast) {
        const body = augmentBody(inject);
        const r = await doDirectFetch({
          fullUrl: makeFullUrl(path, null),
          method: 'POST',
          contentType: 'json',
          body,
          auth,
          meta: { method: 'POST', path, kind: 'json-body', signature: `auth=${auth.tag};inject=${inject};fase=2` },
          pathForAllowHeader: path,
        });
        if (r) return r;
        const query = augmentQuery(inject);
        const r2 = await doDirectFetch({
          fullUrl: makeFullUrl(path, query),
          method: 'GET',
          contentType: 'none',
          body: null,
          auth,
          meta: { method: 'GET', path, kind: 'query', signature: `auth=${auth.tag};inject=${inject};fase=2` },
          pathForAllowHeader: path,
        });
        if (r2) return r2;
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
  summary = summary.slice(0, 5500);
  let allowHints = '';
  if (allowHeadersByPath.size > 0) {
    allowHints = '\n\n[Allow-headers hint (405 responses toonden WELKE methodes toegestaan zijn)]:\n';
    for (const [p, allow] of allowHeadersByPath.entries()) {
      allowHints += `  ${p}: Allow=${allow}\n`;
    }
  }
  const msg = `[Simhuis] listSims mislukt na ${attempts.length}/${MAX_ATTEMPTS} pogingen.${allowHints}\nSamenvatting:\n${summary}`;
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
