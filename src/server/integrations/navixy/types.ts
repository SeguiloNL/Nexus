export type NavixyAuthMode = 'panel' | 'user' | 'direct';
export type NavixyCreateMethod = 'create' | 'clone' | 'register';

export interface NavixyCredentials {
  baseUrl: string;
  authMode: NavixyAuthMode;
  panelLogin?: string | null;
  panelPassword?: string | null;
  userLogin?: string | null;
  userPassword?: string | null;
  directHash?: string | null;
  defaultUserId?: number | null;
  defaultTariffId?: number | null;
  defaultCloneSourceTrackerId?: number | null;
  createMethod: NavixyCreateMethod;
  endpoints: {
    panelAuth: string;
    userAuth: string;
    panelTracker: string;
    userTracker: string;
  };
  source: 'env';
}

export interface NavixyStatus {
  code: number;
  description?: string | null;
}

export interface NavixyErrorEnvelope {
  success: false;
  status: NavixyStatus;
  errors?: Array<{ field?: string | null; message: string; code?: number }> | null;
}

export interface NavixySuccessEnvelope<T> {
  success: true;
  hash?: string;
  permissions?: unknown;
  id?: number;
  list?: T[];
  total?: number;
  tracker?: T;
  value?: T;
  [key: string]: unknown;
}

export type NavixyResponse<T> = NavixySuccessEnvelope<T> | NavixyErrorEnvelope;

export interface NavixyTracker {
  id: number;
  label?: string | null;
  imei?: string | null;
  device_model?: string | number | null;
  deviceModelName?: string | null;
  tariff_id?: number | null;
  user_id?: number | null;
  state?: 'active' | 'blocked' | 'inactive' | string | null;
  status?: {
    online?: boolean | null;
    last_connection?: string | null;
    gps?: { lat?: number; lng?: number } | null;
  } | null;
  creation_date?: string | null;
  raw?: unknown;
}

export interface RegisterTrackerOptions {
  imei: string;
  deviceModel: string | number;
  label?: string | null;
  userId?: number | null;
  tariffId?: number | null;
  sourceTrackerId?: number | null;
  clone?: boolean | null;
}
