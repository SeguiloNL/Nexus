export type SimhuisAuthMode = 'basic' | 'bearer';

export interface SimhuisCredentials {
  baseUrl: string;
  authMode: SimhuisAuthMode;
  username: string;
  password: string;
  resellerId?: string | null;
  endpoints: {
    login: string;
    sims: string;
    simActivate: string;
    simDeactivate: string;
  };
  source: 'env' | 'db';
}

export interface SimhuisSimStatus {
  iccid: string;
  imsi?: string | null;
  msisdn?: string | null;
  status?: 'active' | 'inactive' | 'suspended' | 'terminated' | 'provisioning' | string | null;
  ip?: string | null;
  network?: string | null;
  planName?: string | null;
  dataUsedBytes?: number | null;
  dataLimitBytes?: number | null;
  activatedAt?: string | null;
  raw?: unknown;
}

export interface ActivateSimOptions {
  iccid: string;
  offerId?: string | null;
  planId?: string | null;
  resellerId?: string | null;
  customerRef?: string | null;
}

export interface SimhuisLoginResponse {
  token?: string;
  access_token?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export interface SimhuisApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: unknown;
  message?: string;
  [key: string]: unknown;
}
