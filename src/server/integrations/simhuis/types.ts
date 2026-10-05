export type SimhuisAuthMode = 'basic' | 'bearer';

export type UsageSource = 'BUNDLE_COUNTER' | 'CDR_STATS' | 'UNKNOWN' | 'NONE';

export interface SimhuisBundleUsage {
  bundleId?: string | null;
  localProductId?: string | null;
  localProductName?: string | null;
  productName?: string | null;
  sharedDataPoolId?: string | null;
  dataUsedBytes?: number | null;
  remainingBytes?: number | null;
  initialSizeBytes?: number | null;
  smsUsedCount?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  isActiveNow?: boolean | null;
  isExpired?: boolean | null;
  isFuture?: boolean | null;
  subscriptionIndex?: number;
  bundleIndex?: number;
  rawBundle?: unknown;
}

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
  usageSource?: UsageSource;
  usageBundleId?: string | null;
  usageLocalProductId?: string | null;
  usageLocalProductName?: string | null;
  usagePeriodStart?: string | null;
  usagePeriodEnd?: string | null;
  usageRetrievedAt?: string | null;
  usageCdrQueryStart?: string | null;
  usageCdrQueryEnd?: string | null;
  usageBundleUsages?: SimhuisBundleUsage[] | null;
  usageSelectionNote?: string | null;
}

export interface ActivateSimOptions {
  iccid: string;
  offerId?: string | null;
  planId?: string | null;
  resellerId?: string | null;
  customerRef?: string | null;
}

export type SimhuisAssetErrorKind =
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'INVALID_ACCOUNTID'
  | 'PROVIDER_REJECTED'
  | 'TIMEOUT_OR_NETWORK';

export interface SimhuisAssetActionResult {
  ok: boolean;
  rawPut: unknown;
  rawGet: unknown;
  confirmedSimhuisStatus?: string | null;
  accountIdUsed: string | null;
  httpStatusPut?: number;
  error?: {
    kind: SimhuisAssetErrorKind;
    detail: string;
    httpStatus?: number;
  };
}

export interface SimhuisSubscribeOptions {
  productId: string;
  subscriberAccountId: string;
  startTime?: string;
  ipPools?: string[] | Record<string, string>;
}

export type SimhuisSubscribeErrorKind =
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'INVALID_ACCOUNTID'
  | 'PRODUCT_MISMATCH'
  | 'PRODUCT_UNAVAILABLE_FOR_ICCID'
  | 'PROVIDER_REJECTED'
  | 'MISSING_PROVISIONING_SETTINGS'
  | 'TIMEOUT_OR_NETWORK';

export interface SimhuisSubscribeResult {
  ok: boolean;
  rawPut: unknown;
  rawGet: unknown;
  accountIdUsed: string | null;
  httpStatusPut?: number;
  confirmedSimhuisStatus?: string | null;
  confirmedLocalProductId?: string | null;
  confirmedLocalProductName?: string | null;
  error?: {
    kind: SimhuisSubscribeErrorKind;
    detail: string;
    httpStatus?: number;
  };
}

export interface SimhuisLoginResponse {
  token?: string;
  access_token?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export interface SimhuisDiagnosticNotice {
  code?: string | number | null;
  message?: string | null;
  severity?: string | null;
  [key: string]: unknown;
}

export interface SimhuisDiagnosticResult {
  result?: string | number | boolean | null;
  description?: string | null;
  notice?: SimhuisDiagnosticNotice[] | null;
  provisioning?: {
    status?: string | null;
    [key: string]: unknown;
  } | null;
  network?: {
    lastRegistration?: {
      startTime?: string | null;
      mcc?: string | number | null;
      mnc?: string | number | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  data?: {
    apn?: string | null;
    ip?: string | null;
    liveDataSession?: {
      startTime?: string | null;
      lastSessionUpdate?: string | null;
      type?: string | null;
      provider?: string | null;
      [key: string]: unknown;
    } | null;
    lastActiveSession?: {
      startTime?: string | null;
      endTime?: string | null;
      outcome?: string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface SimhuisApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: unknown;
  message?: string;
  [key: string]: unknown;
}
