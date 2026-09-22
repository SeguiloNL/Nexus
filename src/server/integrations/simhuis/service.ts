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
  path: string;
  kind: 'query' | 'json-body' | 'form-body';
  payload?: Record<string, any>;
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

export async function listSims(options: ListSimsOptions = {}): Promise<ListSimsResult> {
  const client = (await simhuisClient.getClient())!;
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  const resellerId = options.resellerId ?? client.resellerId;

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

  const queryVariants = payloadVariants;

  const pathVariants = [
    client.endpoints.sims,
    client.endpoints.sims + '/list',
    client.endpoints.sims + '/search',
    client.endpoints.sims + '/query',
    '/sims',
    '/sims/list',
    '/sims/search',
    '/sims/query',
    '/sim/list',
    '/sims.json',
  ];

  const attempts: ListAttempt[] = [];

  const tryOne = async (a: ListAttempt): Promise<ListSimsResult | null> => {
    const trace: ListAttempt = { ...a };
    try {
      let opts: SimhuisRequestOptions;
      if (a.method === 'GET') {
        opts = { method: 'GET', query: a.payload };
      } else if (a.kind === 'form-body') {
        opts = {
          method: 'POST',
          body: (a.payload ? objToFormEncoded(a.payload) : new URLSearchParams()) as any,
        };
      } else {
        opts = { method: 'POST', body: a.payload && Object.keys(a.payload).length > 0 ? a.payload : undefined };
      }
      const resp = await doRequest<unknown>(a.path, opts);
      const rawArray = extractSimList(resp);
      const items = rawArray.map((item) => {
        const iccid = String(item.iccid ?? item.sim_iccid ?? item.simIccid ?? (item as any)?.sim?.iccid ?? '').trim();
        return toSimStatus(item, iccid);
      });
      const total = extractTotal(resp, items.length);
      const hasMore = typeof total === 'number' ? (page * limit) < total : items.length === limit;
      return { items, total, page: page, limit: limit, hasMore, raw: resp };
    } catch (err: any) {
      trace.statusCode = err instanceof SimhuisApiError ? err.statusCode : undefined;
      trace.error = String(err?.message ?? err ?? 'Onbekende fout').slice(0, 200);
      trace.errorClass = err instanceof SimhuisApiError ? 'SimhuisApiError' : err?.constructor?.name ?? 'Error';
      attempts.push(trace);
      if (err instanceof SimhuisApiError) {
        if (err.statusCode === 401 || err.statusCode === 403) {
          throw err;
        }
        return null;
      }
      return null;
    }
  };

  const postPaths = [
    client.endpoints.sims,
    client.endpoints.sims + '/search',
    client.endpoints.sims + '/query',
    client.endpoints.sims + '/list',
    '/sims',
    '/sims/search',
    '/sims/query',
    '/sims/list',
    '/sim/list',
  ];
  for (const path of postPaths) {
    for (const b of payloadVariants) {
      const r1 = await tryOne({ method: 'POST', path: path, kind: 'json-body', payload: b });
      if (r1) return r1;
      const r2 = await tryOne({ method: 'POST', path: path, kind: 'form-body', payload: b });
      if (r2) return r2;
    }
  }

  for (const path of pathVariants) {
    for (const q of queryVariants) {
      const result = await tryOne({ method: 'GET', path: path, kind: 'query', payload: q });
      if (result) return result;
    }
  }

  let summary = attempts
    .map((a) => `${a.method} ${a.path} [${a.statusCode ?? 'err'}] (${a.kind}) ${a.errorClass ?? ''}: ${a.error ?? ''}`)
    .join('\n');
  summary = summary.slice(0, 4000);
  const last = attempts[attempts.length - 1];
  const errMsg = `[Simhuis] listSims failed: geen enkel endpoint reageerde. Pogingen (${attempts.length}x, POST eerst):\n${summary}`;
  if (last?.errorClass === 'SimhuisApiError') {
    const e = new SimhuisApiError(last.statusCode ?? 500, {}, last?.path ?? '', errMsg);
    (e as any).attempts = attempts;
    throw e;
  }
  const genErr = new Error(errMsg);
  (genErr as any).attempts = attempts;
  throw genErr;
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
