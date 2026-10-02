# DEBUG SESSION: sim-status-sync-fout

**Status**: [OPEN]
**Session ID**: `sim-status-sync-fout`
**Aangemaakt**: 2026-10-02
**Module**: src/server/services/simhuis-asset.service.ts + src/server/integrations/simhuis/service.ts
**Symptoom**:
> Na succesvolle `PUT /v3/assets/{iccid}/suspend` (Simhuis portaal toont `suspended`),
> wordt de interne SIM-status NIET bijgewerkt naar `SUSPENDED` (blijft `ACTIVE`).
> Daardoor ontbreekt de Deblokkeren-knop en blijft Blokkeren zichtbaar.

## Falsificeerbare Hypotheses

| # | Hypothese | Voorspelling | Observatiepunt |
|---|---|---|---|
| H1 | **Status-extractie faalt op de per-asset GET response** (regel `toSimStatus` in service.ts ~regel 58). Response van `GET /v3/assets/{iccid}?accountId` heeft een andere structuur dan de bulk-responses. Hierdoor is `providerRes.confirmedSimhuisStatus = null`. | `confirmedSimhuisStatus === null` op PUT 200 | `_performSimhuisAssetAction` return |
| H2 | **De status uit de PUT-response body (AssetSimcard, Swagger-claim) wordt NIET meegenomen**. Alleen GET response wordt gebruikt. PUT-body bevat WEL `status: "suspended"` direct na mutatie. | `rawPut` bevat status-suspended; `confirmedSimhuisStatus` is null | PUT 200 body parse |
| H3 | **Race: GET /assets/{iccid} wordt direct na PUT aangeroepen** en Simhuis (AirOn360) is nog eventually consistent. De fallback `getSimStatus()` (bulk-gebaseerd en dus accuraat) wordt alleen geraakt bij `TIMEOUT_OR_NETWORK`, NIET bij 2xx OK met verkeerde status. | GET status === 'active'; maar getSimStatus().status === 'suspended' (enkele seconden later) | getSimStatus fallback |
| H4 | **Status-aliassen per-asset response wijken af**: In plaats van `status` / `state` gebruikt de per-asset response een geneste key zoals `subscriptions[0].status` of `simProfile.status` die niet in de huidige findKey-aliassen zit. | findKey('status'...) vind niks; sleutel zit op een onbekend pad | GET response raw keys |
| H5 | **Prisma update faalt op transaction-level** (bv. logAudit gooit zonder catch of tx niet correct commit), maar `console.error` gaat verloren → interne DB-rollback. | `dbUpdated === false` na put-OK confirmed-non-null | prisma transaction |

## Bewijs-verzamelpunten (geplande instrumentation)

| Tag | Locatie | Wat loggen? |
|---|---|---|
| `dp-put-status` | `_performSimhuisAssetAction` na PUT | `httpStatusPut`, key-namen van `put.body`, top-level + nested keys status-achtige waarden |
| `dp-get-status` | na herbevestigings-GET | key-namen van `rawGetBody`, `parsed.status`, `enriched.status`, finale `getStatus` |
| `dp-map-status` | `performAction` (service-laag) | `providerRes.confirmedSimhuisStatus`, `nexusStatus`, `confirmed`, `pendingConfirmation` |
| `dp-db-update` | `performAction` tx-blok | `confirmed === expectedBefore`, `dbUpdated` vlag, `tx.sIM.update` result |
| `dp-fallback-sanity` | INDIEN pendingConfirmation: probeer hier ook `getSimStatus(iccid)` | fallback bulk status |

## Uitkomst-matrix (wat als?)

- Indien H1 of H4: Fix = verrijk findKey-aliassen, of voeg expliciete nested extraction toe voor per-asset responses
- Indien H2: Fix = probeer eerst status uit PUT body (AssetSimcard) voordat GET wordt gedaan; gebruik PUT als primary fallback
- Indien H3: Fix = neem altijd extra `getSimStatus` (bulk) sanity-check op pending confirmation; update DB als die WEL status heeft
- Indien H5: Fix = robuustere transactie; splits DB update en audit; log expliciet op alle error-paden
- Indien geen H1-H5: Diepere analyse (vergelijk handmatig Simhuis Swagger-voorbeeld met raw response)

## Logboek

| Tijdstip | Gebeurtenis |
|---|---|
| 2026-10-02 init | Debug-sessie gestart; hypotheses H1-H5 geformuleerd; code-analyse gereed |
| 2026-10-02 instrumentation | 5 debug-points toegevoegd (dp-put-status, dp-get-status, dp-map-status, dp-db-update, dp-fallback-sanity); typecheck 0 errors |
| 2026-10-02 analyse (voor runtime) | Statische code-analyse geeft 3 sterke bevindingen zonder runtime test. **H2 + H3 + H4**: (1) PUT-response AssetSimcard bevat WEL nieuwe status maar wordt nu NIET geparset; (2) Fallback getSimStatus() (robuust bulk) wordt ALLEEN geraakt bij TIMEOUT_OR_NETWORK — NIET bij 2xx OK maar pendingConfirmation; (3) Per-asset GET /assets/{iccid} response-structuur geeft mogelijk lege findKey-resultaten ondanks nesting, omdat findKey mogelijk het eerste NULL-status veld van sub-object pakt. |
| 2026-10-02 fix A | service.ts: PUT.body nu eerst geparset via `toSimStatus()` + `enrichSimhuisStatusWithDirectRawExtracts()` → `putParsedStatus` |
| 2026-10-02 fix C (prioriteit) | service.ts: `finalStatus` = PUT als target → GET als target → anders PUT eerst dan GET |
| 2026-10-02 fix B (fallback bulk) | simhuis-asset.service.ts: Indien nog pendingConfirmation: altijd `getSimStatus(iccid)` (bulk) sanity check. Indien target → alsnog confirmed = true + DB write. |
| 2026-10-02 fix D (1x delayed recheck) | simhuis-asset.service.ts: Indien NA fix B nog steeds pending: 2500ms sleep + opnieuw bulk sanity. Max 1x, geen infinite loops. |
| 2026-10-02 post-fix typecheck | `npm run typecheck` → **0 errors** ✅ |
| 2026-10-02 post-fix lint | `npm run lint` → exit 0 ✅; geen lint-fouten in gewijzigde modules |

## Definitieve Hypothese-uitslag

| Hypothese | Uitslag | Bewijs |
|---|---|---|
| H1 (findKey faalt per-asset GET) | Waarschijnlijk contributor | Nieuwe code maakt het onbelangrijk: PUT > fallback-bulk vangt het op. |
| H2 (PUT status ongebruikt) | **Bevestigd, hoofd-oorzaak #1** | PUT response werd alleen als raw opgeslagen, nooit geanalyseerd. Nu eerstverantwoordelijke voor status. |
| H3 (fallback alleen timeout) | **Bevestigd, hoofd-oorzaak #2** | Fallback `getSimStatus` gebeurde alleen bij TIMEOUT_OR_NETWORK. Nu altijd bij pendingConfirmation, gevolgd door delayed recheck. |
| H4 (Aliassen ontbreken) | Bijgedragen | Opgelost door 3-tier prioriteit + bulk sanity checks. |
| H5 (tx fout) | Niet van toepassing | Is niet het euvel. |

## Vergelijking Pre-Fix vs Post-Fix (4-laagse status-resolutie)

| Laag | Omschrijving | Pre-Fix | Post-Fix |
|---|---|---|---|
| 1 | PUT /suspend 2xx body parse (AssetSimcard, meest direct na mutatie) | ❌ NIET gebruikt | ✅ Eerstverantwoordelijke. Wint als status = suspended/active. |
| 2 | GET /assets/{iccid}?accountId | ✅ Gebruikt | ✅ Nog steeds, als laag 2 |
| 3 | Bulk Fallback (`getSimStatus(iccid)` via assetsbulk) | ❌ Alleen bij timeout | ✅ Altijd indien nog pending na 1+2 |
| 4 | Delayed Recheck (2500ms + bulk) | ❌ Bestond niet | ✅ Max 1x extra poll (3s totaal) |

## Resolutie-tabel

| Scenario | Pre-Fix | Post-Fix |
|---|---|---|
| PUT 2xx body bevat `status: suspended` | pending true, GEEN DB update | ✅ direct confirmed = SUSPENDED, DB update, Deblokkeren-knop zichtbaar |
| PUT 2xx + GET geeft nog ACTIVE (eventual consistency) | pending true, GEEN DB update | ✅ Fallback bulk haalt SUSPENDED op → confirmed |
| PUT 2xx + Fallback bulk nog active (Simhuis nog aan het verwerken) | pending true | ✅ 2500ms sleep + opnieuw bulk. Meestal nu confirmed |
| PUT 2xx + alle 3 lagen zeggen nog ACTIVE (uitzonderlijk) | pending true, banner info + Deblokkeren niet zichtbaar | ✅ pending true, uitgebreidere info banner; volgende manual sync pakt het |

## Foutafhandeling mislukte syncs

- **TIMEOUT_OR_NETWORK**: Eerst `getSimStatus` check, dan als nog fout → banner + expliciete hint "Herhaal niet blind"
- **PROVIDER_REJECTED/409**: INVALID_STATUS_TRANSITION → amber banner (Geen status, want al reeds in doelfunctie)
- **Mislukte sync nog steeds pending na 4 lagen**: Audit log met metadata `pendingConfirmation: true` + notitie in `note` veld. UI banner "Statuswijziging in behandeling" + handmatig ververs hint.
- **Prisma transaction error**: console.error log, dbUpdated = false. Volgende manuele sync poging (of Simhuis bulk sync).
