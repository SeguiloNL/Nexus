import {
  inserveClient,
  InserveClient,
  InserveApiError,
  InserveRateLimitExceededError,
  isInserveRateLimitError,
} from './client';
import type {
  InserveCompany,
  InserveArticle,
  InserveContract,
  InserveInvoice,
  CreateCompanyRequest,
  UpdateCompanyRequest,
  CreateArticleRequest,
  CreateContractRequest,
  CreateInvoiceRequest,
  CancelContractRequest,
  InserveContractCycle,
  InserveListResponse,
  InserveCustomFieldValue,
  InserveContact,
  InserveAsset,
} from './types';

export const INSERVE_COMPANY_ENDPOINT = 'companies';
export const INSERVE_CLIENT_ENDPOINT = 'clients';
export const INSERVE_ASSET_ENDPOINT_CANDIDATES: ReadonlyArray<string> = [
  // Meest waarschijnlijk eerst
  'assets',
  'simcards',
  'sim-cards',
  'simkaarten',
  'assets/simcards',
  // Product- / relationele endpoints
  'product-assets',
  'productassets',
  'articles',
  'products',
  'relations',
  'cards',
  'asset-cards',
  'assets-cards',
  'assetcards',
  'asset',
  // Sub-paden (per-company subresources)
  'company/assets',
  'companies/assets',
  'tenant/assets',
  'simcards/company',
];

export interface ListAssetsOptions {
  page?: number;
  perPage?: number;
  withRelations?: string[];
  builder?: unknown[];
  builderParamsStyle?: 'json' | 'nested';
  extraQueryParams?: Record<string, string | number | boolean | undefined>;
}

export interface ListClientsOptions {
  page?: number;
  perPage?: number;
  withRelations?: string[];
  builder?: unknown[];
  builderParamsStyle?: 'json' | 'nested';
  extraQueryParams?: Record<string, string | number | boolean | undefined>;
}

export function getContactCompanyIds(c: InserveContact): number[] {
  const ids: number[] = [];
  const direct =
    c.company_id ??
    c.companyId ??
    (c as any).company?.id ??
    (c as any).company?.company_id ??
    null;
  if (typeof direct === 'number' && Number.isFinite(direct) && Number.isInteger(direct)) {
    ids.push(direct);
  } else if (typeof direct === 'string') {
    const n = Number(direct);
    if (Number.isFinite(n) && Number.isInteger(n)) ids.push(n);
  }
  if (Array.isArray(c.companies)) {
    for (const co of c.companies) {
      if (typeof co === 'number' && Number.isFinite(co) && Number.isInteger(co)) {
        ids.push(co);
      } else if (typeof co === 'string') {
        const n = Number(co);
        if (Number.isFinite(n) && Number.isInteger(n)) ids.push(n);
      } else if (co && typeof co === 'object') {
        const anyCo = co as Record<string, unknown>;
        const candidate = anyCo.id ?? anyCo.company_id ?? anyCo.companyId;
        if (typeof candidate === 'number' && Number.isFinite(candidate) && Number.isInteger(candidate)) {
          ids.push(candidate);
        } else if (typeof candidate === 'string') {
          const n = Number(candidate);
          if (Number.isFinite(n) && Number.isInteger(n)) ids.push(n);
        }
      }
    }
  }
  return Array.from(new Set(ids));
}

export function groupContactsByCompanyId(contacts: InserveContact[]): Record<number, InserveContact[]> {
  const map: Record<number, InserveContact[]> = {};
  for (const c of contacts) {
    const companyIds = getContactCompanyIds(c);
    if (companyIds.length === 0) continue;
    for (const cid of companyIds) {
      if (!map[cid]) map[cid] = [];
      map[cid].push(c);
    }
  }
  return map;
}

export function resolveContactName(c: InserveContact): {
  firstName: string | null;
  lastName: string | null;
} {
  let firstName =
    c.firstName ??
    c.first_name ??
    null;
  let lastName =
    c.lastName ??
    c.last_name ??
    null;
  if (!firstName && !lastName) {
    const full = c.fullName ?? c.full_name ?? c.name ?? null;
    if (full) {
      const parts = full.trim().split(/\s+/);
      if (parts.length >= 2) {
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      } else if (parts.length === 1) {
        lastName = parts[0];
      }
    }
  }
  return {
    firstName: firstName && firstName.trim().length > 0 ? firstName.trim() : null,
    lastName: lastName && lastName.trim().length > 0 ? lastName.trim() : null,
  };
}

export function resolveContactEmail(c: InserveContact): string | null {
  const v = c.email ?? c.email_address ?? c.emailAddress ?? (c as any).mail ?? null;
  return v && typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export function resolveContactPhoneLandline(c: InserveContact): string | null {
  const v =
    c.telephone ??
    c.phone ??
    c.landline ??
    (c as any).telephone_landline ??
    (c as any).land_line ??
    null;
  return v && typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export function resolveContactPhoneMobile(c: InserveContact): string | null {
  const v =
    c.telephoneCell ??
    c.telephone_cell ??
    c.mobile ??
    c.cellphone ??
    (c as any).mobile_phone ??
    (c as any).cell ??
    null;
  return v && typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export function resolveContactFunction(c: InserveContact): string | null {
  const v =
    c.function ??
    c.functionTitle ??
    c.function_title ??
    c.title ??
    c.position ??
    (c as any).job ??
    (c as any).job_title ??
    null;
  return v && typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

import { enrichCompanyWithCustomFields } from '@/server/services/inserve-customer-import.service';

function toISOString(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;
  if (date instanceof Date) return date.toISOString();
  return date;
}

function mapBillingCycle(cycle: string): InserveContractCycle | undefined {
  const map: Record<string, InserveContractCycle> = {
    MONTHLY: 'monthly',
    QUARTERLY: 'quarterly',
    YEARLY: 'yearly',
    monthly: 'monthly',
    quarterly: 'quarterly',
    yearly: 'yearly',
  };
  return map[cycle];
}

export interface UpsertCompanyCustomerInput {
  id: string | number;
  customerNumber?: string | null;
  companyName: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  kvkNr?: string | null;
  btwNr?: string | null;
  inserveCompanyId?: number | null;
}

export interface UpsertCompanyResult {
  id: number;
  debtorCode?: string | null;
}

export async function upsertCompany(customer: UpsertCompanyCustomerInput): Promise<UpsertCompanyResult> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Inserve client is not configured. Set INSERVE_SUBDOMAIN and INSERVE_API_KEY or configure via Instellingen.');
  }

  const updatePayload: UpdateCompanyRequest = {
    name: customer.companyName,
    debtor_code: customer.customerNumber ?? undefined,
    address_1: customer.address ?? undefined,
    postal_code: customer.postalCode ?? undefined,
    city: customer.city ?? undefined,
    country: customer.country ?? undefined,
    telephone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    kvk_nr: customer.kvkNr ?? undefined,
    btw_nr: customer.btwNr ?? undefined,
  };

  const createPayload: CreateCompanyRequest = {
    name: customer.companyName,
    debtor_code: customer.customerNumber ?? undefined,
    address_1: customer.address ?? undefined,
    postal_code: customer.postalCode ?? undefined,
    city: customer.city ?? undefined,
    country: customer.country ?? undefined,
    telephone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    kvk_nr: customer.kvkNr ?? undefined,
    btw_nr: customer.btwNr ?? undefined,
  };

  if (customer.inserveCompanyId) {
    try {
      const existing = await client.request<InserveCompany>(`companies/${customer.inserveCompanyId}`, {
        method: 'GET',
      });
      if (existing) {
        const updated = await client.request<InserveCompany>(`companies/${customer.inserveCompanyId}`, {
          method: 'PUT',
          body: updatePayload,
        });
        return { id: updated.id, debtorCode: updated.debtor_code ?? null };
      }
    } catch (err) {
      if (err instanceof InserveApiError && err.statusCode !== 404) {
        throw err;
      }
    }
  }

  const findByKvk = async (): Promise<InserveCompany | null> => {
    if (!customer.kvkNr) return null;
    try {
      const resp = await client.request<InserveListResponse<InserveCompany>>('companies', {
        method: 'GET',
        builder: [
          { column: 'kvk_nr', operator: '=', value: customer.kvkNr },
        ],
      });
      const list = resp.data ?? [];
      if (list.length === 1) return list[0];
      if (list.length > 1) {
        const exact = list.find((c) => c.kvk_nr === customer.kvkNr);
        if (exact) return exact;
      }
      return null;
    } catch (err) {
      if (err instanceof InserveApiError) return null;
      throw err;
    }
  };

  const findByNamePostcode = async (): Promise<InserveCompany | null> => {
    if (!customer.companyName || !customer.postalCode) return null;
    try {
      const resp = await client.request<InserveListResponse<InserveCompany>>('companies', {
        method: 'GET',
        builder: [
          { column: 'name', operator: '=', value: customer.companyName },
          { column: 'postal_code', operator: '=', value: customer.postalCode },
        ],
      });
      const list = resp.data ?? [];
      if (list.length === 1) return list[0];
      return null;
    } catch (err) {
      if (err instanceof InserveApiError) return null;
      throw err;
    }
  };

  const byKvk = await findByKvk();
  if (byKvk) {
    const updated = await client.request<InserveCompany>(`companies/${byKvk.id}`, {
      method: 'PUT',
      body: updatePayload,
    });
    return { id: updated.id, debtorCode: updated.debtor_code ?? null };
  }

  const byNamePostcode = await findByNamePostcode();
  if (byNamePostcode) {
    const updated = await client.request<InserveCompany>(`companies/${byNamePostcode.id}`, {
      method: 'PUT',
      body: updatePayload,
    });
    return { id: updated.id, debtorCode: updated.debtor_code ?? null };
  }

  const created = await client.request<InserveCompany>('companies', {
    method: 'POST',
    body: createPayload,
  });
  return { id: created.id, debtorCode: created.debtor_code ?? null };
}

export interface EnsureArticleProductInput {
  id: string | number;
  productCode?: string | null;
  name: string;
  monthlyPrice: number | string;
  currency?: string | null;
  btwPercentage?: number | string | null;
  isActive: boolean;
  inserveArticleId?: number | null;
}

export async function ensureArticle(product: EnsureArticleProductInput): Promise<number> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Inserve client is not configured. Set INSERVE_SUBDOMAIN and INSERVE_API_KEY or configure via Instellingen.');
  }

  if (product.inserveArticleId) {
    return product.inserveArticleId;
  }

  if (product.productCode) {
    try {
      const resp = await client.request<InserveListResponse<InserveArticle>>('articles', {
        method: 'GET',
        builder: [
          { column: 'code', operator: '=', value: product.productCode },
        ],
      });
      const list = resp.data ?? [];
      const match = list.find((a) => a.code === product.productCode) ?? list[0];
      if (match) {
        return match.id;
      }
    } catch (err) {
      if (!(err instanceof InserveApiError)) {
        throw err;
      }
    }
  }

  const createPayload: CreateArticleRequest = {
    name: product.name,
    code: product.productCode ?? undefined,
    price_excl: Number(product.monthlyPrice),
    btw_percentage: Number(product.btwPercentage ?? 21),
    unit: 'month',
    is_active: product.isActive,
  };

  const created = await client.request<InserveArticle>('articles', {
    method: 'POST',
    body: createPayload,
  });
  return created.id;
}

export interface CreateSubscriptionContractParams {
  companyId: number;
  articleId: number;
  startDate: Date | string;
  endDate?: Date | string | null;
  monthlyPrice: number | string | { toNumber?: () => number } | any;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | string;
  reference: string;
  description?: string;
}

function toNumberPrice(price: any): number {
  if (price === null || price === undefined) return 0;
  if (typeof price === 'number') return price;
  if (typeof price === 'string') return Number(price);
  if (typeof price.toNumber === 'function') return Number(price.toNumber());
  return Number(price);
}

async function postContract(
  client: InserveClient | undefined,
  payload: CreateContractRequest,
  endpoint: 'contracts' | 'subscriptions'
): Promise<InserveContract> {
  if (!client) throw new Error('Client missing');
  return await client.request<InserveContract>(endpoint, {
    method: 'POST',
    body: payload,
  });
}

export async function createSubscriptionContract(params: CreateSubscriptionContractParams): Promise<number> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Inserve client is not configured. Set INSERVE_SUBDOMAIN and INSERVE_API_KEY or configure via Instellingen.');
  }

  const payload: CreateContractRequest = {
    company_id: params.companyId,
    article_id: params.articleId,
    start_date: toISOString(params.startDate)!,
    end_date: toISOString(params.endDate),
    price: toNumberPrice(params.monthlyPrice),
    cycle: mapBillingCycle(params.billingCycle),
    quantity: 1,
    reference: params.reference,
    description: params.description,
  };

  try {
    const contract = await postContract(client, payload, 'contracts');
    return contract.id;
  } catch (err) {
    if (err instanceof InserveApiError && err.statusCode === 404) {
      const subscription = await postContract(client, payload, 'subscriptions');
      return subscription.id;
    }
    throw err;
  }
}

export interface CancelOrTerminateContractOpts {
  endDate?: Date | string | null;
  reason?: string;
}

async function putContractCancel(
  client: InserveClient | undefined,
  contractId: number,
  payload: CancelContractRequest,
  endpoint: 'contracts' | 'subscriptions'
): Promise<unknown> {
  if (!client) throw new Error('Client missing');
  return await client.request(`${endpoint}/${contractId}`, {
    method: 'PUT',
    body: payload,
  });
}

export async function cancelOrTerminateContract(
  contractId: number,
  opts: CancelOrTerminateContractOpts = {}
): Promise<void> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Inserve client is not configured. Set INSERVE_SUBDOMAIN and INSERVE_API_KEY or configure via Instellingen.');
  }

  const payload: CancelContractRequest = {};
  if (opts.endDate) {
    payload.end_date = toISOString(opts.endDate);
  }
  if (opts.reason) {
    payload.reason = opts.reason;
  }
  if (!opts.endDate) {
    payload.status = 'cancelled';
  }

  try {
    await putContractCancel(client, contractId, payload, 'contracts');
  } catch (err) {
    if (err instanceof InserveApiError && err.statusCode === 404) {
      try {
        await putContractCancel(client, contractId, payload, 'subscriptions');
      } catch (subErr) {
        if (subErr instanceof InserveApiError && subErr.statusCode === 404) {
          console.error(
            `[Inserve] Could not cancel contract ${contractId}: both /api/contracts and /api/subscriptions returned 404`
          );
          return;
        }
        throw subErr;
      }
      return;
    }
    throw err;
  }
}

// ============================================================================
// INVOICES
// Endpoint bevestigd via Postman docs (Laravel Resource CRUD patroon):
//   POST  /api/invoices       (store)   — draft factuur aanmaken
//   GET   /api/invoices       (index)   — overzicht opvragen
//   GET   /api/invoices/{id}  (show)    — enkele factuur
//   PUT   /api/invoices/{id}  (update)  — bijwerken
// ============================================================================

export const INSERVE_INVOICE_ENDPOINT = 'invoices';

export async function createInvoiceDraftInInserve(
  payload: CreateInvoiceRequest
): Promise<InserveInvoice> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured (INSERVE_SUBDOMAIN / INSERVE_API_KEY missing or configure via Instellingen).');
  }

  return (await client.request(INSERVE_INVOICE_ENDPOINT, {
    method: 'POST',
    body: payload,
  })) as InserveInvoice;
}

export async function updateInvoiceInInserve(
  invoiceId: number,
  payload: Partial<CreateInvoiceRequest>
): Promise<InserveInvoice> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured (INSERVE_SUBDOMAIN / INSERVE_API_KEY missing or configure via Instellingen).');
  }
  return (await client.request(`${INSERVE_INVOICE_ENDPOINT}/${invoiceId}`, {
    method: 'PUT',
    body: payload,
  })) as InserveInvoice;
}

export async function getInvoiceInInserve(
  invoiceId: number
): Promise<InserveInvoice> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  return (await client.request(`${INSERVE_INVOICE_ENDPOINT}/${invoiceId}`, {
    method: 'GET',
  })) as InserveInvoice;
}

export async function listInvoicesInInserve(
  query?: { company_id?: number; reference?: string; status?: string; page?: number; limit?: number; per_page?: number }
): Promise<InserveListResponse<InserveInvoice>> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const path = `${INSERVE_INVOICE_ENDPOINT}${qs.toString() ? `?${qs.toString()}` : ''}`;
  return (await client.request(path)) as InserveListResponse<InserveInvoice>;
}

// ============================================================================
// COMPANIES (Inserve → Nexus import)
// ============================================================================

export interface ListCompaniesOptions {
  page?: number;
  perPage?: number;
  withRelations?: string[];
  builder?: unknown[];
  builderParamsStyle?: 'json' | 'nested';
}

export async function listCompanies(
  opts: ListCompaniesOptions = {}
): Promise<InserveListResponse<InserveCompany>> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { page = 1, perPage = 25, withRelations = [], builder = [], builderParamsStyle } = opts;
  const fullBuilder: unknown[] = [
    ...(withRelations.length > 0 ? [{ with: withRelations }] : []),
    { paginate: { page, per_page: perPage } },
    ...builder,
  ];
  return (await client.request(INSERVE_COMPANY_ENDPOINT, {
    method: 'GET',
    builder: fullBuilder,
    ...(builderParamsStyle ? { builderParamsStyle } : {}),
  })) as InserveListResponse<InserveCompany>;
}

export async function listAllCompanies(
  opts: Omit<ListCompaniesOptions, 'page'> & { maxPages?: number } = {}
): Promise<{
  items: InserveCompany[];
  totalFetched: number;
  totalExpected: number;
  pagesProcessed: number;
  responses?: any[];
}> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { maxPages, perPage = 25, withRelations = [], builder = [], builderParamsStyle } = opts;

  const requestedRelations =
    withRelations.length > 0 ? withRelations : ['custom_fields', 'company_fields', 'extra_fields', 'fields'];

  type Strat = {
    label: string;
    withRelations: string[];
    enrichLater: boolean;
    useBuilder?: boolean;
    builderParamsStyle?: 'json' | 'nested';
    extraQueryParams?: Record<string, string | number | boolean | undefined>;
    perPage?: number;
    nestedBuilderIndexFromOne?: boolean;
    separateLimitPage?: boolean;
  };
  const strategies: Strat[] = [
    {
      label: '1-customValues-postman-flat-params',
      withRelations: [],
      enrichLater: false,
      useBuilder: false,
      perPage: 25,
      extraQueryParams: {
        // Exact Postman docs stijl: builder[1][with]=customValues ; builder[2][limit]=N ; builder[3][page]=P
        // Wordt in de lus per page ingevuld (pagina-P wordt dynamisch gezet).
        // We initialiseren hier de fixed delen (with + limit); page wordt in de loop per iteratie overschreven.
      },
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
    },
    {
      label: '1-customValues-nested-builder',
      withRelations: ['customValues'],
      enrichLater: false,
      builderParamsStyle: 'nested',
    },
    {
      label: '1-customValues-json-builder',
      withRelations: ['customValues'],
      enrichLater: false,
      builderParamsStyle: 'json',
    },
    {
      label: '1-customValues-with-query-zonder-builder',
      withRelations: [],
      enrichLater: false,
      useBuilder: false,
      extraQueryParams: { 'with[]': 'customValues' },
    },
    { label: 'kale-bedrijven', withRelations: [], enrichLater: true },
    { label: 'kale-bedrijven-zonder-builder', withRelations: [], enrichLater: true, useBuilder: false },
    { label: '1-relatie-custom_fields', withRelations: ['custom_fields'], enrichLater: true },
    { label: '1-relatie-customFields-camelcase', withRelations: ['customFields'], enrichLater: true },
    { label: '1-relatie-company_fields', withRelations: ['company_fields'], enrichLater: true },
    { label: '1-relatie-companyFields-camelcase', withRelations: ['companyFields'], enrichLater: true },
    { label: '1-relatie-fields', withRelations: ['fields'], enrichLater: true },
    { label: '1-relatie-free_fields', withRelations: ['free_fields'], enrichLater: true },
    { label: '1-relatie-freeFields-camelcase', withRelations: ['freeFields'], enrichLater: true },
    { label: '4-relaties-alles', withRelations: requestedRelations, enrichLater: false },
  ];

  const errors: Array<{ label: string; error: unknown }> = [];
  let customValuesSampleLogged = 0;

  for (const strat of strategies) {
    try {
      let result: Awaited<ReturnType<typeof client.requestAllPages<InserveCompany>>>;

      const pageQuery: Record<string, string | number | boolean | undefined> = {
        page: 1,
        per_page: perPage,
        ...(strat.extraQueryParams ?? {}),
      };

      if (strat.useBuilder === false) {
        const effectivePerPage = strat.perPage ?? perPage;
        const maxLoop = maxPages ?? 80;
        const allItems: InserveCompany[] = [];
        let totalExpected = 0;
        let pagesProcessed = 0;
        let firstDetailKeys: string[] | null = null;
        let emptyStreak = 0;
        let stratPageMetaLogged = false;
        for (let page = 1; page <= maxLoop; page++) {
          pageQuery.page = page;
          pageQuery.per_page = effectivePerPage;
          const customQuery: Record<string, string | number | boolean | undefined> = {
            ...pageQuery,
            ...(strat.extraQueryParams ?? {}),
          };
          if (strat.separateLimitPage && strat.nestedBuilderIndexFromOne) {
            customQuery['builder[1][with]'] = 'customValues';
            customQuery['builder[2][limit]'] = effectivePerPage;
            customQuery['builder[3][page]'] = page;
            delete customQuery['page'];
            delete customQuery['per_page'];
          }
          const chunk = (await client.request<any>(INSERVE_COMPANY_ENDPOINT, {
            method: 'GET',
            query: customQuery,
            builder: undefined,
          })) as any;

          pagesProcessed++;
          let pageItems: InserveCompany[] = [];
          let pageMeta: any = {};
          if (Array.isArray(chunk)) {
            pageItems = chunk as InserveCompany[];
          } else if (chunk && typeof chunk === 'object') {
            const rAny = chunk as Record<string, unknown>;
            if (Array.isArray(rAny.data)) pageItems = rAny.data as InserveCompany[];
            else if (Array.isArray(rAny.items)) pageItems = rAny.items as InserveCompany[];
            else if (Array.isArray(rAny.rows)) pageItems = rAny.rows as InserveCompany[];
            else if (Array.isArray(rAny.result)) pageItems = rAny.result as InserveCompany[];
            pageMeta = (rAny.meta ?? rAny.pagination ?? rAny._meta ?? rAny._pagination ?? {}) as any;
            if (typeof rAny.total === 'number' && totalExpected === 0) totalExpected = rAny.total as number;
            if (typeof (rAny as any).last_page === 'number' || typeof (rAny as any).lastPage === 'number') {
              pageMeta.last_page = (rAny as any).last_page ?? (rAny as any).lastPage;
            }
            if (page === 1 && !stratPageMetaLogged) {
              stratPageMetaLogged = true;
              try {
                const t = (rAny as any).total;
                const lp = (rAny as any).last_page ?? (rAny as any).lastPage;
                if (typeof t === 'number' && typeof lp === 'number') {
                  pageMeta.last_page = lp;
                  pageMeta.total = t;
                }
              } catch {
              }
            }
          }

          if (pageItems.length > 0) {
            allItems.push(...pageItems);
            emptyStreak = 0;
            if (!firstDetailKeys && pageItems[0] && typeof pageItems[0] === 'object') {
              firstDetailKeys = Object.keys(pageItems[0] as unknown as Record<string, unknown>);
            }
          } else {
            emptyStreak++;
          }

          const metaTotal = pageMeta?.total ?? pageMeta?.count ?? pageMeta?.total_items ?? pageMeta?.totalItems;
          if (typeof metaTotal === 'number') totalExpected = metaTotal;

          const lastPage = pageMeta?.last_page ?? pageMeta?.lastPage ?? pageMeta?.total_pages ?? pageMeta?.totalPages;
          if (emptyStreak >= 2) break;
          if (typeof lastPage === 'number' && page >= lastPage) break;
          if (typeof totalExpected === 'number' && totalExpected > 0 && allItems.length >= totalExpected) break;
          if (pageItems.length === 0 && emptyStreak >= 1 && allItems.length > 0) break;
        }

        if (firstDetailKeys && allItems.length > 0) {
          try {
            const hasCustomValuesKey =
              firstDetailKeys.includes('customValues') ||
              firstDetailKeys.includes('custom_values');
            if (hasCustomValuesKey) {
              let nexusSampleLogged = (globalThis as any).__nexusSampleLogged === true;
              if (!nexusSampleLogged) {
                for (const c of allItems) {
                  const cv: any[] = Array.isArray((c as any).customValues) ? (c as any).customValues : (c as any).custom_values;
                  if (!Array.isArray(cv)) continue;
                  for (const f of cv) {
                    if (fieldNameMatches(f, 'Nexus')) {
                      const { text, optionLabel, optionValue, fieldValueText } = resolveFieldTextValue(f);
                      const cfo = (f as any).custom_field_object;
                      console.info(
                        `[Inserve] Nexus-veld (slug nexus) correct gedetecteerd. Options[0..3] = ${JSON.stringify(Array.isArray(cfo?.options) ? cfo.options.slice(0, 3).map((o: any) => ({ label: o.label, name: o.name })) : [])}`
                      );
                      (globalThis as any).__nexusSampleLogged = true;
                      nexusSampleLogged = true;
                      break;
                    }
                  }
                  if (nexusSampleLogged) break;
                }
              }
            }
          } catch {
          }
        }

        result = {
          items: allItems,
          totalFetched: allItems.length,
          totalExpected,
          pagesProcessed,
          responses: [],
        };
      } else {
        result = await client.requestAllPages<InserveCompany>(INSERVE_COMPANY_ENDPOINT, {
          perPage,
          withRelations: strat.withRelations,
          extraBuilder: builder,
          maxPages,
          method: 'GET',
          builderParamsStyle: builderParamsStyle ?? strat.builderParamsStyle,
        });
        if (result.items.length > 0 && result.items[0] && typeof result.items[0] === 'object') {
          try {
            const keys = Object.keys(result.items[0] as unknown as Record<string, unknown>);
            const hasCustomValuesKey =
              keys.includes('customValues') || keys.includes('custom_values');
            if (hasCustomValuesKey) {
              let nexusSampleLogged = (globalThis as any).__nexusSampleLogged === true;
              if (!nexusSampleLogged) {
                for (const c of result.items) {
                  const cv: any[] = Array.isArray((c as any).customValues) ? (c as any).customValues : (c as any).custom_values;
                  if (!Array.isArray(cv)) continue;
                  for (const f of cv) {
                    if (fieldNameMatches(f, 'Nexus')) {
                      nexusSampleLogged = true;
                      (globalThis as any).__nexusSampleLogged = true;
                      break;
                    }
                  }
                  if (nexusSampleLogged) break;
                }
              }
            }
          } catch {
          }
        }
      }

      if (strat.enrichLater && result.items.length > 0) {
        const enriched: InserveCompany[] = [];
        let sampleIdx = 0;
        for (const item of result.items) {
          sampleIdx++;
          const hasFields =
            Array.isArray((item as any).customValues) ||
            Array.isArray((item as any).custom_values) ||
            Array.isArray((item as any).custom_fields) ||
            Array.isArray((item as any).customFields) ||
            Array.isArray((item as any).company_fields) ||
            Array.isArray((item as any).companyFields) ||
            Array.isArray((item as any).extra_fields) ||
            Array.isArray((item as any).fields) ||
            Array.isArray((item as any).free_fields) ||
            Array.isArray((item as any).freeFields);
          if (hasFields) {
            enriched.push(item);
            continue;
          }
          try {
            const full = await enrichCompanyWithCustomFields(item);
            enriched.push(full);
          } catch {
            enriched.push(item);
          }
        }
        result.items = enriched;
      }
      return {
        items: result.items,
        totalFetched: result.totalFetched,
        totalExpected: result.totalExpected,
        pagesProcessed: result.pagesProcessed,
      };
    } catch (e) {
      errors.push({ label: strat.label, error: e });
      const is5xx =
        (e instanceof InserveApiError && e.statusCode >= 500 && e.statusCode < 600) ||
        !!(e as any)?.statusCode?.toString?.().startsWith('5');
      if (!is5xx) break;
    }
  }

  const messages = errors
    .map(({ label, error }) => {
      const msg =
        error instanceof Error
          ? error.message.split('\n').slice(0, 2).join(' | ')
          : String(error);
      return `[${label}] ${msg.slice(0, 180)}`;
    })
    .join('; ');
  throw new Error(
    `listAllCompanies faalde op alle pogingen. Laatste pogingen: ${messages || 'geen details'}`
  );
}

export async function listClients(
  opts: ListClientsOptions = {}
): Promise<InserveListResponse<InserveContact>> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { page = 1, perPage = 25, withRelations = [], builder = [], builderParamsStyle, extraQueryParams } = opts;
  const fullBuilder: unknown[] = [
    ...(withRelations.length > 0 ? [{ with: withRelations }] : []),
    { paginate: { page, per_page: perPage } },
    ...builder,
  ];
  return (await client.request(INSERVE_CLIENT_ENDPOINT, {
    method: 'GET',
    builder: fullBuilder,
    query: extraQueryParams,
    ...(builderParamsStyle ? { builderParamsStyle } : {}),
  })) as InserveListResponse<InserveContact>;
}

export async function listAllClients(
  opts: Omit<ListClientsOptions, 'page'> & { maxPages?: number } = {}
): Promise<{
  items: InserveContact[];
  totalFetched: number;
  totalExpected: number;
  pagesProcessed: number;
}> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { maxPages, perPage = 25, withRelations = [], builder = [], builderParamsStyle, extraQueryParams } = opts;

  const errors: Array<{ label: string; error: unknown }> = [];

  type Strat = {
    label: string;
    withRelations: string[];
    useBuilder?: boolean;
    builderParamsStyle?: 'json' | 'nested';
    extraQueryParams?: Record<string, string | number | boolean | undefined>;
    perPage?: number;
    nestedBuilderIndexFromOne?: boolean;
    separateLimitPage?: boolean;
  };
  const strategies: Strat[] = [
    // Eerst: zonder builder, zonder with-relations. Dit voorkomt 500's op
    // endpoints die geen 'with' of nested-builder accepteren (komt vaak
    // voor op /clients en /assets; bedrijf-ID zit vaak in het record zelf).
    {
      label: 'clients-zonder-builder-eerst',
      withRelations: [],
      useBuilder: false,
      perPage: 50,
    },
    {
      label: 'clients-postman-flat-json-builder-geen-with',
      withRelations: [],
      useBuilder: false,
      perPage: 50,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
      // Geen builder[1][with]! Alleen limit + page (flat-qs).
      onlyLimitPageSeparateNoWith: true,
    } as any,
    {
      label: 'clients-postman-flat-met-customers',
      withRelations: [],
      useBuilder: false,
      perPage: 25,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
      separateWithValue: 'customers',
    } as any,
    {
      label: 'clients-postman-flat',
      withRelations: [],
      useBuilder: false,
      perPage: 25,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
    },
    {
      label: 'clients-nested-builder-company',
      withRelations: ['company'],
      useBuilder: true,
      builderParamsStyle: 'nested',
    },
    {
      label: 'clients-json-builder',
      withRelations: [],
      useBuilder: true,
      builderParamsStyle: 'json',
    },
  ];

  for (const strat of strategies) {
    try {
      const effectivePerPage = strat.perPage ?? perPage;
      const maxLoop = maxPages ?? 120;
      const allItems: InserveContact[] = [];
      let totalExpected = 0;
      let pagesProcessed = 0;
      let emptyStreak = 0;
      let firstKeys: string[] | null = null;
      let stratMetaLogged = false;

      for (let page = 1; page <= maxLoop; page++) {
        const customQuery: Record<string, string | number | boolean | undefined> = {
          page,
          per_page: effectivePerPage,
          ...(strat.extraQueryParams ?? {}),
          ...(extraQueryParams ?? {}),
        };
        if (strat.separateLimitPage && strat.nestedBuilderIndexFromOne) {
          const withValue: string | undefined =
            (strat as any).onlyLimitPageSeparateNoWith
              ? undefined
              : ((strat as any).separateWithValue as string) ??
                (strat.withRelations && strat.withRelations.length > 0
                  ? strat.withRelations.join(',')
                  : strat.label.includes('company') || strat.label.includes('clients-postman-flat')
                    ? 'company'
                    : undefined);
          if (withValue) {
            customQuery['builder[1][with]'] = withValue;
            customQuery['builder[2][limit]'] = effectivePerPage;
            customQuery['builder[3][page]'] = page;
          } else {
            customQuery['builder[1][limit]'] = effectivePerPage;
            customQuery['builder[2][page]'] = page;
          }
          delete customQuery['page'];
          delete customQuery['per_page'];
        }

        let chunk: any;
        if (strat.useBuilder === false) {
          chunk = await client.request<any>(INSERVE_CLIENT_ENDPOINT, {
            method: 'GET',
            query: customQuery,
            builder: undefined,
          });
        } else {
          const fullBuilder: unknown[] = [
            ...(strat.withRelations.length > 0 ? [{ with: strat.withRelations }] : []),
            { paginate: { page, per_page: effectivePerPage } },
            ...builder,
          ];
          chunk = await client.request<any>(INSERVE_CLIENT_ENDPOINT, {
            method: 'GET',
            builder: fullBuilder,
            query: extraQueryParams,
            builderParamsStyle: builderParamsStyle ?? strat.builderParamsStyle,
          });
        }

        pagesProcessed++;
        let pageItems: InserveContact[] = [];
        let pageMeta: any = {};
        if (Array.isArray(chunk)) {
          pageItems = chunk as InserveContact[];
        } else if (chunk && typeof chunk === 'object') {
          const rAny = chunk as Record<string, unknown>;
          if (Array.isArray(rAny.data)) pageItems = rAny.data as InserveContact[];
          else if (Array.isArray(rAny.items)) pageItems = rAny.items as InserveContact[];
          else if (Array.isArray(rAny.rows)) pageItems = rAny.rows as InserveContact[];
          else if (Array.isArray(rAny.result)) pageItems = rAny.result as InserveContact[];
          pageMeta = (rAny.meta ?? rAny.pagination ?? rAny._meta ?? rAny._pagination ?? {}) as any;
          if (typeof rAny.total === 'number' && totalExpected === 0) totalExpected = rAny.total as number;
          if (typeof (rAny as any).last_page === 'number' || typeof (rAny as any).lastPage === 'number') {
            pageMeta.last_page = (rAny as any).last_page ?? (rAny as any).lastPage;
          }
          if (page === 1 && !stratMetaLogged) {
            stratMetaLogged = true;
            try {
              console.debug(
                `[Inserve] listClients strategie [${strat.label}] | P1: ${pageItems.length} clients | chunk keys: [${Object.keys(rAny).join(', ')}] | last_page=${pageMeta.last_page ?? '-'} total=${rAny.total ?? '-'}`
              );
            } catch {}
          }
          if (!firstKeys && pageItems.length > 0 && typeof pageItems[0] === 'object') {
            firstKeys = Object.keys(pageItems[0] as unknown as Record<string, unknown>);
          }
        }

        if (pageItems.length > 0) {
          allItems.push(...pageItems);
          emptyStreak = 0;
        } else {
          emptyStreak++;
        }

        const metaTotal = pageMeta?.total ?? pageMeta?.count ?? pageMeta?.total_items ?? pageMeta?.totalItems;
        if (typeof metaTotal === 'number') totalExpected = metaTotal;

        const lastPage = pageMeta?.last_page ?? pageMeta?.lastPage ?? pageMeta?.total_pages ?? pageMeta?.totalPages;
        if (emptyStreak >= 2) break;
        if (typeof lastPage === 'number' && page >= lastPage) break;
        if (typeof totalExpected === 'number' && totalExpected > 0 && allItems.length >= totalExpected) break;
        if (pageItems.length === 0 && emptyStreak >= 1 && allItems.length > 0) break;
      }

      if (firstKeys && allItems.length > 0) {
        try {
          const sample = allItems[0];
          const anySample = sample as Record<string, unknown>;
          console.debug(
            `[Inserve] listAllClients strategie [${strat.label}] OK: ${allItems.length} clients (${pagesProcessed} pagina's). Eerste item keys: [${firstKeys.join(', ')}]`
          );
          const companyRelCount = allItems.filter((c) => getContactCompanyIds(c).length > 0).length;
          console.debug(
            `[Inserve] listAllClients: ${companyRelCount}/${allItems.length} hebben >= 1 company relatie.`
          );
          const withFnCount = allItems.filter((c) => resolveContactFunction(c) !== null).length;
          const withEmailCount = allItems.filter((c) => resolveContactEmail(c) !== null).length;
          const withMobileCount = allItems.filter((c) => resolveContactPhoneMobile(c) !== null).length;
          console.debug(
            `[Inserve] listAllClients coverage: email=${withEmailCount}, mobiel=${withMobileCount}, functie=${withFnCount}`
          );
        } catch {}
      }

      return {
        items: allItems,
        totalFetched: allItems.length,
        totalExpected,
        pagesProcessed,
      };
    } catch (e) {
      errors.push({ label: strat.label, error: e });
      // Rate limit bereikt: stop verder strategie-onderzoek onmiddellijk
      // (geen 4 × 1e-pagina verspillen).
      if (isInserveRateLimitError(e)) {
        break;
      }
      const is5xx =
        (e instanceof InserveApiError && e.statusCode >= 500 && e.statusCode < 600) ||
        !!(e as any)?.statusCode?.toString?.().startsWith('5');
      if (!is5xx) break;
    }
  }

  // Als een rate limit fout de stop veroorzaakte: re-throw die specifieke
  // fout zodat service-layer het als soft-failure kan afhandelen (geen
  // generieke "faalde op alle pogingen"-wrap).
  const rlErr = errors
    .map((e) => isInserveRateLimitError(e.error))
    .find((v): v is InserveRateLimitExceededError => v !== null && v !== undefined);
  if (rlErr) {
    throw rlErr;
  }

  const messages = errors
    .map(({ label, error }) => {
      const msg =
        error instanceof Error
          ? error.message.split('\n').slice(0, 2).join(' | ')
          : String(error);
      return `[${label}] ${msg.slice(0, 180)}`;
    })
    .join('; ');
  throw new Error(
    `listAllClients faalde op alle pogingen. Laatste pogingen: ${messages || 'geen details'}`
  );
}

export async function getCompanyById(
  id: number,
  withRelations: string[] = []
): Promise<InserveCompany> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const builder: unknown[] = withRelations.length > 0 ? [{ with: withRelations }] : [];
  return (await client.request(`${INSERVE_COMPANY_ENDPOINT}/${id}`, {
    method: 'GET',
    ...(builder.length > 0 ? { builder } : {}),
  })) as InserveCompany;
}

const GLOBAL_FIELD_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
type GlobalFieldCacheEntry = {
  fetchedAt: number;
  values: InserveCustomFieldValue[];
};
let _globalFieldCache: GlobalFieldCacheEntry | null = null;

let _inspectDetailLoggedCompanies = 0;
let _fullDetailJsonLoggedCompanies = 0;

const _looksLikeCustomFieldItem = (item: unknown): boolean => {
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  return (
    'field_id' in o ||
    'fieldId' in o ||
    'field_name' in o ||
    'fieldName' in o ||
    ('name' in o && ('value' in o || 'option' in o)) ||
    'option_label' in o ||
    'optionLabel' in o ||
    'option_value' in o ||
    'optionValue' in o
  );
};

export async function listCompanyCustomFields(
  companyId: number,
  sourceCompany?: Partial<InserveCompany> | null
): Promise<InserveCustomFieldValue[]> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }

  const extractFields = (payload: unknown): InserveCustomFieldValue[] | null => {
    if (payload && typeof payload === 'object') {
      const r = payload as Record<string, unknown>;
      const queue: unknown[] = Array.isArray(r) ? [...r] : [r];
      const seen = new WeakSet<object>();
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (!cur || typeof cur !== 'object') continue;
        if (seen.has(cur as object)) continue;
        seen.add(cur as object);

        if (Array.isArray(cur)) {
          if (cur.length > 0 && cur.every((it) => _looksLikeCustomFieldItem(it))) {
            return cur as InserveCustomFieldValue[];
          }
          for (const item of cur) {
            if (item && typeof item === 'object') queue.push(item);
          }
          continue;
        }

        const obj = cur as Record<string, unknown>;
        const topLevelCandidates = [
          'data',
          'items',
          'rows',
          'result',
          'customValues',
          'custom_values',
          'custom_fields',
          'customFields',
          'company_fields',
          'companyFields',
          'extra_fields',
          'extraFields',
          'fields',
          'free_fields',
          'freeFields',
          'customfields',
          'values',
          'meta',
        ];
        for (const key of topLevelCandidates) {
          const val = obj[key];
          if (Array.isArray(val) && val.length > 0 && val.every((it) => _looksLikeCustomFieldItem(it))) {
            return val as InserveCustomFieldValue[];
          }
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (val && typeof val === 'object') queue.push(val);
        }
      }
    }
    return null;
  };

  if (sourceCompany) {
    const inline = extractFields(sourceCompany);
    if (inline && inline.length > 0) return inline;
  }

  try {
    const detailResp = await client.request(`${INSERVE_COMPANY_ENDPOINT}/${companyId}`, { method: 'GET' });
    if (detailResp && typeof detailResp === 'object' && _inspectDetailLoggedCompanies < 3) {
      _inspectDetailLoggedCompanies++;
      const keys = Object.keys(detailResp as Record<string, unknown>);
      const fieldKeys = keys.filter((k) => /field|custom|extra|vrij|value|option/i.test(k));
      const arrayKeys: string[] = [];
      const nestedKeys: string[] = [];
      for (const k of keys) {
        const v = (detailResp as Record<string, unknown>)[k];
        if (Array.isArray(v)) arrayKeys.push(`${k}(${v.length})`);
        else if (v && typeof v === 'object') nestedKeys.push(k);
      }
      console.debug(
        `[Inserve] detail-endpoint keys voor bedrijf #${companyId} (sample ${_inspectDetailLoggedCompanies}/3):`,
        keys,
        fieldKeys.length > 0 ? `→ veld-achtige keys: [${fieldKeys.join(', ')}]` : '→ geen veld-achtige keys op top-level',
        `→ array keys: [${arrayKeys.join(', ') || '(geen)'}]`,
        `→ nested object keys: [${nestedKeys.join(', ') || '(geen)'}]`
      );
    }
    if (detailResp && _fullDetailJsonLoggedCompanies < 1) {
      _fullDetailJsonLoggedCompanies++;
      try {
        const safeJson = JSON.stringify(detailResp, (k, v) => {
          if (typeof v === 'string' && v.length > 300) return `${v.slice(0, 300)}…[len=${v.length}]`;
          return v;
        }, 2);
        console.debug(
          `[Inserve] Volledige detail-response JSON sample bedrijf #${companyId} (1/1, afgekapt per key >300 tekens):\n${safeJson}`
        );
      } catch (jsonErr: any) {
        console.debug(`[Inserve] Detail-response JSON serializeren mislukt: ${String(jsonErr?.message ?? jsonErr)}`);
      }
    }
    const embeddedFields = extractFields(detailResp);
    if (embeddedFields && embeddedFields.length > 0) return embeddedFields;
    if (detailResp && typeof detailResp === 'object') {
      const r = detailResp as Record<string, unknown>;
      for (const k of Object.keys(r)) {
        const v = r[k];
        if (Array.isArray(v)) {
          if (v.length === 0) continue;
          const first = v[0];
          if (
            first &&
            typeof first === 'object' &&
            ('field_id' in first ||
              'fieldId' in first ||
              'field_name' in first ||
              'fieldName' in first ||
              'name' in first ||
              'option' in first ||
              'value' in first)
          ) {
            return v as InserveCustomFieldValue[];
          }
        }
      }
    }
  } catch {
  }
  return [];
}

// ============================================================================
// Custom field parsing helpers
// ============================================================================

export type FieldTextNormalized =
  | { status: 'found'; value: string; raw: InserveCustomFieldValue }
  | { status: 'missing' }
  | { status: 'empty' }
  | { status: 'parse_error'; error: string };

export function resolveFieldTextValue(field: InserveCustomFieldValue | null | undefined): {
  text: string | null;
  optionLabel: string | null;
  optionValue: string | number | null;
  fieldValueText: string | null;
} {
  if (!field || typeof field !== 'object') {
    return { text: null, optionLabel: null, optionValue: null, fieldValueText: null };
  }
  const fieldAny = field as Record<string, unknown>;
  const rawValue = fieldAny.value;
  const opt = fieldAny.option;
  let optionLabel: string | null = null;
  let optionValue: string | number | null = null;
  if (opt && typeof opt === 'object') {
    const optAny = opt as Record<string, unknown>;
    optionLabel = typeof optAny.label === 'string' ? optAny.label : null;
    optionValue = (optAny.value !== null && optAny.value !== undefined) ? (optAny.value as string | number) : null;
    if (optionLabel === null && typeof optAny.name === 'string') optionLabel = optAny.name;
    if (optionValue === null && typeof optAny.id === 'number') optionValue = optAny.id;
  }

  const customFieldObj = fieldAny.custom_field_object;
  let optionsFromCfo: Array<Record<string, unknown>> = [];
  let cfoName: string | null = null;
  let cfoTitle: string | null = null;
  if (customFieldObj && typeof customFieldObj === 'object') {
    const cfo = customFieldObj as Record<string, unknown>;
    cfoName = typeof cfo.name === 'string' ? cfo.name : null;
    cfoTitle = typeof cfo.title === 'string' ? cfo.title : null;
    if (Array.isArray(cfo.options)) optionsFromCfo = cfo.options as Array<Record<string, unknown>>;
  }

  let text: string | null = null;
  if (typeof rawValue === 'string') text = rawValue;
  else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') text = String(rawValue);
  else if (rawValue === null || rawValue === undefined) text = null;

  let fieldValueText: string | null = null;
  const fv: any = fieldAny.field_value;
  if (fv && typeof fv === 'object') {
    const fvVal = fv.value;
    if (typeof fvVal === 'string') fieldValueText = fvVal;
    else if (typeof fvVal === 'number' || typeof fvVal === 'boolean') fieldValueText = String(fvVal);
  }

  void cfoName;
  void cfoTitle;

  const coerceEq = (a: unknown, b: unknown): boolean => {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    const sa = typeof a === 'string' ? a.trim().toLowerCase() : String(a).trim().toLowerCase();
    const sb = typeof b === 'string' ? b.trim().toLowerCase() : String(b).trim().toLowerCase();
    return sa === sb && sa !== '' && sb !== '';
  };

  for (const o of optionsFromCfo) {
    const oId = o.id;
    const oLabel = typeof o.label === 'string' ? o.label : (typeof o.name === 'string' ? o.name : null);
    const oValue = o.value;
    const oName = typeof o.name === 'string' ? o.name : null;
    if (!oLabel) continue;
    const matchesDirect =
      coerceEq(oId, rawValue) ||
      coerceEq(oValue, rawValue) ||
      coerceEq(oName, rawValue) ||
      coerceEq(oLabel, rawValue) ||
      coerceEq(text, oName) ||
      coerceEq(text, oLabel) ||
      coerceEq(fieldValueText, oName) ||
      coerceEq(fieldValueText, oLabel);
    if (matchesDirect) {
      optionLabel = oLabel;
      optionValue = oValue ?? (oName as any) ?? (oId as any);
      break;
    }
  }

  return { text, optionLabel, optionValue, fieldValueText };
}

export function fieldNameMatches(
  field: InserveCustomFieldValue,
  targetName: string
): boolean {
  const target = targetName.trim().toLowerCase();
  const fieldAny = field as Record<string, unknown>;
  const coerceStr = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
  };
  const standardCandidates: (string | null)[] = [
    coerceStr(field.name),
    coerceStr(field.slug),
    coerceStr(field.title),
    coerceStr(field.key),
    coerceStr(field.field_id),
    coerceStr(field.id),
    coerceStr(fieldAny.fieldName),
    coerceStr(fieldAny.field_name),
    coerceStr(fieldAny.custom_field),
  ];
  for (const c of standardCandidates) {
    if (c === null) continue;
    const norm = c.trim().toLowerCase();
    if (norm === target) return true;
    if (norm.includes(target)) return true;
  }
  const cfo = fieldAny.custom_field_object;
  if (cfo && typeof cfo === 'object') {
    const cfoAny = cfo as Record<string, unknown>;
    const cfoCandidates: (string | null)[] = [
      coerceStr(cfoAny.name),
      coerceStr(cfoAny.title),
      coerceStr(cfoAny.slug),
      coerceStr(cfoAny.key),
      coerceStr(cfoAny.id),
    ];
    for (const c of cfoCandidates) {
      if (c === null) continue;
      const norm = c.trim().toLowerCase();
      if (norm === target) return true;
      if (norm.includes(target)) return true;
    }
  }
  try {
    for (const k of Object.keys(fieldAny)) {
      const kl = k.trim().toLowerCase();
      if (kl === target) {
        const v = fieldAny[k];
        if (typeof v === 'string') return true;
      }
    }
  } catch {
    /* noop */
  }
  return false;
}

export function findCustomField(
  company: Pick<InserveCompany, 'customValues' | 'custom_values' | 'custom_fields' | 'company_fields' | 'extra_fields' | 'fields'> | InserveCompany,
  targetName: string
): InserveCustomFieldValue | null {
  const arrays: (InserveCustomFieldValue[] | null | undefined)[] = [
    (company as any).customValues,
    (company as any).custom_values,
    company.custom_fields,
    company.company_fields,
    company.extra_fields,
    company.fields,
  ];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const f of arr) {
      if (!f || typeof f !== 'object') continue;
      if (fieldNameMatches(f, targetName)) return f;
    }
  }
  return null;
}

export function resolveNexusFieldFromCompany(
  company: InserveCompany
): FieldTextNormalized {
  const field = findCustomField(company, 'Nexus');
  if (!field) return { status: 'missing' };
  try {
    const { text, optionLabel, optionValue, fieldValueText } = resolveFieldTextValue(field);
    const candidate =
      (optionLabel && optionLabel.trim() !== '' ? optionLabel : null) ??
      (fieldValueText && fieldValueText.trim() !== '' ? fieldValueText : null) ??
      text ??
      (optionValue !== null ? String(optionValue) : null);
    if (candidate === null || candidate === undefined) return { status: 'empty' };
    if (typeof candidate === 'string' && candidate.trim() === '') return { status: 'empty' };
    return {
      status: 'found',
      value: typeof candidate === 'string' ? candidate : String(candidate),
      raw: field,
    };
  } catch (e: any) {
    return { status: 'parse_error', error: e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------------------
// Assets (SIM-kaarten, overige bedrijfsmiddelen)
// ---------------------------------------------------------------------------

export function resolveAssetCategoryName(asset: InserveAsset): string | null {
  if (!asset || typeof asset !== 'object') return null;
  const a = asset as Record<string, unknown>;
  const candidates: unknown[] = [
    asset.category_name,
    asset.categoryName,
    asset.category_title,
    asset.category,
    a.asset_category_name,
    a.assetCategoryName,
    a.asset_category_title,
    a.cat_name,
    a.cat,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  const nestedObjs: unknown[] = [asset.asset_category, asset.assetCategory, a.category, a.Category];
  for (const obj of nestedObjs) {
    if (!obj || typeof obj !== 'object') continue;
    const o = obj as Record<string, unknown>;
    for (const key of ['name', 'title', 'label', 'category_name', 'categoryName', 'naam']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
      if (typeof v === 'number') return String(v);
    }
  }
  return null;
}

export function assetIsSimkaart(asset: InserveAsset): boolean {
  const name = resolveAssetCategoryName(asset);
  if (!name) return false;
  const n = name.toLowerCase();
  if (n === 'simkaart' || n === 'sim kaart' || n === 'sim-kaart' || n === 'simcard' || n === 'sim card' || n === 'sim-card' || n === 'simkaarten' || n === 'sim') return true;
  if (n.includes('sim') && (n.includes('kaart') || n.includes('card'))) return true;
  return false;
}

export function extractAssetCompanyId(asset: InserveAsset): number | null {
  if (!asset) return null;
  const direct: unknown[] = [
    asset.company_id,
    asset.companyId,
    asset.customer_id,
    asset.customerId,
    asset.owner_id,
    asset.relation_id,
    asset.relationId,
    asset.organization_id,
    asset.organizationId,
  ];
  for (const v of direct) {
    if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n) && Number.isInteger(n)) return n;
    }
  }
  const nestedObj: unknown[] = [asset.company, asset.relation, asset.owner, asset.organization, asset.customer];
  for (const obj of nestedObj) {
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj === 'number' && Number.isFinite(obj) && Number.isInteger(obj)) return obj;
    const o = obj as Record<string, unknown>;
    const candidates: unknown[] = [o.id, o.company_id, o.companyId, o.customer_id, o.customerId, o.relation_id, o.owner_id];
    for (const v of candidates) {
      if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n) && Number.isInteger(n)) return n;
      }
    }
  }
  return null;
}

export interface AssetIdentifiers {
  iccid: string | null;
  eid: string | null;
  msisdn: string | null;
  imsi: string | null;
  allFound: Array<{ key: string; raw: string | number | boolean | null }>;
}

export function extractAssetIdentifiers(asset: InserveAsset): AssetIdentifiers {
  const result: AssetIdentifiers = { iccid: null, eid: null, msisdn: null, imsi: null, allFound: [] };
  if (!asset || typeof asset !== 'object') return result;
  const a = asset as Record<string, unknown>;

  const topLevel: Array<{ key: string; norm: (v: unknown) => string | null; dest: keyof AssetIdentifiers }> = [
    { key: 'iccid', norm: (v) => v && typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'ICC_ID', norm: (v) => typeof v === 'string' ? v : null, dest: 'iccid' },
    { key: 'sim_iccid', norm: (v) => typeof v === 'string' ? v : null, dest: 'iccid' },
    { key: 'eid', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'eid' },
    { key: 'imsi', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'imsi' },
    { key: 'msisdn', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'msisdn' },
    { key: 'phone', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'msisdn' },
    { key: 'telephone', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'msisdn' },
    { key: 'mobile', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'msisdn' },
    { key: 'serial', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'serial_number', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'serialNumber', norm: (v) => typeof v === 'string' ? v : null, dest: 'iccid' },
    { key: 'identifier', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'identification_number', norm: (v) => typeof v === 'string' ? v : null, dest: 'iccid' },
    { key: 'asset_code', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'assetCode', norm: (v) => typeof v === 'string' ? v : null, dest: 'iccid' },
    { key: 'code', norm: (v) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null, dest: 'iccid' },
    { key: 'subscriberId', norm: (v) => typeof v === 'string' ? v : null, dest: 'imsi' },
    { key: 'subscriber_id', norm: (v) => typeof v === 'string' ? v : null, dest: 'imsi' },
  ];

  const foundRaw: Record<string, unknown[]> = { iccid: [], eid: [], msisdn: [], imsi: [] };

  for (const { key, norm, dest } of topLevel) {
    const lowerKey = key.toLowerCase();
    let value: unknown = undefined;
    for (const k of Object.keys(a)) {
      if (k.toLowerCase() === lowerKey) { value = a[k]; break; }
    }
    if (value === undefined) continue;
    const normed = norm(value);
    if (normed !== null && typeof normed === 'string' && normed.trim() !== '') {
      result.allFound.push({ key, raw: normed });
      foundRaw[dest].push(normed.trim());
    }
  }

  // Custom fields: scan via findCustomField pattern
  const customScans: Array<{ target: string; dest: keyof AssetIdentifiers }> = [
    { target: 'iccid', dest: 'iccid' },
    { target: 'simkaartnummer', dest: 'iccid' },
    { target: 'simkaart nummer', dest: 'iccid' },
    { target: 'simkaart', dest: 'iccid' },
    { target: 'chipnummer', dest: 'iccid' },
    { target: 'chip nummer', dest: 'iccid' },
    { target: 'serial iccid', dest: 'iccid' },
    { target: 'eid', dest: 'eid' },
    { target: 'eid nummer', dest: 'eid' },
    { target: 'imsi', dest: 'imsi' },
    { target: 'msisdn', dest: 'msisdn' },
    { target: 'telefoonnummer', dest: 'msisdn' },
    { target: 'mobiel nummer', dest: 'msisdn' },
    { target: 'mobiel', dest: 'msisdn' },
    { target: 'telefoon', dest: 'msisdn' },
  ];

  for (const { target, dest } of customScans) {
    const field = findCustomField(asset as any, target);
    if (!field) continue;
    try {
      const { text, optionLabel, optionValue, fieldValueText } = resolveFieldTextValue(field);
      const candidates: Array<string | number | null | undefined> = [optionLabel, fieldValueText, text, optionValue as any];
      for (const raw of candidates) {
        if (raw === null || raw === undefined) continue;
        const s = typeof raw === 'string' ? raw.trim() : String(raw);
        if (s === '') continue;
        result.allFound.push({ key: `custom:${target}`, raw: s });
        foundRaw[dest].push(s);
      }
    } catch {
      /* ignore */
    }
  }

  // Kies de beste waarde per identifier: de langste niet-numeric-only string als ICCID, anders eerst voorkomend
  const pickBest = (arr: string[]): string | null => {
    if (arr.length === 0) return null;
    let best = arr[0];
    for (const s of arr) {
      if (s.length > best.length) best = s;
    }
    return best;
  };
  result.iccid = pickBest(foundRaw.iccid as string[]);
  result.eid = pickBest(foundRaw.eid as string[]);
  result.msisdn = pickBest(foundRaw.msisdn as string[]);
  result.imsi = pickBest(foundRaw.imsi as string[]);
  return result;
}

export async function listAllAssets(
  opts: ListAssetsOptions & { maxPages?: number; endpointHint?: string } = {}
): Promise<{
  items: InserveAsset[];
  totalFetched: number;
  totalExpected: number;
  pagesProcessed: number;
  endpointUsed: string | null;
  responses?: any[];
}> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { maxPages, perPage = 25, withRelations = [], builder = [], builderParamsStyle, extraQueryParams, endpointHint } = opts;

  const candidates = endpointHint ? [endpointHint, ...INSERVE_ASSET_ENDPOINT_CANDIDATES.filter((e) => e !== endpointHint)] : INSERVE_ASSET_ENDPOINT_CANDIDATES;

  type Strat = {
    label: string;
    endpoint: string;
    withRelations: string[];
    useBuilder?: boolean;
    builderParamsStyle?: 'json' | 'nested';
    extraQueryParams?: Record<string, string | number | boolean | undefined>;
    perPage?: number;
    nestedBuilderIndexFromOne?: boolean;
    separateLimitPage?: boolean;
  };
  const strategies: Strat[] = [];
  for (const ep of candidates) {
    // 1) zonder builder — meteen zonder side-loads (geen 500 risico)
    strategies.push({
      label: `asset-${ep}-zonder-builder-eerst`,
      endpoint: ep,
      withRelations: [],
      useBuilder: false,
      perPage: 50,
    } as Strat);
    // 2) flat-builder ALLEEN limit+page zonder with (geen side-loads)
    strategies.push({
      label: `asset-${ep}-postman-flat-no-with`,
      endpoint: ep,
      withRelations: [],
      useBuilder: false,
      perPage: 50,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
      onlyLimitPageSeparateNoWith: true as any,
    } as Strat);
    // 3) flat-builder snake_case relations (custom_fields, companies) —
    //    komt het meest voor bij Inserve Laravel APIs
    strategies.push({
      label: `asset-${ep}-postman-flat-snake-case`,
      endpoint: ep,
      withRelations: [],
      useBuilder: false,
      perPage,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
      separateWithValue: 'companies,custom_fields' as any,
    } as Strat);
    // 4) Oude bekende: flat-builder met company,customValues
    strategies.push({
      label: `asset-${ep}-postman-flat`,
      endpoint: ep,
      withRelations: [],
      useBuilder: false,
      perPage,
      extraQueryParams: {},
      separateLimitPage: true,
      nestedBuilderIndexFromOne: true,
      separateWithValue: 'company,customValues' as any,
    } as Strat);
    // 5) json builder snake_case
    strategies.push({
      label: `asset-${ep}-json-builder-snake-case`,
      endpoint: ep,
      withRelations: ['companies', 'custom_fields'],
      useBuilder: true,
      builderParamsStyle: 'json',
    });
    // 6) json builder camelCase (originele fallback)
    strategies.push({
      label: `asset-${ep}-json-builder`,
      endpoint: ep,
      withRelations: withRelations.length > 0 ? withRelations : ['company', 'customValues'],
      useBuilder: true,
      builderParamsStyle: 'json',
    });
  }

  const errors: Array<{ label: string; error: unknown }> = [];

  for (const strat of strategies) {
    try {
      const effectivePerPage = strat.perPage ?? perPage;
      const maxLoop = maxPages ?? 120;
      const allItems: InserveAsset[] = [];
      let totalExpected = 0;
      let pagesProcessed = 0;
      let emptyStreak = 0;
      let firstKeys: string[] | null = null;
      let stratMetaLogged = false;

      for (let page = 1; page <= maxLoop; page++) {
        const customQuery: Record<string, string | number | boolean | undefined> = {
          page,
          per_page: effectivePerPage,
          ...(strat.extraQueryParams ?? {}),
          ...(extraQueryParams ?? {}),
        };
        if (strat.separateLimitPage && strat.nestedBuilderIndexFromOne) {
          const onlyNoWith: boolean = (strat as any).onlyLimitPageSeparateNoWith === true;
          const overrideWith: string | undefined = (strat as any).separateWithValue;
          if (onlyNoWith) {
            customQuery['builder[1][limit]'] = effectivePerPage;
            customQuery['builder[2][page]'] = page;
          } else if (overrideWith) {
            customQuery['builder[1][with]'] = overrideWith;
            customQuery['builder[2][limit]'] = effectivePerPage;
            customQuery['builder[3][page]'] = page;
          } else {
            const rels = strat.withRelations && strat.withRelations.length > 0
              ? strat.withRelations
              : ['company', 'customValues'];
            customQuery['builder[1][with]'] = rels.join(',');
            customQuery['builder[2][limit]'] = effectivePerPage;
            customQuery['builder[3][page]'] = page;
          }
          delete customQuery['page'];
          delete customQuery['per_page'];
        }

        let chunk: any;
        if (strat.useBuilder === false) {
          chunk = await client.request<any>(strat.endpoint, {
            method: 'GET',
            query: customQuery,
            builder: undefined,
          });
        } else {
          const fullBuilder: unknown[] = [
            ...(strat.withRelations.length > 0 ? [{ with: strat.withRelations }] : []),
            { paginate: { page, per_page: effectivePerPage } },
            ...builder,
          ];
          chunk = await client.request<any>(strat.endpoint, {
            method: 'GET',
            builder: fullBuilder,
            query: extraQueryParams,
            builderParamsStyle: builderParamsStyle ?? strat.builderParamsStyle,
          });
        }

        pagesProcessed++;
        let pageItems: InserveAsset[] = [];
        let pageMeta: any = {};
        if (Array.isArray(chunk)) {
          pageItems = chunk as InserveAsset[];
        } else if (chunk && typeof chunk === 'object') {
          const rAny = chunk as Record<string, unknown>;
          if (Array.isArray(rAny.data)) pageItems = rAny.data as InserveAsset[];
          else if (Array.isArray(rAny.items)) pageItems = rAny.items as InserveAsset[];
          else if (Array.isArray(rAny.rows)) pageItems = rAny.rows as InserveAsset[];
          else if (Array.isArray(rAny.result)) pageItems = rAny.result as InserveAsset[];
          else if (Array.isArray(rAny.assets)) pageItems = rAny.assets as InserveAsset[];
          pageMeta = (rAny.meta ?? rAny.pagination ?? rAny._meta ?? rAny._pagination ?? {}) as any;
          if (typeof rAny.total === 'number' && totalExpected === 0) totalExpected = rAny.total as number;
          if (typeof (rAny as any).last_page === 'number' || typeof (rAny as any).lastPage === 'number') {
            pageMeta.last_page = (rAny as any).last_page ?? (rAny as any).lastPage;
          }
          if (page === 1 && !stratMetaLogged) {
            stratMetaLogged = true;
            try {
              console.debug(
                `[Inserve] listAssets strategie [${strat.label}] endpoint=${strat.endpoint} | P1: ${pageItems.length} assets | chunk keys: [${Object.keys(rAny).join(', ')}] | last_page=${pageMeta.last_page ?? '-'} total=${rAny.total ?? '-'}`
              );
            } catch {
              /* noop */
            }
          }
          if (!firstKeys && pageItems.length > 0 && typeof pageItems[0] === 'object') {
            firstKeys = Object.keys(pageItems[0] as unknown as Record<string, unknown>);
          }
        }

        if (pageItems.length > 0) {
          allItems.push(...pageItems);
          emptyStreak = 0;
        } else {
          emptyStreak++;
        }

        const metaTotal = pageMeta?.total ?? pageMeta?.count ?? pageMeta?.total_items ?? pageMeta?.totalItems;
        if (typeof metaTotal === 'number') totalExpected = metaTotal;

        const lastPage = pageMeta?.last_page ?? pageMeta?.lastPage ?? pageMeta?.total_pages ?? pageMeta?.totalPages;
        if (emptyStreak >= 2) break;
        if (typeof lastPage === 'number' && page >= lastPage) break;
        if (typeof totalExpected === 'number' && totalExpected > 0 && allItems.length >= totalExpected) break;
        if (pageItems.length === 0 && emptyStreak >= 1 && allItems.length > 0) break;
      }

      if (firstKeys) {
        try {
          console.debug(
            `[Inserve] listAssets endpoint=[${strat.endpoint}] firstKeys (${allItems.length} items): [${firstKeys.join(', ')}]`
          );
        } catch {
          /* noop */
        }
      }

      if (allItems.length > 0) {
        return {
          items: allItems,
          totalFetched: allItems.length,
          totalExpected,
          pagesProcessed,
          endpointUsed: strat.endpoint,
        };
      }
    } catch (err) {
      errors.push({ label: strat.label, error: err });
      // Rate limit: stop strategie-loop onmiddellijk (geen 39 × verspilde
      // pogingen). 404/endpoint-bestaat-niet mag gewoon verder.
      if (isInserveRateLimitError(err)) {
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const notFoundLike =
        msg.includes('404') || msg.includes('not found') || msg.includes('ENOTFOUND') || /\b4\d\d\b/.test(msg);
      if (!notFoundLike) {
        try {
          console.debug(`[Inserve] listAssets strategie [${strat?.label}] endpoint=${strat?.endpoint} fout (non-404): ${msg.slice(0, 250)}`);
        } catch {
          /* noop */
        }
      }
      continue;
    }
  }

  // Als de strategy-loop stopte door rate-limit: re-throw direct (geen
  // generieke "lege return" van listAllAssets, dan verliest caller context).
  const rlErr = errors
    .map((e) => isInserveRateLimitError(e.error))
    .find((v): v is InserveRateLimitExceededError => v !== null && v !== undefined);
  if (rlErr) throw rlErr;

  return {
    items: [],
    totalFetched: 0,
    totalExpected: 0,
    pagesProcessed: 0,
    endpointUsed: null,
  };
}

