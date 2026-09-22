import { simhuisClient, SimhuisApiError, type SimhuisRequestOptions } from './client';
import type { ActivateSimOptions, SimhuisApiResponse, SimhuisSimStatus } from './types';

function toSimStatus(raw: unknown, iccid: string): SimhuisSimStatus {
  const r = (raw ?? {}) as Record<string, any>;
  const statusRaw = String(r.status ?? r.state ?? r.sim_status ?? r.simState ?? '').toLowerCase();
  let status: SimhuisSimStatus['status'] = statusRaw as any;
  if (['active','enabled','online'].includes(statusRaw)) status = 'active';
  else if (['inactive','disabled','offline'].includes(statusRaw)) status = 'inactive';
  else if (['suspended','paused','barred'].includes(statusRaw)) status = 'suspended';
  else if (['terminated','deleted','cancelled'].includes(statusRaw)) status = 'terminated';
  else if (['provisioning','activating','pending'].includes(statusRaw)) status = 'provisioning';
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

type ListAttempt = {
  method: 'GET' | 'POST';
  baseTag: string;
  path: string;
  kind: 'query' | 'json-body' | 'form-body';
  signature?: string;
  statusCode?: number;
  error?: string;
  errorClass?: string;
};

function objToFormEncoded(obj: Record<string, any>): URLSearchParams {
  const params = new URLSearchParams();
  const append = (key: string, v: any) => {
    if (v === null || v === undefined || v === '') return;
    if (typeof v === 'object') {
      params.append(key, JSON.stringify(v));
    } else {
      params.append(key, String(v));
    }
  };
  for (const k of Object.keys(obj)) append(k, obj[k]);
  return params;
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

export async function listSims(options: ListSimsOptions = {}): Promise<ListSimsResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;

  const credsClient = await simhuisClient.getClient();
  if (!credsClient) {
    throw new Error('[Simhuis] Niet geconfigureerd.');
  }
  const creds = (credsClient as any).creds as {
    baseUrl: string; authMode: 'basic' | 'bearer';
    username: string; password: string; resellerId?: string | null;
  };
  const resellerId = options.resellerId ?? creds.resellerId;

  const basePayload: Record<string, any> = { page: page, limit: limit };
  if (resellerId) basePayload.reseller_id = resellerId;
  if (options.status) basePayload.status = options.status;

  const payloadVariantsRaw: Array<Record<string, any> | null | undefined> = [
    {},
    { ...basePayload },
    { ...basePayload, per_page: limit, page_number: page },
    { ...basePayload, page: page, size: limit },
    { limit: limit },
    { page: page },
    { pagination: { page: page, limit: limit } },
    {
      filter: options.status ? { status: options.status } : undefined,
      resellerId: resellerId,
      page: page,
      limit: limit,
    },
    { action: 'list_sims', page: page, limit: limit },
  ];
  const payloadVariants = payloadVariantsRaw.filter((b): b is Record<string, any> => b !== null && b !== undefined);

  const baseSims = credsClient.endpoints.sims;
  const resellerFragment = resellerId ? encodeURIComponent(String(resellerId)) : null;

  const pathVariants: string[] = [
    baseSims,
    `${baseSims}/list`,
    `${baseSims}/search`,
    `${baseSims}/query`,
    `${baseSims}/all`,
    `${baseSims}/inventory`,
    `${baseSims}.json`,
    '/sims',
    '/sims/list',
    '/sims/search',
    '/sims/query',
    '/sims/all',
    '/sims.json',
    '/sim/list',
    '/inventory/sims',
    '/stock/sims',
    '/sims/inventory',
    '/available-sims',
    '/account/sims',
    '/accounts/sims',
    '/sims/available',
    '/sims/stock',
  ];
  if (resellerFragment) {
    pathVariants.push(
      `/resellers/${resellerFragment}/sims`,
      `/reseller/${resellerFragment}/sims`,
      `/resellers/${resellerFragment}/sims/list`,
      `/resellers/${resellerFragment}/inventory/sims`,
      `/partners/${resellerFragment}/sims`,
    );
  }

  const baseUrlVariants: Array<{ tag: string; base: string }> = [
    { tag: 'cfg', base: creds.baseUrl },
  ];
  try {
    const u = new URL(creds.baseUrl);
    const origin = u.origin;
    const stripped = origin;
    baseUrlVariants.push({ tag: 'no-v3', base: stripped });
    baseUrlVariants.push({ tag: 'api-v3', base: `${origin}/api/v3` });
    baseUrlVariants.push({ tag: 'api-v1', base: `${origin}/api/v1` });
    baseUrlVariants.push({ tag: 'api', base: `${origin}/api` });
    baseUrlVariants.push({ tag: 'rest-v3', base: `${origin}/rest/v3` });
    baseUrlVariants.push({ tag: 'sim-api', base: `${origin}/sim-api/v3` });
  } catch { /* ignore */ }

  const attempts: ListAttempt[] = [];

  const processResponse = (
    respBodyRaw: unknown,
  ): ListSimsResult | null => {
    const rawArray = extractSimList(respBodyRaw);
    if (!rawArray || rawArray.length === 0) {
      const bodyAsObj = respBodyRaw as Record<string, any> | null;
      if (
        bodyAsObj && typeof bodyAsObj === 'object' &&
        ('iccid' in bodyAsObj || 'sim_iccid' in bodyAsObj)
      ) {
        const iccid = String(bodyAsObj.iccid ?? bodyAsObj.sim_iccid ?? '').trim();
        if (iccid) {
          const items = [toSimStatus(bodyAsObj, iccid)];
          return { items, total: 1, page: page, limit: limit, hasMore: false, raw: respBodyRaw };
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

  const doDirectFetch = async (args: {
    fullUrl: string;
    method: 'GET' | 'POST';
    contentType: 'json' | 'form' | 'none';
    body: Record<string, any> | null;
    authBasic?: string;
    meta: Omit<ListAttempt, 'statusCode' | 'error' | 'errorClass'>;
  }): Promise<ListSimsResult | null> => {
    const trace: ListAttempt = { ...args.meta };
    try {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (args.authBasic) headers['Authorization'] = args.authBasic;
      let body: BodyInit | undefined;
      if (args.method === 'POST' && args.body) {
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
      const resp = await fetch(args.fullUrl, {
        method: args.method,
        headers,
        body,
        signal: AbortSignal.timeout(15000),
      });
      const ct = resp.headers.get('content-type') ?? '';
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
        const snippet = (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).slice(0, 120);
        trace.error = `HTTP ${resp.status} ${snippet ? `: ${snippet}` : ''}`;
        trace.errorClass = 'HTTPError';
        attempts.push(trace);
        if (resp.status === 401 || resp.status === 403) {
          throw new SimhuisApiError(resp.status, parsed ?? {}, args.fullUrl, trace.error);
        }
        return null;
      }
    } catch (err: any) {
      trace.statusCode = err instanceof SimhuisApiError ? err.statusCode : undefined;
      trace.error = String(err?.message ?? err ?? 'Onbekende fout').slice(0, 200);
      trace.errorClass = err instanceof SimhuisApiError ? 'SimhuisApiError' : err?.constructor?.name ?? 'Error';
      attempts.push(trace);
      if (err instanceof SimhuisApiError && (err.statusCode === 401 || err.statusCode === 403)) {
        throw err;
      }
      return null;
    }
    return null;
  };

  const makeFullUrl = (base: string, path: string, query: Record<string, any> | null): string => {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    let url = base.endsWith('/') ? `${base}${cleanPath}` : `${base}/${cleanPath}`;
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

  const authBasicHeader = basicAuthHeader(creds.username, creds.password);

  for (const baseInfo of baseUrlVariants) {
    for (const path of pathVariants) {
      for (const b of payloadVariants) {
        const bodyHasKeys = Object.keys(b).length > 0;
        const r1 = await doDirectFetch({
          fullUrl: makeFullUrl(baseInfo.base, path, null),
          method: 'POST',
          contentType: 'json',
          body: bodyHasKeys ? b : {},
          authBasic: authBasicHeader,
          meta: { method: 'POST', baseTag: baseInfo.tag, path, kind: 'json-body', signature: bodyHasKeys ? Object.keys(b).sort().join(',') : 'empty' },
        });
        if (r1) return r1;
        const r2 = await doDirectFetch({
          fullUrl: makeFullUrl(baseInfo.base, path, null),
          method: 'POST',
          contentType: 'form',
          body: bodyHasKeys ? b : {},
          authBasic: authBasicHeader,
          meta: { method: 'POST', baseTag: baseInfo.tag, path, kind: 'form-body', signature: bodyHasKeys ? Object.keys(b).sort().join(',') : 'empty' },
        });
        if (r2) return r2;
      }
      for (const q of payloadVariants) {
        const r = await doDirectFetch({
          fullUrl: makeFullUrl(baseInfo.base, path, q),
          method: 'GET',
          contentType: 'none',
          body: null,
          authBasic: authBasicHeader,
          meta: { method: 'GET', baseTag: baseInfo.tag, path, kind: 'query', signature: Object.keys(q).sort().join(',') },
        });
        if (r) return r;
      }
    }
    // JSON-RPC endpoint + root endpoint with action body
    const rpcPaths = ['/jsonrpc', '/rpc', '/api', '/'];
    for (const rpcPath of rpcPaths) {
      const r1 = await doDirectFetch({
        fullUrl: makeFullUrl(baseInfo.base, rpcPath, null),
        method: 'POST',
        contentType: 'json',
        body: { jsonrpc: '2.0', method: 'sims.list', params: { ...basePayload }, id: 1 },
        authBasic: authBasicHeader,
        meta: { method: 'POST', baseTag: baseInfo.tag, path: rpcPath, kind: 'json-body', signature: 'jsonrpc:sims.list' },
      });
      if (r1) return r1;
      const r2 = await doDirectFetch({
        fullUrl: makeFullUrl(baseInfo.base, rpcPath, { action: 'list_sims', ...basePayload }),
        method: 'GET',
        contentType: 'none',
        body: null,
        authBasic: authBasicHeader,
        meta: { method: 'GET', baseTag: baseInfo.tag, path: rpcPath, kind: 'query', signature: 'action:list_sims' },
      });
      if (r2) return r2;
    }
  }

  // Dedup for error summary
  const seen = new Map<string, { attempt: ListAttempt; count: number }>();
  for (const a of attempts) {
    const key = `${a.method} ${a.baseTag}${a.path} [${a.statusCode ?? 'err'}] (${a.kind})`;
    const cur = seen.get(key);
    if (cur) cur.count++;
    else seen.set(key, { attempt: a, count: 1 });
  }
  let summary = Array.from(seen.values())
    .map(({ attempt: a, count }) => `${a.method} ${a.path} (base=${a.baseTag}) [${a.statusCode ?? 'err'}] (${a.kind}) ×${count} ${a.errorClass ?? ''}: ${a.error ?? ''}`)
    .join('\n');
  summary = summary.slice(0, 8000);
  const msg = `[Simhuis] listSims failed: ${attempts.length} pogingen, geen succes. Samenvatting:\n${summary}`;
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
