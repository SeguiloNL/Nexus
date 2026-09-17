import type {
  ActivateSimOptions,
  SimhuisApiResponse,
  SimhuisCredentials,
  SimhuisLoginResponse,
  SimhuisSimStatus,
} from './types';

export interface SimhuisRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  json?: boolean;
  signal?: AbortSignal;
  authBypass?: boolean;
}

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_WAIT_MS = 1500;
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envStr(name: string): string {
  return typeof process !== 'undefined' ? (process.env[name] ?? '').trim() : '';
}

export function buildSimhuisCredentialsEnvOnly(): SimhuisCredentials | null {
  const baseUrl = envStr('SIMHUIS_BASE_URL') || 'https://apicontrolcenter.com/v3';
  const authMode = (envStr('SIMHUIS_AUTH_MODE').toLowerCase() || 'basic') === 'bearer' ? 'bearer' : 'basic';
  const username = envStr('SIMHUIS_USERNAME');
  const password = envStr('SIMHUIS_PASSWORD');
  if (!username || !password) {
    return null;
  }
  const resellerId = envStr('SIMHUIS_RESELLER_ID') || null;
  return {
    baseUrl,
    authMode,
    username,
    password,
    resellerId,
    endpoints: {
      login: envStr('SIMHUIS_ENDPOINT_LOGIN') || '/auth/login',
      sims: envStr('SIMHUIS_ENDPOINT_SIMS') || '/sims',
      simActivate: envStr('SIMHUIS_ENDPOINT_SIM_ACTIVATE') || '/activate',
      simDeactivate: envStr('SIMHUIS_ENDPOINT_SIM_DEACTIVATE') || '/deactivate',
    },
    source: 'env',
  };
}

const SIMHUIS_KEYS = {
  baseUrl: 'simhuis.baseUrl',
  authMode: 'simhuis.authMode',
  username: 'simhuis.username',
  password: 'simhuis.password',
  resellerId: 'simhuis.resellerId',
  endpointLogin: 'simhuis.endpoint.login',
  endpointSims: 'simhuis.endpoint.sims',
  endpointSimActivate: 'simhuis.endpoint.simActivate',
  endpointSimDeactivate: 'simhuis.endpoint.simDeactivate',
} as const;

async function resolveSimhuisCredentials(): Promise<SimhuisCredentials | null> {
  try {
    const { prisma } = await import('@/lib/prisma');
    const keys = Object.values(SIMHUIS_KEYS);
    const rows = await Promise.all(
      keys.map((k) => prisma.appSetting.findUnique({ where: { key: k } }).catch(() => null))
    );
    const map: Record<string, string | undefined> = {};
    keys.forEach((k, i) => {
      map[k] = rows[i]?.value?.trim();
    });

    const baseUrl = map[SIMHUIS_KEYS.baseUrl];
    const username = map[SIMHUIS_KEYS.username];
    const password = map[SIMHUIS_KEYS.password];
    if (baseUrl && username && password) {
      const authMode: 'basic' | 'bearer' =
        map[SIMHUIS_KEYS.authMode]?.toLowerCase() === 'bearer' ? 'bearer' : 'basic';
      return {
        baseUrl,
        authMode,
        username,
        password,
        resellerId: map[SIMHUIS_KEYS.resellerId] || null,
        endpoints: {
          login: map[SIMHUIS_KEYS.endpointLogin] || '/auth/login',
          sims: map[SIMHUIS_KEYS.endpointSims] || '/sims',
          simActivate: map[SIMHUIS_KEYS.endpointSimActivate] || '/activate',
          simDeactivate: map[SIMHUIS_KEYS.endpointSimDeactivate] || '/deactivate',
        },
        source: 'db',
      };
    }
  } catch {
    // fall through to env
  }
  return buildSimhuisCredentialsEnvOnly();
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  let url = baseUrl.endsWith('/') ? `${baseUrl}${cleanPath}` : `${baseUrl}/${cleanPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    }
    const search = params.toString();
    if (search) url += `?${search}`;
  }
  return url;
}

function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const c = new AbortController();
  const onAbort = () => c.abort();
  if (s1.aborted) c.abort();
  else s1.addEventListener('abort', onAbort, { once: true });
  if (s2.aborted) c.abort();
  else s2.addEventListener('abort', onAbort, { once: true });
  return c.signal;
}

function makeTimeoutSignal(ms: number): AbortSignal {
  if (typeof (AbortSignal as any).timeout === 'function') {
    return (AbortSignal as any).timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(new Error('Request timed out')), ms);
  return c.signal;
}

export class SimhuisApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;
  public readonly url: string;

  constructor(statusCode: number, responseBody: unknown, url: string, message?: string) {
    super(message ?? `Simhuis API request failed with status ${statusCode} for ${url}`);
    this.name = 'SimhuisApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
  }
}

export class SimhuisClient {
  private readonly creds: SimhuisCredentials;
  private bearerToken?: string;
  private bearerLoadedAt = 0;

  constructor(creds: SimhuisCredentials) {
    this.creds = creds;
  }

  async request<T = unknown>(path: string, options: SimhuisRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, json = true, signal, authBypass } = options;

    const url = buildUrl(this.creds.baseUrl, path, query);
    const timeoutSignal = makeTimeoutSignal(REQUEST_TIMEOUT_MS);
    const combinedSignal = signal ? combineSignals(signal, timeoutSignal) : timeoutSignal;

    const headers: Record<string, string> = {
      'Accept': json ? 'application/json' : '*/*',
    };

    if (!authBypass) {
      const authHeader = await this.getAuthHeader();
      if (authHeader) headers['Authorization'] = authHeader;
    }

    if (body !== undefined) {
      if (json) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const init: RequestInit = { method, headers, signal: combinedSignal };
    if (body !== undefined) {
      init.body = json ? JSON.stringify(body) : (body as BodyInit);
    }

    let attempt = 0;
    const maxAttempts = 2;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        const response = await fetch(url, init);
        const contentType = response.headers.get('content-type') ?? '';
        let responseBody: unknown = null;
        try {
          if (contentType.includes('application/json')) responseBody = await response.json();
          else responseBody = await response.text();
        } catch { responseBody = null; }

        if (response.ok) {
          return responseBody as T;
        }

        const is401 = response.status === 401;
        if (is401 && this.creds.authMode === 'bearer' && !authBypass && attempt < maxAttempts) {
          console.warn('[Simhuis] Bearer token expired — re-authenticating and retrying');
          this.invalidateBearer();
          attempt--;
          continue;
        }

        const is429 = response.status === 429;
        const is5xx = response.status >= 500 && response.status < 600;
        const isGet = method === 'GET';
        if (attempt < maxAttempts && (is429 || (is5xx && isGet))) {
          let waitMs = DEFAULT_RETRY_WAIT_MS;
          if (is429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!isNaN(seconds)) waitMs = seconds * 1000;
            }
          }
          console.error(`[Simhuis] Retry ${method} ${path} na ${response.status} (attempt ${attempt}, wait ${waitMs}ms)`);
          await sleep(waitMs);
          continue;
        }

        console.error(`[Simhuis] Request failed: ${method} ${url} → ${response.status}`);
        throw new SimhuisApiError(response.status, responseBody, url);
      } catch (err) {
        if (err instanceof SimhuisApiError) throw err;
        console.error(`[Simhuis] Request error ${method} ${url}:`, err instanceof Error ? err.message : err);
        throw err;
      }
    }
    throw new Error(`[Simhuis] Unexpected end of retry loop for ${method} ${url}`);
  }

  private async getAuthHeader(): Promise<string | null> {
    if (this.creds.authMode === 'basic') {
      const combo = `${this.creds.username}:${this.creds.password}`;
      const encoded = typeof Buffer !== 'undefined'
        ? Buffer.from(combo).toString('base64')
        : btoa(combo);
      return `Basic ${encoded}`;
    }
    const token = await this.ensureBearerToken();
    return token ? `Bearer ${token}` : null;
  }

  private invalidateBearer(): void {
    this.bearerToken = undefined;
    this.bearerLoadedAt = 0;
  }

  private async ensureBearerToken(): Promise<string | undefined> {
    const now = Date.now();
    if (this.bearerToken && now - this.bearerLoadedAt < AUTH_CACHE_TTL_MS) {
      return this.bearerToken;
    }
    try {
      const payload = {
        username: this.creds.username,
        password: this.creds.password,
      };
      const resp = await this.request<SimhuisLoginResponse>(this.creds.endpoints.login, {
        method: 'POST',
        body: payload,
        authBypass: true,
      });
      const token = resp?.access_token ?? resp?.token;
      if (typeof token === 'string' && token.length > 0) {
        this.bearerToken = token;
        this.bearerLoadedAt = now;
        return this.bearerToken;
      }
      console.warn('[Simhuis] Bearer auth login call succeeded but no token returned');
    } catch (err) {
      console.error('[Simhuis] Bearer auth login failed:', err instanceof Error ? err.message : err);
    }
    return undefined;
  }

  get endpoints() {
    return this.creds.endpoints;
  }
  get resellerId(): string | null | undefined {
    return this.creds.resellerId;
  }
}

const CLIENT_CACHE_TTL_MS = 60_000;
class SimhuisClientSingleton {
  private instance: SimhuisClient | undefined;
  private cacheLoadedAt = 0;
  private initPromise: Promise<SimhuisClient | undefined> | undefined;

  private async init(): Promise<SimhuisClient | undefined> {
    const now = Date.now();
    if (this.instance && now - this.cacheLoadedAt < CLIENT_CACHE_TTL_MS) {
      return this.instance;
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const creds = await resolveSimhuisCredentials();
        this.instance = creds ? new SimhuisClient(creds) : undefined;
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

  async getClient(): Promise<SimhuisClient | undefined> {
    return this.init();
  }

  async isConfigured(): Promise<boolean> {
    return (await this.init()) !== undefined;
  }

  setClient(client: SimhuisClient | undefined): void {
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
      return { ok: false, error: "Simhuis niet geconfigureerd (geen credentials in DB of env)" };
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("timeout")), 8000);
      try {
        const anyClient = client as any;
        const endpoint = (client as any).creds?.endpoints?.login ?? "/auth/login";
        const response = await anyClient.request(
          endpoint,
          { method: "GET", signal: controller.signal, authBypass: true }
        );
        const elapsed = Date.now() - started;
        return { ok: true, status: 200, latencyMs: elapsed, endpoint: `GET ${endpoint}` };
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

export const simhuisClient = new SimhuisClientSingleton();
