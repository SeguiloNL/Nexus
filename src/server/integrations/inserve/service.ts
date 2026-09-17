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
  query?: { company_id?: number; reference?: string; status?: string; page?: number; per_page?: number }
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
