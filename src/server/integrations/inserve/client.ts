export type BuilderParamsStyle = 'json' | 'nested';

export interface InserveRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  builder?: unknown[];
  builderParamsStyle?: BuilderParamsStyle;
  signal?: AbortSignal;
}

export class InserveApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;
  public readonly url: string;

  constructor(statusCode: number, responseBody: unknown, url: string, message?: string) {
    let bodyPreview = '';
    try {
      if (responseBody !== null && responseBody !== undefined) {
        const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
        bodyPreview = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
      }
    } catch {
      bodyPreview = '';
    }
    const baseMsg = `Inserve API request failed with status ${statusCode} for ${url}` +
      (bodyPreview ? `\nResponse body: ${bodyPreview}` : '');
    super(message ?? baseMsg);
    this.name = 'InserveApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_WAIT_MS = 1000;
const CLIENT_CACHE_TTL_MS = 60_000;
const MIN_INTER_REQUEST_DELAY_MS = 300;
const MAX_REQUESTS_PER_RUN = 80;

interface ResolvedCredentials {
  subdomain: string;
  apiKey: string;
  source: "db" | "env";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveInserveCredentials(): Promise<ResolvedCredentials | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const SUBDOMAIN_KEY = "inserve.subdomain";
    const API_KEY_KEY = "inserve.apiKey";

    const [subdomainRow, apiKeyRow] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: SUBDOMAIN_KEY } }).catch(() => null),
      prisma.appSetting.findUnique({ where: { key: API_KEY_KEY } }).catch(() => null),
    ]);

    const dbSubdomain = subdomainRow?.value?.trim();
    const dbApiKey = apiKeyRow?.value?.trim();

    if (dbSubdomain && dbApiKey) {
      return { subdomain: dbSubdomain, apiKey: dbApiKey, source: "db" };
    }
  } catch {
    // fall through to env
  }

  const envSubdomain =
    typeof process !== "undefined" ? process.env.INSERVE_SUBDOMAIN?.trim() : undefined;
  const envApiKey =
    typeof process !== "undefined" ? process.env.INSERVE_API_KEY?.trim() : undefined;

  if (envSubdomain && envApiKey) {
    return { subdomain: envSubdomain, apiKey: envApiKey, source: "env" };
  }

  return null;
}

function appendNestedParams(
  params: URLSearchParams,
  prefix: string,
  value: unknown
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      appendNestedParams(params, `${prefix}[${idx}]`, item);
    });
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendNestedParams(params, `${prefix}[${k}]`, v);
    }
  } else {
    params.append(prefix, String(value));
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  builder?: unknown[],
  builderParamsStyle: BuilderParamsStyle = 'json'
): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  let url = baseUrl.endsWith('/') ? `${baseUrl}${cleanPath}` : `${baseUrl}/${cleanPath}`;

  const params = new URLSearchParams();

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
  }

  if (builder && builder.length > 0) {
    if (builderParamsStyle === 'nested') {
      builder.forEach((item, idx) => {
        appendNestedParams(params, `builder[${idx}]`, item);
      });
    } else {
      params.append('builder', JSON.stringify(builder));
    }
  }

  const search = params.toString();
  if (search) {
    url += `?${search}`;
  }

  return url;
}

export class InserveClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private static lastRequestAt: number = 0;
  private static requestsInRun: number = 0;
  private static currentRunResetAt: number = 0;

  constructor(subdomain: string, apiKey: string) {
    if (!subdomain) {
      throw new Error('[Inserve] Inserve subdomain is required');
    }
    if (!apiKey) {
      throw new Error('[Inserve] Inserve API key is required');
    }
    this.baseUrl = `https://${subdomain}.inserve.nl/api/`;
    this.apiKey = apiKey;
  }

  private static async throttleAndCount(): Promise<void> {
    const now = Date.now();
    const RUN_WINDOW_MS = 10 * 60 * 1000;
    if (now - InserveClient.currentRunResetAt > RUN_WINDOW_MS) {
      InserveClient.requestsInRun = 0;
      InserveClient.currentRunResetAt = now;
    }
    if (InserveClient.requestsInRun >= MAX_REQUESTS_PER_RUN) {
      throw new Error(
        `[Inserve] Rate limit: ${MAX_REQUESTS_PER_RUN} API calls reached within 10 minutes. ` +
        `Verlaag het aantal paginas of wacht.`
      );
    }
    InserveClient.requestsInRun++;
    const since = now - InserveClient.lastRequestAt;
    if (since < MIN_INTER_REQUEST_DELAY_MS) {
      const wait = MIN_INTER_REQUEST_DELAY_MS - since;
      await sleep(wait);
    }
    InserveClient.lastRequestAt = Date.now();
  }

  async request<T = unknown>(path: string, options: InserveRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, builder, builderParamsStyle = 'json', signal } = options;

    await InserveClient.throttleAndCount();

    const url = buildUrl(this.baseUrl, path, query, builder, builderParamsStyle);

    const controller = new AbortController();
    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function'
        ? (AbortSignal as any).timeout(REQUEST_TIMEOUT_MS)
        : (() => {
            const c = new AbortController();
            setTimeout(() => c.abort(new Error('Request timed out')), REQUEST_TIMEOUT_MS);
            return c.signal;
          })();

    const combinedSignal = signal && timeoutSignal
      ? this.combineSignals(signal, timeoutSignal, controller.signal)
      : timeoutSignal;

    const headers: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: combinedSignal,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const response = await fetch(url, { ...init, signal: combinedSignal });

        const contentType = response.headers.get('content-type') ?? '';
        let responseBody: unknown = null;
        try {
          if (contentType.includes('application/json')) {
            responseBody = await response.json();
          } else {
            responseBody = await response.text();
          }
        } catch {
          responseBody = null;
        }

        if (response.ok) {
          return responseBody as T;
        }

        const is429 = response.status === 429;
        const is5xx = response.status >= 500 && response.status < 600;
        const isGet = method === 'GET';

        if (is429) {
          const retryAfter = response.headers.get('Retry-After');
          let humanWait = '';
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
              if (seconds >= 60) {
                humanWait = ` (wacht ~${Math.ceil(seconds / 60)} minuten, tot ${new Date(Date.now() + seconds * 1000).toLocaleTimeString('nl-NL')})`;
              } else {
                humanWait = ` (wacht ${seconds} seconden)`;
              }
            }
          }
          const msg = `[Inserve] Rate limited (429) voor ${method} ${path}. Te veel API calls te snel${humanWait}. Doe a.u.b. geen nieuwe import tot dit venster voorbij is.`;
          console.error(msg);
          throw new InserveApiError(429, responseBody, url, msg);
        }

        if (attempt < maxAttempts && is5xx && isGet) {
          const waitMs = DEFAULT_RETRY_WAIT_MS;
          console.error(
            `[Inserve] Retrying ${method} ${path} after ${response.status} (attempt ${attempt}, waiting ${waitMs}ms)`
          );
          await sleep(waitMs);
          continue;
        }

        console.error(`[Inserve] Request failed: ${method} ${url} → status ${response.status}`);
        throw new InserveApiError(response.status, responseBody, url);
      } catch (err) {
        if (err instanceof InserveApiError) {
          throw err;
        }
        console.error(`[Inserve] Request error for ${method} ${url}:`, err instanceof Error ? err.message : err);
        throw err;
      }
    }

    throw new Error(`[Inserve] Unexpected end of retry loop for ${method} ${url}`);
  }

  private combineSignals(
    s1: AbortSignal,
    s2: AbortSignal,
    _controllerSignal: AbortSignal
  ): AbortSignal {
    const c = new AbortController();
    const onAbort = () => c.abort();
    if (s1.aborted) {
      c.abort();
    } else {
      s1.addEventListener('abort', onAbort, { once: true });
    }
    if (s2.aborted) {
      c.abort();
    } else {
      s2.addEventListener('abort', onAbort, { once: true });
    }
    return c.signal;
  }

  async requestAllPages<T extends { id?: number | string }>(
    path: string,
    options: Omit<InserveRequestOptions, 'query'> & {
      perPage?: number;
      withRelations?: string[];
      extraBuilder?: unknown[];
      maxPages?: number;
      builderParamsStyle?: BuilderParamsStyle;
    } = {}
  ): Promise<{
    items: T[];
    totalFetched: number;
    totalExpected: number;
    pagesProcessed: number;
    responses: any[];
  }> {
    const {
      perPage = 25,
      withRelations = [],
      extraBuilder = [],
      maxPages,
      method,
      body,
      signal,
      builderParamsStyle = 'json',
    } = options;
    const items: T[] = [];
    const responses: any[] = [];
    let currentPage = 1;
    let totalExpected = 0;
    let seenLastPage = false;

    while (!seenLastPage && (maxPages === undefined || currentPage <= maxPages)) {
      const pageBuilder: unknown[] = [
        ...(withRelations.length > 0 ? [{ with: withRelations }] : []),
        { paginate: { page: currentPage, per_page: perPage } },
        ...extraBuilder,
      ];

      const query: Record<string, string | number | boolean | undefined> = {
        page: currentPage,
        per_page: perPage,
      };

      const resp = await this.request<any>(path, {
        method: method ?? 'GET',
        ...(body !== undefined ? { body } : {}),
        signal,
        query,
        builder: pageBuilder,
        builderParamsStyle,
      });

      responses.push(resp);

      let pageItems: T[] = [];
      let pageMeta: any = {};
      if (Array.isArray(resp)) {
        pageItems = resp as T[];
      } else if (resp && typeof resp === 'object') {
        const rAny = resp as Record<string, unknown>;
        if (Array.isArray(rAny.data)) pageItems = rAny.data as T[];
        else if (Array.isArray(rAny.items)) pageItems = rAny.items as T[];
        else if (Array.isArray(rAny.rows)) pageItems = rAny.rows as T[];
        else if (Array.isArray(rAny.result)) pageItems = rAny.result as T[];
        pageMeta = (rAny.meta ?? rAny.pagination ?? rAny._meta ?? {}) as any;
      }

      items.push(...pageItems);
      const metaTotal = pageMeta?.total ?? pageMeta?.count ?? pageMeta?.total_items;
      if (typeof metaTotal === 'number') totalExpected = metaTotal;

      const lastPage = pageMeta?.last_page ?? pageMeta?.lastPage ?? pageMeta?.total_pages;
      const current = pageMeta?.current_page ?? pageMeta?.currentPage ?? currentPage;
      const totalVal = typeof metaTotal === 'number' ? metaTotal : undefined;

      if (pageItems.length === 0) {
        seenLastPage = true;
      } else if (typeof lastPage === 'number' && typeof current === 'number') {
        if (current >= lastPage) seenLastPage = true;
      } else if (typeof totalVal === 'number' && items.length >= totalVal) {
        seenLastPage = true;
      } else if (pageItems.length < perPage) {
        seenLastPage = true;
      }
      currentPage++;
    }

    return {
      items,
      totalFetched: items.length,
      totalExpected,
      pagesProcessed: currentPage - 1,
      responses,
    };
  }
}

export interface CredentialInfo {
  configured: boolean;
  source: "db" | "env" | "none";
  subdomainSet: boolean;
  apiKeySet: boolean;
  subdomainPrefix?: string;
}

class InserveClientSingleton {
  private instance: InserveClient | undefined;
  private cacheLoadedAt: number = 0;
  private initPromise: Promise<InserveClient | undefined> | undefined;
  private lastCredentialInfo: CredentialInfo | undefined;

  async inspectCredentials(force = false): Promise<CredentialInfo> {
    try {
      if (force) this.reset();
      const creds = await resolveInserveCredentials();
      if (!creds) {
        const info: CredentialInfo = {
          configured: false,
          source: "none",
          subdomainSet: false,
          apiKeySet: false,
        };
        this.lastCredentialInfo = info;
        return info;
      }
      const info: CredentialInfo = {
        configured: true,
        source: creds.source,
        subdomainSet: true,
        apiKeySet: true,
        subdomainPrefix: creds.subdomain.length >= 3
          ? creds.subdomain.slice(0, 3) + "…"
          : creds.subdomain,
      };
      this.lastCredentialInfo = info;
      return info;
    } catch (e: any) {
      const info: CredentialInfo = {
        configured: false,
        source: "none",
        subdomainSet: false,
        apiKeySet: false,
      };
      this.lastCredentialInfo = info;
      return info;
    }
  }

  getLastCredentialInfo(): CredentialInfo | undefined {
    return this.lastCredentialInfo;
  }

  private async init(): Promise<InserveClient | undefined> {
    const now = Date.now();
    if (this.instance && now - this.cacheLoadedAt < CLIENT_CACHE_TTL_MS) {
      return this.instance;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const creds = await resolveInserveCredentials();
        if (creds) {
          this.instance = new InserveClient(creds.subdomain, creds.apiKey);
        } else {
          this.instance = undefined;
        }
      } catch {
        this.instance = undefined;
      } finally {
        this.cacheLoadedAt = Date.now();
        this.initPromise = undefined;
      }
      return this.instance;
    })();

    return this.initPromise;
  }

  async getClient(): Promise<InserveClient | undefined> {
    return this.init();
  }

  async isConfigured(): Promise<boolean> {
    return (await this.init()) !== undefined;
  }

  setClient(client: InserveClient | undefined): void {
    this.instance = client;
    this.cacheLoadedAt = Date.now();
    this.initPromise = undefined;
  }

  reset(): void {
    this.instance = undefined;
    this.cacheLoadedAt = 0;
    this.initPromise = undefined;
  }

  async testConnection(): Promise<{
    ok: boolean;
    status?: number;
    latencyMs?: number;
    error?: string;
    endpoint?: string;
  }> {
    const client = await this.init();
    if (!client) {
      return { ok: false, error: "Inserve niet geconfigureerd (geen credentials in DB of env)" };
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), 8000);
      try {
        await client.request(
          "auth/me",
          { method: "GET", signal: controller.signal }
        );
        const elapsed = Date.now() - started;
        return { ok: true, status: 200, latencyMs: elapsed, endpoint: "GET /auth/me" };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      const elapsed = Date.now() - started;
      const msg = e?.message ?? "Onbekende fout";
      const status = e?.statusCode ?? 500;
      return { ok: false, status, latencyMs: elapsed, error: msg };
    }
  }
}

export const inserveClient = new InserveClientSingleton();
