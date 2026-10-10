# Een nieuwe simkaartleverancier toevoegen

> **Belangrijk** — Wijzig **nooit** de bestaande `SimhuisAdapter`, de MockAdapter of
> de centrale service-logica. Jouw adapter leeft in een **eigen map** en wordt
> op één plek geregistreerd. De bestaande Simhuis-koppeling moet altijd
> ongewijzigd en functioneel blijven.

Overzicht van de stappen:

1. [Provider-folder en adapter maken](#1-provider-folder-en-adapter-maken)
2. [Capabilities correct invullen](#2-capabilities-correct-invullen)
3. [Interface `SimProviderAdapter` implementeren](#3-interface-simprovideradapter-implementeren)
4. [Adapter registreren in het leveranciersregister](#4-adapter-registreren-in-het-leveranciersregister)
5. [Configuratie en veilige opslag van inloggegevens](#5-configuratie-en-veilige-opslag-van-inloggegevens)
6. [Foutvertaling en time-outs](#6-foutvertaling-en-time-outs)
7. [Webhooks (indien van toepassing)](#7-webhooks-indien-van-toepassing)
8. [Tests schrijven](#8-tests-schrijven)
9. [Activeren in de beheeromgeving](#9-activeren-in-de-beheeromgeving)

---

## 1. Provider-folder en adapter maken

Elke leverancier krijgt een eigen, *geïsoleerde* map:

```
src/server/providers/
├── capabilities.ts          (bestaat, niet wijzigen)
├── errors.ts                (bestaat, niet wijzigen)
├── types.ts                 (bestaat, niet wijzigen)
├── registry.ts              (bestaat, alleen registreren)
├── simhuis/adapter.ts       (bestaat, NIET WIJZIGEN)
├── mock/adapter.ts          (test-only, NIET WIJZIGEN)
└── jouwleverancier/
    └── adapter.ts           ← NIEUW
```

Minimum-skelet:

```ts
// src/server/providers/jouwleverancier/adapter.ts
import { PROVIDER_CAPABILITIES_NONE, type SimProviderCapabilities } from '../capabilities';
import type { SimProviderAdapter /*, ... andere types */ } from '../types';
import {
  ProviderApiError,
  ProviderAuthenticationError,
  ProviderTimeoutError,
  ProviderNotConfiguredError,
} from '../errors';

// Kies een korte, unieke, URL-veilige key (lowercase, geen spaties).
export const JOUWLEVERANCIER_KEY = 'jouwleverancier' as const;

// Begin leeg, zet per feature op true wanneer die ook ECHT werkt.
const CAPABILITIES: SimProviderCapabilities = {
  ...PROVIDER_CAPABILITIES_NONE,
  // Zet hier per capability true in als hij werkt.
};

export class JouwLeverancierAdapter implements SimProviderAdapter {
  public readonly providerKey = JOUWLEVERANCIER_KEY;
  public readonly displayName = 'Jouw Leverancier B.V.';
  public readonly capabilities = CAPABILITIES;

  // Verder: methode-implementaties. Zie §3.
}

export const jouwLeverancierAdapter = new JouwLeverancierAdapter();
```

---

## 2. Capabilities correct invullen

Een `capability` = een expliciete belofte dat die feature ook werkelijk is
geïmplementeerd. De centrale applicatie gooit **altijd** een
`ProviderCapabilityNotSupportedError` zodra een capability `false` is.

Beschikbare capabilities (allen standaard `false` via `PROVIDER_CAPABILITIES_NONE`):

| Capability | Betekenis |
|---|---|
| `listSims` | Lijst met alle SIMs opvragen |
| `getSimStatus` | Status van 1 SIM opvragen (per ICCID) |
| `getSimStatusFast` | Snelle lifecycle-only status (optioneel) |
| `activateSim` | SIM activeren |
| `deactivateSim` | SIM deactiveren |
| `suspendSim` | SIM schorsen |
| `unsuspendSim` | Schorsing opheffen |
| `subscribeToProduct` | Product/aanbieding toekennen |
| `precheckProductAvailability` | Controleren of product past |
| `getAssetByIccid` | Asset/account-id opzoeken |
| `purgeAsset` | DESTRUCTIEF: asset verwijderen |
| `syncUsage` | Verbruik synchroniseren |
| `testConnection` | Een **alleen-lezen** verbindingstest |
| `supportsIdempotency` | API accepteert idempotency-key mutaties |
| `supportsWebhooks` | Leverancier stuurt webhooks |
| `supportsDefaultProducts` | Levert `getDefaultProducts()` op |

> Vrij harde regel: een capability staat alleen `true` als er een echte
> geautomatiseerde test voor is geschreven (zie §8).

---

## 3. Interface `SimProviderAdapter` implementeren

Zie `src/server/providers/types.ts` voor de actuele signatures.

De **belangrijkste regels**:

1. De centrale applicatie gebruikt **jouw returned `ProviderSimStatus`**.
   Je moet dus de *vendor-specifieke* status-waardes vertalen naar de
   universele `ProviderSimLifecycle` (`active | inactive | suspended | terminated | provisioning | null`).
2. Velden die je niet hebt, geef je de waarde `null` mee (niet verplicht).
3. **Geen `ProviderCapabilityNotSupportedError` zelf gooien** — dat doet de
   registry al vóór jou. Jouw methode mag er daarom van uitgaan dat ze
   alleen wordt aangeroepen als de capability `true` is.
4. Gooi bij fouten een subclass van `ProviderError` (zie §6).
5. **Geheimen** (tokens, wachtwoorden) komen **nooit** in returned `raw`-
   waardes en **nooit** in `console.log` / `console.error`-berichten.
   Gebruik `ProviderError.safeMessage` voor berichten die naar de UI mogen.

### Adapter `this` en HMR

De registry verwacht een **objectliteral** of **geïnstantieerde class**
(singleton). Exporteer altijd een vaste instantie, zodat registry-verwijzingen
niet breken na HMR of reloads.

---

## 4. Adapter registreren in het leveranciersregister

Open **(en alleen dit bestand, in SIMHUIS/MOCK sectie)**
`src/server/providers/registry.ts` en zoek de functie
`initializeProviderRegistry()`. Voeg daar een nieuwe `register()` call toe:

```ts
// Binnen initializeProviderRegistry(), NA de bestaande registers:
import { jouwLeverancierAdapter } from './jouwleverancier/adapter';
// ...
providerRegistry.register(jouwLeverancierAdapter, {
  // Initial-active? Meestal false, beheerder activeert via UI.
  initialActive: false,
});
```

De `initializeProviderRegistry` functie is **idempotent**; hij registreert
elke adapter precies één keer, zelfs na HMR in Next.js dev-mode.

---

## 5. Configuratie en veilige opslag van inloggegevens

### 5a. AppSetting-strategie (automatisch)

Het centrale systeem slaat instellingen plat op in de `AppSetting`-tabel,
met key-formaat `{providerKey}.{subkey}`. Bijvoorbeeld:

| AppSetting.key | Omschrijving |
|---|---|
| `jouwleverancier.baseUrl` | Basis-URL van de API |
| `jouwleverancier.authMode` | `api_token` \| `password` \| `oauth_client_credentials` |
| `jouwleverancier.username` | Gebruikersnaam (bij password-mode) |
| `jouwleverancier.password` | Wachtwoord (wordt **automatisch** als geheim opgeslagen) |
| `jouwleverancier.apiToken` | API-token (wordt **automatisch** als geheim opgeslagen) |
| `jouwleverancier.clientId` | OAuth client-ID |
| `jouwleverancier.clientSecret` | OAuth client-secret (geheim) |
| `jouwleverancier.webhookSecret` | Webhook-handtekening-geheim (geheim) |
| `jouwleverancier.resellerId` | Reseller / partner ID |
| `jouwleverancier.defaults.defaultOfferId` | Default aanbieding |
| `jouwleverancier.endpoints.listSims` | Custom endpoint-pad (start met `/`) |

> **Subkeys** die `password`, `secret`, `token` of `key` bevatten, **worden
> automatisch** opgeslagen met `isSecret=true`. De beheer-UI toont hiervan
> allen de laatste 4 tekens, en in logs zijn ze nooit zichtbaar.

### 5b. Uitlezen van instellingen in jouw adapter

Gebruik de service helpers (**geen direct prisma**):

```ts
import { getProviderSettings } from '@/server/services/app-setting.service';

const settings = await getProviderSettings(this.providerKey);
// settings = { baseUrl?: string, apiToken?: string, password?: string, ... }
```

### 5c. Fallback via omgevingsvariabelen (altijd ook gebruiken!)

De bestaande service zoekt automatisch in `process.env` volgens het patroon
`{UPPERCASE_PROVIDERKEY}_{UPPERCASE_SUBKEY}`, en verder nog in `SIMHUIS_*`
als `providerKey === 'simhuis'` (backward compat).

Voorbeeld: Jouw adapter met key `telia` zoekt automatisch `TELIA_API_TOKEN`
en `TELIA_BASE_URL` wanneer de AppSetting leeg is.

### 5d. `isConfigured()` implementeren

Gebruik hiervoor bij voorkeur de helper:

```ts
import { isProviderConfiguredInEnvOrSettings } from '@/server/services/app-setting.service';

async isConfigured(): Promise<boolean> {
  return isProviderConfiguredInEnvOrSettings(this.providerKey, ['baseUrl', 'apiToken']);
  // OF custom, wanneer je authMode hebt:
  // return customIsConfiguredCheck();
}
```

---

## 6. Foutvertaling en time-outs

Gebruik altijd de exception-subclasses uit `src/server/providers/errors.ts`:

| Exception | Wanneer gebruiken |
|---|---|
| `ProviderNotConfiguredError` | `isConfigured()` returned false, toch een actie |
| `ProviderNotActivatedError` | Leverancier is gedeactiveerd in de UI |
| `ProviderCapabilityNotSupportedError` | Wordt door de registry gegooid — NIET door jou |
| `ProviderAuthenticationError` | 401 / 403 / ongeldig token / ongeldig wachtwoord |
| `ProviderTimeoutError` | AbortSignal.timeout() of `fetch` time-out |
| `ProviderApiError` | Overige 4xx / 5xx, of ongeldig response-formaat |

Vermeld **nooit** een geheim in de `message` van de exception. Gebruik
desgewenst `detail` of `raw` voor technische info (die niet naar de UI gaat).
De `safeMessage` is wat gebruikers / beheerders mogen lezen.

### Time-outs

Gebruik **geen harde `setTimeout`**. Gebruik `AbortSignal.timeout()`:

```ts
try {
  const res = await fetch(fullUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15_000), // 15 seconden
  });
} catch (e) {
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    throw new ProviderTimeoutError(
      'Verbinding met JouwLeverancier-API verliep na 15s.',
      this.providerKey,
    );
  }
  // ... anders verder
}
```

### Idempotentie (mutaties)

Als `supportsIdempotency === true`: neem een `Idempotency-Key` header op,
gebaseerd op `iccid + operatie + volgnummer` of UUID.
Als `supportsIdempotency === false` — **geen retry voor mutaties doen.** De
centrale scheduler/webhook-laag doet automatisch LRU-dedup op event-id
bij webhooks.

---

## 7. Webhooks (indien van toepassing)

Wanneer `supportsWebhooks === true`, implementeer je `handleWebhook()`.

```ts
async handleWebhook(
  payload: unknown,
  headers: Record<string, string | string[] | undefined>,
  signature?: string,
): Promise<ProviderWebhookResult> {
  // 1. Handtekening VALIDEREN. Faal hard (gooi of return ok=false)
  //    indien de handtekening ongeldig is. GEEN partial processing.
  // 2. Parse payload. Lees eventId uit (body.id of x-webhook-id header).
  // 3. Map event-type naar interne acties: SIM_ACTIVATED, SUSPENDED, etc.
  // 4. Verrijk eventueel met de ICCID.
  return {
    ok: true,
    handled: true,
    eventId: 'evt_xxxxx',
    eventType: 'sim.activated',
    iccid: '89...',
    subscriberId: 'SUB001',
    safeMessage: 'Activatie-event verwerkt',
    // Geheimen hier NIET in raw.
  };
}
```

De gedeelde webhook-route op `POST /api/integrations/providers/[providerKey]/webhook`
geeft de call automatisch door aan jouw adapter. Bij gedeactiveerde
provider wordt meteen 403 + header `X-Sim-Provider-Disabled: 1` teruggegeven
(= jouw code wordt dan NIET aangeroepen; lopende webhooks bij leverancier
kunnen dus ook geen effect meer sorteren).

**Dedup** — Wanneer `supportsIdempotency === false` houdt de gedeelde route
zelf een LRU-cache (2000 entries, 10 minuten) bij per
`(providerKey, eventId)`. Stuur dus altijd `eventId` terug.

---

## 8. Tests schrijven

Minimaal één bestand: `tests/providers-<providerKey>-adapter.test.ts`.

### Wat testen (minimale set)

1. **Capabilities** — wel/niet ondersteund.
2. **`listSims()`** — geeft geldige `ProviderSimStatus[]`, lifecycle-mapping
   voor alle vendor-stati.
3. **`getSimStatus(iccid)`** — happy path, onbekende ICCID.
4. **`activateSim()` / `deactivateSim()` / `suspendSim()` / `unsuspendSim()`** —
   roepen de juiste API met de juiste parameters; mappen status correct.
5. **Foutpaden** — 401 → `ProviderAuthenticationError`, 500 → `ProviderApiError`,
   timeout → `ProviderTimeoutError`.
6. **Geheim-dump** — een gegooid `ProviderError` / response logs / safeMessage
   bevat NOOIT `password`, `token` of `secret`.
7. **`testConnection()`** — doet uitsluitend een GET (GEEN MUTATIES).
8. **Webhook signature** — vervalste/ontbrekende handtekening → `ok=false`
   en GEEN neveneffecten.

### Gebruik van de MockAdapter als referentie

De [MockAdapter](../src/server/providers/mock/adapter.ts) toont hoe je een
volledige adapter opzet ZONDER externe API, en hoe je `purgeAsset=false`
laat falen via de registry-guards. Zie ook
`tests/providers-mock-adapter.test.ts` voor het testpatroon.

### `vi.stubGlobal('fetch', ...)` voor echte API-calls

Voor de adapters met echte HTTP:

```ts
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
```

Geef nooit een echt token op in test-bestanden. Gebruik dummy-waardes
(`test-token`, `https://test.jouwleverancier.test`).

### Uitvoeren

```bash
npx vitest run tests/providers-<jouwkey>-adapter.test.ts
```

Verifieer na elke wijziging ook de **volledige regressie-suite**:

```bash
npx vitest run
```

---

## 9. Activeren in de beheeromgeving

Zodra code is gedeployed:

1. Log in als beheerder met **`setting.edit`** of **`sim.edit`** permissie.
2. Ga via de zijbalk naar **Beheer → Leveranciers**
   (`/admin/providers`). Jouw nieuwe leverancier staat hier tussenin
   (status: *Geregistreerd*, NIET actief).
3. Vul in het uitklap-formulier de basis-URL, auth-mode, credentials en
   eventueel custom endpoints in. Opslaan gebeurt versleuteld/als geheim
   voor de gevoelige velden.
4. Klik op **Verbinding testen**. Wanneer `testConnection()` onmogelijk is
   zonder lees-schrijf, stel dan `capabilities.testConnection=false` in;
   de UI toont dan een mededeling dat de test niet wordt ondersteund.
5. Klik op **Activeren**. Vanaf nu wordt jouw provider in de wizard, de
   sync-routes en webhooks meegenomen.

Standaard blijven **bestaande SIMs, bestellingen en processen** Simhuis
gebruiken (via backfill en fallback). Nieuwe SIMs krijgen jouw leverancier
alleen als `providerKey` expliciet wordt gezet of als jouw leverancier in
de wizard voor het eerst wordt gekozen.

---

## Checklist voor deploy

- [ ] Migraties zijn toegepast in de juiste volgorde (DDL vóór code).
- [ ] `npx prisma migrate status` toont de nieuwe migratie als *applied*.
- [ ] Backfill SQL is gevalideerd (0 onverklaarbare `providerKey IS NULL`).
- [ ] Volledige test-suite `npx vitest run` = **GEEN** provider-regressies.
- [ ] Beveiligings-audit: grep naar `console.log.*password\|token\|secret`
      in jouw adapter map — zou **niets** mogen teruggeven.
- [ ] De beheerder heeft de module eerst in een acceptatie-omgeving
      geactiveerd vóór productie.
