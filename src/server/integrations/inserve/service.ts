import { inserveClient, InserveClient, InserveApiError } from './client';
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
} from './types';
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

export const INSERVE_COMPANY_ENDPOINT = 'companies';

export interface ListCompaniesOptions {
  page?: number;
  perPage?: number;
  withRelations?: string[];
  builder?: unknown[];
}

export async function listCompanies(
  opts: ListCompaniesOptions = {}
): Promise<InserveListResponse<InserveCompany>> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { page = 1, perPage = 25, withRelations = [], builder = [] } = opts;
  const fullBuilder: unknown[] = [
    ...(withRelations.length > 0 ? [{ with: withRelations }] : []),
    { paginate: { page, per_page: perPage } },
    ...builder,
  ];
  return (await client.request(INSERVE_COMPANY_ENDPOINT, {
    method: 'GET',
    builder: fullBuilder,
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
  const { maxPages, perPage = 25, withRelations = [], builder = [] } = opts;

  const requestedRelations =
    withRelations.length > 0 ? withRelations : ['custom_fields', 'company_fields', 'extra_fields', 'fields'];

  const strategies: Array<{
    label: string;
    withRelations: string[];
    enrichLater: boolean;
    useBuilder?: boolean;
  }> = [
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

  for (const strat of strategies) {
    try {
      let result: Awaited<ReturnType<typeof client.requestAllPages<InserveCompany>>>;

      const pageQuery: Record<string, string | number | boolean | undefined> = {
        page: 1,
        per_page: perPage,
      };

      if (strat.useBuilder === false) {
        const maxLoop = maxPages ?? 50;
        const allItems: InserveCompany[] = [];
        let totalExpected = 0;
        let pagesProcessed = 0;
        let firstDetailKeys: string[] | null = null;
        for (let page = 1; page <= maxLoop; page++) {
          pageQuery.page = page;
          const chunk = (await client.request<any>(INSERVE_COMPANY_ENDPOINT, {
            method: 'GET',
            query: { ...pageQuery },
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
            pageMeta = (rAny.meta ?? rAny.pagination ?? rAny._meta ?? {}) as any;
          }

          if (pageItems.length > 0) {
            allItems.push(...pageItems);
            if (!firstDetailKeys && pageItems[0] && typeof pageItems[0] === 'object') {
              firstDetailKeys = Object.keys(pageItems[0] as unknown as Record<string, unknown>);
            }
          }

          const metaTotal = pageMeta?.total ?? pageMeta?.count ?? pageMeta?.total_items;
          if (typeof metaTotal === 'number') totalExpected = metaTotal;

          const lastPage = pageMeta?.last_page ?? pageMeta?.lastPage ?? pageMeta?.total_pages;
          if (pageItems.length === 0) break;
          if (typeof lastPage === 'number' && page >= lastPage) break;
          if (typeof totalExpected === 'number' && allItems.length >= totalExpected) break;
          if (pageItems.length < perPage) break;
        }

        if (firstDetailKeys && allItems.length > 0) {
          try {
            const hasFieldLike = firstDetailKeys.some((k) =>
              /field|custom|extra|vrij/i.test(k)
            );
            console.debug(
              `[Inserve] listCompanies strategie [${strat.label}] eerste item keys (${allItems.length} items):`,
              firstDetailKeys,
              hasFieldLike ? '(bevat veld-achtige keys!)' : '(geen veld-keys zichtbaar in list)'
            );
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
        });
        if (result.items.length > 0 && result.items[0] && typeof result.items[0] === 'object') {
          try {
            const keys = Object.keys(result.items[0] as unknown as Record<string, unknown>);
            const hasFieldLike = keys.some((k) => /field|custom|extra|vrij/i.test(k));
            console.debug(
              `[Inserve] listCompanies strategie [${strat.label}] eerste item keys (${result.items.length} items):`,
              keys,
              hasFieldLike ? '(bevat veld-achtige keys!)' : '(geen veld-keys zichtbaar in list)'
            );
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

export async function listCompanyCustomFields(
  companyId: number
): Promise<InserveCustomFieldValue[]> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }

  const extractFields = (payload: unknown): InserveCustomFieldValue[] | null => {
    if (Array.isArray(payload)) return payload as InserveCustomFieldValue[];
    if (payload && typeof payload === 'object') {
      const r = payload as Record<string, unknown>;
      const queue: unknown[] = [r];
      const seen = new WeakSet<object>();
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (!cur || typeof cur !== 'object') continue;
        if (seen.has(cur as object)) continue;
        seen.add(cur as object);
        const obj = cur as Record<string, unknown>;
        const topLevelCandidates = [
          'data',
          'items',
          'rows',
          'result',
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
        ];
        for (const key of topLevelCandidates) {
          const val = obj[key];
          if (Array.isArray(val)) return val as InserveCustomFieldValue[];
        }
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (val && typeof val === 'object' && !Array.isArray(val)) queue.push(val);
        }
      }
    }
    return null;
  };

  try {
    const detailResp = await client.request(`${INSERVE_COMPANY_ENDPOINT}/${companyId}`, { method: 'GET' });
    if (detailResp && typeof detailResp === 'object' && _inspectDetailLoggedCompanies < 3) {
      _inspectDetailLoggedCompanies++;
      const keys = Object.keys(detailResp as Record<string, unknown>);
      const fieldKeys = keys.filter((k) => /field|custom|extra|vrij|value|option/i.test(k));
      console.debug(
        `[Inserve] detail-endpoint keys voor bedrijf #${companyId} (sample ${_inspectDetailLoggedCompanies}/3):`,
        keys,
        fieldKeys.length > 0 ? `→ veld-achtige keys: [${fieldKeys.join(', ')}]` : '→ geen veld-achtige keys op top-level'
      );
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
  const rawValue = field.value;
  const opt = field.option;
  let optionLabel: string | null = null;
  let optionValue: string | number | null = null;
  if (opt && typeof opt === 'object') {
    optionLabel = typeof opt.label === 'string' ? opt.label : null;
    optionValue = (opt.value !== null && opt.value !== undefined) ? opt.value : null;
  }
  let text: string | null = null;
  if (typeof rawValue === 'string') text = rawValue;
  else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') text = String(rawValue);
  else if (rawValue === null || rawValue === undefined) text = null;

  let fieldValueText: string | null = null;
  const fv: any = (field as any).field_value;
  if (fv && typeof fv === 'object') {
    const fvVal = fv.value;
    if (typeof fvVal === 'string') fieldValueText = fvVal;
    else if (typeof fvVal === 'number' || typeof fvVal === 'boolean') fieldValueText = String(fvVal);
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
  ];
  for (const c of standardCandidates) {
    if (c === null) continue;
    const norm = c.trim().toLowerCase();
    if (norm === target) return true;
    if (norm.includes(target)) return true;
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
  company: Pick<InserveCompany, 'custom_fields' | 'company_fields' | 'extra_fields' | 'fields'> | InserveCompany,
  targetName: string
): InserveCustomFieldValue | null {
  const arrays: (InserveCustomFieldValue[] | null | undefined)[] = [
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

