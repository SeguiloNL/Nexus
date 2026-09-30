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
  eid?: string | null;
  imsi?: string | null;
  msisdn?: string | null;
  subscriberId?: string | null;
  simName?: string | null;
  displayName?: string | null;
  assetName?: string | null;
  label?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  group?: string | null;
  poolName?: string | null;
  batchName?: string | null;
  productName?: string | null;
  productCode?: string | null;
  offerName?: string | null;
  productType?: string | null;
  productCategory?: string | null;
  subscriptionType?: string | null;
  assetType?: string | null;
  simCategory?: string | null;
  category?: string | null;
  status?: 'active' | 'inactive' | 'suspended' | 'terminated' | 'provisioning' | string | null;
  ip?: string | null;
  network?: string | null;
  planName?: string | null;
  dataUsedBytes?: number | null;
  dataLimitBytes?: number | null;
  lowestDataLimitBytes?: number | null;
  smsUsedCount?: number | null;
  smsLimitCount?: number | null;
  lowestSmsLimitCount?: number | null;
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
