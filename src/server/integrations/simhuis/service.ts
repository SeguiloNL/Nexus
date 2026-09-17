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
  const path = `${client.endpoints.sims}/${encodeURIComponent(iccid)}`;
  try {
    const resp = await doRequest<unknown>(path, { method: 'GET' });
    return toSimStatus(resp, iccid);
  } catch (err) {
    if (err instanceof SimhuisApiError && err.statusCode === 404) {
      return { iccid, status: null, raw: null };
    }
    throw err;
  }
}

export async function activateSim(options: ActivateSimOptions): Promise<SimhuisSimStatus> {
  const client = (await simhuisClient.getClient())!;
  const resellerId = options.resellerId ?? client.resellerId;
  const body: Record<string, unknown> = {};
  if (options.offerId) body.offer_id = options.offerId;
  if (options.planId) body.plan_id = options.planId;
  if (resellerId) body.reseller_id = resellerId;
  if (options.customerRef) body.customer_ref = options.customerRef;
  if (options.iccid) body.iccid = options.iccid;

  const path = `${client.endpoints.sims}/${encodeURIComponent(options.iccid)}${client.endpoints.simActivate}`;
  const resp = await doRequest<unknown>(path, { method: 'POST', body });
  return toSimStatus(resp, options.iccid);
}

export async function deactivateSim(iccid: string): Promise<SimhuisSimStatus> {
  const client = (await simhuisClient.getClient())!;
  const path = `${client.endpoints.sims}/${encodeURIComponent(iccid)}${client.endpoints.simDeactivate}`;
  const resp = await doRequest<unknown>(path, { method: 'POST', body: { iccid } });
  return toSimStatus(resp, iccid);
}

export { simhuisClient, SimhuisApiError };
export type { SimhuisRequestOptions };
