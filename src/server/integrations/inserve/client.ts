export interface InserveRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  builder?: unknown[];
  signal?: AbortSignal;
}

export class InserveApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;
  public readonly url: string;

  constructor(statusCode: number, responseBody: unknown, url: string, message?: string) {
    super(message ?? `Inserve API request failed with status ${statusCode} for ${url}`);
    this.name = 'InserveApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.url = url;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_WAIT_MS = 1000;
const CLIENT_CACHE_TTL_MS = 60_000;

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

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
  builder?: unknown[]
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
    params.append('query', JSON.stringify(builder));
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

  async request<T = unknown>(path: string, options: InserveRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, builder, signal } = options;

    const url = buildUrl(this.baseUrl, path, query, builder);

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

        if (attempt < maxAttempts && (is429 || (is5xx && isGet))) {
          let waitMs = DEFAULT_RETRY_WAIT_MS;
          if (is429) {
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!isNaN(seconds)) {
                waitMs = seconds * 1000;
              }
            }
          }
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
}

class InserveClientSingleton {
  private instance: InserveClient | undefined;
  private cacheLoadedAt: number = 0;
  private initPromise: Promise<InserveClient | undefined> | undefined;

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
