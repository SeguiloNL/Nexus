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
}> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const { maxPages, perPage = 25, withRelations = [], builder = [] } = opts;
  return await client.requestAllPages<InserveCompany>(INSERVE_COMPANY_ENDPOINT, {
    perPage,
    withRelations,
    extraBuilder: builder,
    maxPages,
    method: 'GET',
  });
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

export async function listCompanyCustomFields(
  companyId: number
): Promise<InserveCustomFieldValue[]> {
  const client = await inserveClient.getClient();
  if (!client) {
    throw new Error('[Inserve] Client not configured. Configure via Instellingen or set INSERVE_* env vars.');
  }
  const candidates = [
    `${INSERVE_COMPANY_ENDPOINT}/${companyId}/custom_fields`,
    `${INSERVE_COMPANY_ENDPOINT}/${companyId}/fields`,
    `${INSERVE_COMPANY_ENDPOINT}/${companyId}/company_fields`,
  ];
  let lastErr: unknown;
  for (const path of candidates) {
    try {
      const resp = await client.request(path, { method: 'GET' });
      if (Array.isArray(resp)) return resp as InserveCustomFieldValue[];
      if (resp && Array.isArray((resp as any).data)) return (resp as any).data as InserveCustomFieldValue[];
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
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

