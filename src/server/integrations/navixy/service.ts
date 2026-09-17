import { navixyClient, NavixyApiError, type NavixyRequestOptions } from './client';
import type { NavixyResponse, NavixyTracker, RegisterTrackerOptions } from './types';

function toTracker(raw: any): NavixyTracker {
  const r = (raw ?? {}) as Record<string, any>;
  const deviceModel =
    r.device_model !== undefined && r.device_model !== null
      ? r.device_model
      : (r.model ?? r.deviceModel ?? r.type ?? null);
  const statusObj = (r.status && typeof r.status === 'object') ? r.status : (r.state_detail ?? null);
  return {
    id: typeof r.id === 'number' ? r.id : Number(r.id || 0),
    label: typeof r.label === 'string' ? r.label : (typeof r.name === 'string' ? r.name : null),
    imei: typeof r.imei === 'string' ? r.imei : (typeof r.device_imei === 'string' ? r.device_imei : null),
    device_model: deviceModel,
    deviceModelName: typeof r.device_model_name === 'string' ? r.device_model_name : null,
    tariff_id: typeof r.tariff_id === 'number' ? r.tariff_id : (r.plan_id ?? null),
    user_id: typeof r.user_id === 'number' ? r.user_id : null,
    state: typeof r.state === 'string' ? r.state : (r.status_name ?? null),
    status: statusObj,
    creation_date: typeof r.creation_date === 'string' ? r.creation_date : (r.created_at ?? null),
    raw,
  };
}

async function unwrapCall<T>(
  path: string,
  options: NavixyRequestOptions & { nothrowOnApiFail?: boolean } = {},
): Promise<T> {
  const client = await navixyClient.getClient();
  if (!client) {
    throw new NavixyApiError(503, null, path, '[Navixy] Niet geconfigureerd: NAVIXY auth credentials ontbreken in env vars.');
  }
  const resp = await client.request<T>(path, options);
  if (resp?.success === true) {
    return resp as any as T;
  }
  throw new NavixyApiError(502, resp, path, `[Navixy] API success=false voor ${path}`);
}

export async function registerTracker(options: RegisterTrackerOptions): Promise<NavixyTracker> {
  const client = (await navixyClient.getClient())!;
  const method = options.clone === true ? 'clone' : (client.createMethod);
  const userId = options.userId ?? client.defaultUserId;
  const tariffId = options.tariffId ?? client.defaultTariffId;
  const src = options.sourceTrackerId ?? client.defaultCloneSourceTrackerId;

  if (method === 'clone') {
    if (!src) throw new NavixyApiError(400, null, 'clone', '[Navixy] CREATE_METHOD=clone: geef NAVIXY_DEFAULT_CLONE_SOURCE_TRACKER_ID of sourceTrackerId op.');
    const endpoint = `${client.endpoints.panelTracker}/clone`;
    const body: Record<string, any> = {
      source_tracker_id: src,
      user_id: userId,
      label: options.label ?? undefined,
    };
    const resp = await unwrapCall<any>(endpoint, { method: 'POST', body });
    const newId = typeof (resp as any).id === 'number' ? (resp as any).id : null;
    if (!newId) throw new NavixyApiError(502, resp, endpoint, '[Navixy] Clone response missing tracker id.');
    if (options.deviceModel !== undefined) {
      await updateTrackerDeviceModel(newId, options.deviceModel, options.imei);
    }
    if (tariffId) {
      await changeTrackerTariff(newId, tariffId).catch(err => console.warn(`[Navixy] Tariff change failed for tracker ${newId}:`, err instanceof Error ? err.message : err));
    }
    return getTracker(newId);
  }

  if (method === 'register') {
    const endpoint = `${client.endpoints.panelTracker}/register_retry`;
    const body: Record<string, any> = {
      tracker_id: 0,
    };
    const resp = await unwrapCall<any>(endpoint, { method: 'POST', body });
    const id = typeof (resp as any).id === 'number' ? (resp as any).id : 0;
    if (!id) throw new NavixyApiError(502, resp, endpoint, '[Navixy] register_retry response missing tracker id.');
    return getTracker(id);
  }

  // CREATE method (Platform/User API)
  const endpoint = `${client.endpoints.userTracker}/create`;
  const body: Record<string, any> = {
    imei: options.imei,
    device_model: options.deviceModel,
    label: options.label ?? `Tracker ${options.imei}`,
  };
  if (userId !== undefined && userId !== null) body.user_id = userId;
  if (tariffId !== undefined && tariffId !== null) body.tariff_id = tariffId;

  const resp = await unwrapCall<any>(endpoint, { method: 'POST', body });
  const newId = typeof (resp as any).id === 'number' ? (resp as any).id : 0;
  if (!newId) throw new NavixyApiError(502, resp, endpoint, '[Navixy] Create response missing tracker id.');
  return getTracker(newId);
}

export async function updateTrackerDeviceModel(
  trackerId: number,
  deviceModel: string | number,
  imei?: string,
): Promise<void> {
  const client = (await navixyClient.getClient())!;
  const endpoint = `${client.endpoints.panelTracker}/source/update`;
  const body: Record<string, any> = {
    tracker_id: trackerId,
    device_model: deviceModel,
  };
  if (imei) body.imei = imei;
  await unwrapCall(endpoint, { method: 'POST', body });
}

export async function changeTrackerTariff(trackerId: number, tariffId: number): Promise<void> {
  const client = (await navixyClient.getClient())!;
  const endpoint = `${client.endpoints.panelTracker}/tariff/change`;
  await unwrapCall(endpoint, { method: 'POST', body: { tracker_id: trackerId, tariff_id: tariffId } });
}

export async function getTracker(trackerId: number): Promise<NavixyTracker> {
  const client = (await navixyClient.getClient())!;
  const tryPanel = `${client.endpoints.panelTracker}/read`;
  try {
    const resp = await unwrapCall<any>(tryPanel, { method: 'POST', body: { tracker_id: trackerId } });
    const t = (resp as any).tracker ?? resp;
    return toTracker(Array.isArray(t) ? t[0] : t);
  } catch (panelErr) {
    const tryUser = `${client.endpoints.userTracker}/read`;
    try {
      const resp2 = await unwrapCall<any>(tryUser, { method: 'POST', body: { tracker_id: trackerId } });
      const t = (resp2 as any).tracker ?? resp2;
      return toTracker(Array.isArray(t) ? t[0] : t);
    } catch {
      throw panelErr;
    }
  }
}

export async function suspendTracker(trackerId: number, suspend = true): Promise<void> {
  const client = (await navixyClient.getClient())!;
  const state = suspend ? 'blocked' : 'active';
  const endpoint = `${client.endpoints.panelTracker}/settings/update`;
  try {
    await unwrapCall(endpoint, { method: 'POST', body: { tracker_id: trackerId, state } });
  } catch (err) {
    const fallback = `${client.endpoints.userTracker}/update`;
    await unwrapCall(fallback, { method: 'POST', body: { tracker_id: trackerId, state } }).catch(() => { throw err; });
  }
}

export async function deleteTracker(trackerId: number): Promise<void> {
  const client = (await navixyClient.getClient())!;
  const endpoint = `${client.endpoints.panelTracker}/corrupt`;
  try {
    await unwrapCall(endpoint, { method: 'POST', body: { tracker_id: trackerId } });
  } catch (err) {
    const fallback = `${client.endpoints.userTracker}/delete`;
    await unwrapCall(fallback, { method: 'POST', body: { tracker_id: trackerId } }).catch(() => { throw err; });
  }
}

export { navixyClient, NavixyApiError };
export type { NavixyRequestOptions, NavixyResponse };
