import type { NavixyAuthMode, NavixyCreateMethod, NavixyCredentials, NavixyResponse } from './types';

export interface NavixyRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  authBypass?: boolean;
}

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_WAIT_MS = 1500;
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envStr(name: string): string {
  return typeof process !== 'undefined' ? (process.env[name] ?? '').trim() : '';
}

function envNum(name: string): number | null {
  const s = envStr(name);
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export function buildNavixyCredentials(): NavixyCredentials | null {
  const baseUrl = envStr('NAVIXY_BASE_URL') || 'https://api.eu.navixy.com/v2';
  const modeRaw = envStr('NAVIXY_AUTH_MODE').toLowerCase() || 'panel';
  let authMode: NavixyAuthMode = 'panel';
  if (modeRaw === 'user') authMode = 'user';
  else if (modeRaw === 'direct') authMode = 'direct';

  const panelLogin = envStr('NAVIXY_PANEL_LOGIN') || null;
  const panelPassword = envStr('NAVIXY_PANEL_PASSWORD') || null;
  const userLogin = envStr('NAVIXY_USER_LOGIN') || null;
  const userPassword = envStr('NAVIXY_USER_PASSWORD') || null;
  const directHash = envStr('NAVIXY_SESSION_HASH') || null;

  if (authMode === 'panel' && (!panelLogin || !panelPassword) && !directHash) {
    authMode = 'direct';
  }
  if (authMode === 'user' && (!userLogin || !userPassword) && !directHash) {
    authMode = 'direct';
  }
  const configuredDirect = authMode === 'direct' && !!directHash;
  const configuredPanel = authMode === 'panel' && !!panelLogin && !!panelPassword;
  const configuredUser = authMode === 'user' && !!userLogin && !!userPassword;
  if (!configuredDirect && !configuredPanel && !configuredUser) {
    return null;
  }

  const methodRaw = envStr('NAVIXY_CREATE_METHOD').toLowerCase() || 'create';
  let createMethod: NavixyCreateMethod = 'create';
  if (methodRaw === 'clone') createMethod = 'clone';
  else if (methodRaw === 'register') createMethod = 'register';

  return {
    baseUrl,
    authMode,
    panelLogin,
    panelPassword,
    userLogin,
    userPassword,
    directHash,
    defaultUserId: envNum('NAVIXY_DEFAULT_USER_ID'),
    defaultTariffId: envNum('NAVIXY_DEFAULT_TARIFF_ID'),
    defaultCloneSourceTrackerId: envNum('NAVIXY_DEFAULT_CLONE_SOURCE_TRACKER_ID'),
    createMethod,
    endpoints: {
      panelAuth: envStr('NAVIXY_ENDPOINT_PANEL_AUTH') || '/panel/account/auth',
      userAuth: envStr('NAVIXY_ENDPOINT_USER_AUTH') || '/user/session/auth',
      panelTracker: envStr('NAVIXY_ENDPOINT_PANEL_TRACKER') || '/panel/tracker',
      userTracker: envStr('NAVIXY_ENDPOINT_USER_TRACKER') || '/user/tracker',
    },
    source: 'env',
  };
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
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
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

export class NavixyApiError extends Error {
  public readonly statusCode: number;
  public readonly navixyCode?: number;
  public readonly navixyErrors?: unknown[] | null;
  public readonly responseBody: unknown;
  public readonly url: string;

  constructor(
    statusCode: number,
    responseBody: unknown,
    url: string,
    message?: string,
    navixyCode?: number,
    navixyErrors?: unknown[] | null,
  ) {
    const detail = navixyCode !== undefined ? ` (Navixy code ${navixyCode})` : '';
    super(message ?? `Navixy API request failed with status ${statusCode}${detail} for ${url}`);
    this.name = 'NavixyApiError';
    this.statusCode = statusCode;
    this.navixyCode = navixyCode;
    this.navixyErrors = navixyErrors ?? null;
    this.responseBody = responseBody;
    this.url = url;
  }
}

export class NavixyClient {
  private readonly creds: NavixyCredentials;
  private sessionHash?: string;
  private sessionLoadedAt = 0;

  constructor(creds: NavixyCredentials) {
    this.creds = creds;
  }

  async request<T = unknown>(path: string, options: NavixyRequestOptions = {}): Promise<NavixyResponse<T>> {
    const { method = 'POST', body, query, signal, authBypass } = options;

    const url = buildUrl(this.creds.baseUrl, path, query);
    const timeoutSignal = makeTimeoutSignal(REQUEST_TIMEOUT_MS);
    const combinedSignal = signal ? combineSignals(signal, timeoutSignal) : timeoutSignal;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (!authBypass) {
      const hash = await this.ensureSessionHash();
      if (hash) headers['Authorization'] = `NVX ${hash}`;
    }

    const init: RequestInit = { method, headers, signal: combinedSignal };
    if (body !== undefined) init.body = JSON.stringify(body);

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
          const resp = responseBody as NavixyResponse<T>;
          if (resp && typeof resp === 'object' && 'success' in resp && !resp.success) {
            const errEnv = resp as any;
            const nCode = typeof errEnv.status?.code === 'number' ? errEnv.status.code : undefined;
            const nDesc = typeof errEnv.status?.description === 'string' ? errEnv.status.description : undefined;
            const nErrors = Array.isArray(errEnv.errors) ? errEnv.errors : null;
            if (nCode === 4 || nCode === 111) {
              if (!authBypass && attempt < maxAttempts) {
                console.warn(`[Navixy] Session expired (code ${nCode}) — re-authenticating`);
                this.invalidateSession();
                attempt--;
                continue;
              }
            }
            throw new NavixyApiError(
              response.status,
              responseBody,
              url,
              nDesc ? `[Navixy] ${nDesc}` : undefined,
              nCode,
              nErrors,
            );
          }
          return resp as NavixyResponse<T>;
        }

        const is401 = response.status === 401;
        if (is401 && !authBypass && attempt < maxAttempts) {
          console.warn('[Navixy] 401 — re-authenticating and retrying');
          this.invalidateSession();
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
          console.error(`[Navixy] Retry ${method} ${path} after ${response.status} (attempt ${attempt}, wait ${waitMs}ms)`);
          await sleep(waitMs);
          continue;
        }
        console.error(`[Navixy] Request failed: ${method} ${url} → HTTP ${response.status}`);
        throw new NavixyApiError(response.status, responseBody, url);
      } catch (err) {
        if (err instanceof NavixyApiError) throw err;
        console.error(`[Navixy] Request error ${method} ${url}:`, err instanceof Error ? err.message : err);
        throw err;
      }
    }
    throw new Error(`[Navixy] Unexpected end of retry loop for ${method} ${url}`);
  }

  private invalidateSession(): void {
    if (this.creds.authMode !== 'direct') {
      this.sessionHash = undefined;
      this.sessionLoadedAt = 0;
    }
  }

  private async ensureSessionHash(): Promise<string | undefined> {
    if (this.creds.authMode === 'direct') {
      return this.creds.directHash ?? undefined;
    }
    const now = Date.now();
    if (this.sessionHash && now - this.sessionLoadedAt < AUTH_CACHE_TTL_MS) {
      return this.sessionHash;
    }
    let endpoint: string;
    let payload: Record<string, unknown>;
    if (this.creds.authMode === 'panel') {
      endpoint = this.creds.endpoints.panelAuth;
      payload = { login: this.creds.panelLogin, password: this.creds.panelPassword };
    } else {
      endpoint = this.creds.endpoints.userAuth;
      payload = { login: this.creds.userLogin, password: this.creds.userPassword };
    }
    try {
      const resp = await this.request<any>(endpoint, {
        method: 'POST',
        body: payload,
        authBypass: true,
      });
      if (resp?.success === true && typeof resp.hash === 'string' && resp.hash.length > 0) {
        this.sessionHash = resp.hash;
        this.sessionLoadedAt = now;
        return this.sessionHash;
      }
      console.warn('[Navixy] Auth call succeeded but hash missing in response');
    } catch (err) {
      console.error(`[Navixy] ${this.creds.authMode} auth failed:`, err instanceof Error ? err.message : err);
    }
    return undefined;
  }

  get endpoints() {
    return this.creds.endpoints;
  }
  get authMode(): NavixyAuthMode {
    return this.creds.authMode;
  }
  get createMethod(): NavixyCreateMethod {
    return this.creds.createMethod;
  }
  get defaultUserId(): number | null | undefined {
    return this.creds.defaultUserId;
  }
  get defaultTariffId(): number | null | undefined {
    return this.creds.defaultTariffId;
  }
  get defaultCloneSourceTrackerId(): number | null | undefined {
    return this.creds.defaultCloneSourceTrackerId;
  }
}

const CLIENT_CACHE_TTL_MS = 60_000;
class NavixyClientSingleton {
  private instance: NavixyClient | undefined;
  private cacheLoadedAt = 0;
  private initPromise: Promise<NavixyClient | undefined> | undefined;

  private async init(): Promise<NavixyClient | undefined> {
    const now = Date.now();
    if (this.instance && now - this.cacheLoadedAt < CLIENT_CACHE_TTL_MS) {
      return this.instance;
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        const creds = buildNavixyCredentials();
        this.instance = creds ? new NavixyClient(creds) : undefined;
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

  async getClient(): Promise<NavixyClient | undefined> {
    return this.init();
  }

  async isConfigured(): Promise<boolean> {
    return (await this.init()) !== undefined;
  }

  setClient(client: NavixyClient | undefined): void {
    this.instance = client;
    this.cacheLoadedAt = Date.now();
    this.initPromise = undefined;
  }

  reset(): void {
    this.instance = undefined;
    this.cacheLoadedAt = 0;
    this.initPromise = undefined;
  }
}

export const navixyClient = new NavixyClientSingleton();
