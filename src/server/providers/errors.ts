/**
 * Modulair Leverancierssysteem — Errors
 * ---------------------------------------
 * Alle excepties die adapters naar de centrale laag gooien, type-safe.
 *
 * REGEL: Geen van deze fouten bevat credentials of raw response bodies
 * in de (user-facing) `message`. Alle interne details gaan in `raw` / `detail`
 * en mogen uitsluitend in server-side logs belanden (NOOIT in NextResponse JSON).
 */

export type ProviderErrorKind =
  | 'GENERIC'
  | 'NOT_CONFIGURED'
  | 'NOT_ACTIVATED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'AUTHENTICATION_FAILED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'PROVIDER_REJECTED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT';

export class ProviderError extends Error {
  public readonly kind: ProviderErrorKind;
  public readonly httpStatus?: number;
  public readonly safeMessage: string;
  /** Bevat geen credentials; wel provider-specifieke codes voor logging. */
  public readonly detail?: unknown;

  constructor(
    kind: ProviderErrorKind,
    safeMessage: string,
    opts: { httpStatus?: number; cause?: unknown; detail?: unknown } = {},
  ) {
    super(safeMessage);
    this.name = 'ProviderError';
    this.kind = kind;
    this.safeMessage = safeMessage;
    this.httpStatus = opts.httpStatus;
    this.detail = opts.detail;
    if (opts.cause !== undefined) {
      // V8 cause chain (Node 16.9+ / modern TS targets)
      (this as unknown as { cause?: unknown }).cause = opts.cause;
    }
  }
}

// --- Subclasses voor instanceof guards in de centrale logica ---
export class ProviderNotConfiguredError extends ProviderError {
  constructor(providerKey: string) {
    super('NOT_CONFIGURED', `Leverancier “${providerKey}” is nog niet geconfigureerd (ontbrekende inloggegevens).`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderNotActivatedError extends ProviderError {
  constructor(providerKey: string) {
    super(
      'NOT_ACTIVATED',
      `Leverancier “${providerKey}” is gedeactiveerd. Nieuwe acties zijn geblokkeerd; activeer de module in Beheer → Providers om verder te gaan.`,
    );
    this.name = 'ProviderNotActivatedError';
  }
}

export class ProviderCapabilityNotSupportedError extends ProviderError {
  constructor(providerKey: string, capability: string) {
    super(
      'CAPABILITY_NOT_SUPPORTED',
      `De actie “${capability}” wordt niet ondersteund door leverancier “${providerKey}”.`,
    );
    this.name = 'ProviderCapabilityNotSupportedError';
  }
}

export class ProviderAuthenticationError extends ProviderError {
  constructor(providerKey: string, safeExtra: string = 'Controleer de inloggegevens in Beheer → Providers.') {
    super('AUTHENTICATION_FAILED', `Authenticatie mislukt voor leverancier “${providerKey}”. ${safeExtra}`);
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(providerKey: string, endpoint?: string) {
    const suffix = endpoint ? ` (endpoint: ${endpoint})` : '';
    super('TIMEOUT', `Time-out bij leverancier “${providerKey}”${suffix}. Probeer het later opnieuw.`);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderApiError extends ProviderError {
  /** @param safeMessage  — NOOIT credentials of gevoelige response-bodies bevatten */
  constructor(
    providerKey: string,
    safeMessage: string,
    httpStatus: number,
    opts: { detail?: unknown } = {},
  ) {
    super('PROVIDER_REJECTED', `Leverancier “${providerKey}” weigerde het verzoek: ${safeMessage}`, {
      httpStatus,
      detail: opts.detail,
    });
    this.name = 'ProviderApiError';
  }
}
