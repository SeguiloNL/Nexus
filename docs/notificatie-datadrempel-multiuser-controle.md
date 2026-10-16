# Notificatie "Datadrempel SIM-kaarten" — multi-user controle

## Aanleiding

Vermoeden: wanneer meerdere gebruikers de notificatie "Datadrempel SIM-kaarten"
in hun profiel activeren, ontvangt slechts één van hen de notificatie. Doel van dit
onderzoek was te verifiëren of de notificatie correct naar **alle** geactiveerde
gebruikers wordt verzonden, de vermoede fout te reproduceren, de hoofdoorzaak te
bepalen en indien nodig op te lossen.

**Uitkomst:** het vermoede fan-out-probleem ("slechts één ontvanger") treedt in de
huidige code **niet** op. Alle geactiveerde gebruikers ontvangen de notificatie. Er
zijn wel twee gerelateerde aandachtspunten gevonden (zie *Actuele aandachtspunten*).

## Analyse van code en datastructuur

Er is precies één verzendpad voor deze notificatie:
`runUsageAlertNotificationCycle` in `src/server/services/sim-usage-alert.service.ts`.

Alle drie de triggers roepen dezelfde service aan (met `limitUsers: undefined`, dus
de default van 2000) — er is geen aparte queue of per-gebruiker worker:

| Trigger | Locatie |
| --- | --- |
| API-route (systemd-timer / polling-bridge) | `src/app/api/integrations/simhuis/notify-usage-alerts/route.ts` |
| Handmatige run (Instellingen) | `src/app/(app)/settings/actions.ts` (`SIMHUIS_USAGE_ALERT_NOTIFY`) |
| Tijdens usage-sync | `src/server/services/simhuis-sim-sync.service.ts` |

De multi-user mechanica is correct geïmplementeerd:

- **Selectie** gebeurt met `findMany` (niet `findFirst`) op
  `enabledEmail + enabledDataThresholdAlert + user.isActive`.
- **Verwerking** itereert over alle gebruikers (`for (const row of users)`) met
  per-gebruiker `try/catch`-isolatie: een fout bij één gebruiker stopt de cyclus niet.
- **Anti-spam guard** is per gebruiker gekeyd: `alertKeyOf` bevat `userId`, en de
  database-unique constraint is `[userId, simId, thresholdLevel, usagePeriodStart]`
  (`prisma/schema.prisma`, model `SimUsageAlert`).
- **Interval-guard** gebruikt `lastNotificationAt` per gebruiker.

Er bestaat naast `UserNotificationSettings` en `SimUsageAlert` geen tweede
notificatiemodel of losse dispatch-service.

## Reproduktie en resultaat

De bestaande testsuite `tests/sim-usage-alert-multi-user.test.ts` reproduceert exact
het gevraagde scenario: 3 gebruikers met de notificatie aan en 1 SIM boven 100%.

- Asserts: `usersChecked === 3`, `usersNotified === 3`, `sentEmails.length === 3`
  en de ontvangerslijst bevat alle drie de adressen.
- **Resultaat: 8/8 tests slagen.** Er ontvangt dus niet "slechts één" gebruiker; alle
  drie ontvangen een e-mail.

## Hoofdoorzaak

### Historisch — reeds opgelost (commit `b4e89ae`)

Vóór commit `b4e89ae` was de body van de per-gebruiker lus **niet** in `try/catch`
gewikkeld. Eén onverwachte fout bij het verwerken van een gebruiker (bijvoorbeeld in
`collectUserCustomerIds`, de alert-create of de e-mailverzending) brak de **hele
cyclus** af, waardoor alle ná die gebruiker volgende ontvangers géén e-mail kregen.
Dat gedrag verklaart exact het symptoom "alleen de eerste gebruiker ontvangt iets".

Commit `b4e89ae` ("test(sim-usage-alert): add multi-user notification test suite")
heeft dit verholpen door per-gebruiker foutisolatie toe te voegen én de multi-user
testsuite te introduceren. De diff van die commit raakt uitsluitend deze isolatie en
de tests; de lus over gebruikers bestond al.

### Actuele aandachtspunten

1. **Lege klantenscope → stil overslaan.** Een gebruiker met een lege effectieve
   scope wordt overgeslagen met de melding "Lege customer scope". `collectUserCustomerIds`
   (`src/lib/rbac.ts`) levert alleen direct gekoppelde klanten plus hun hiërarchie. Een
   admin/medewerker die de alert activeert maar niet aan de klanten van de over-limiet
   SIM's is gekoppeld (en `notifyAllSims` uit heeft) ontvangt **niets**. Dit geeft
   hetzelfde symptoom als het vermoede fan-out-probleem, maar is scope-gedrag en geen
   fout in de verzendlogica.

2. **Expliciete opt-out wordt overschreven.** `getAllEligibleUsersWithDefaults`
   (`src/server/services/sim-usage-alert.service.ts`) sluit in de "implicit"-bucket
   alleen gebruikers uit die als *explicit* gelden (`enabledEmail && enabledDataThresholdAlert`).
   Een gebruiker met een instellingenrij waarin de alert **expliciet is uitgeschakeld**
   valt daardoor in de "implicit"-bucket en krijgt daar de default
   `enabledDataThresholdAlert: true`. Gevolg: wie de notificatie uitzet, ontvangt hem
   alsnog (over-verzending, tegenovergesteld aan het vermoeden). — **opgelost**, zie
   *Oplossing*.

## Oplossing

Voor het onderzochte fan-out-probleem is **geen codewijziging nodig**: dit is reeds
opgelost in `b4e89ae` en gedekt door de multi-user testsuite.

**Opt-out-fix (doorgevoerd).** Het tweede aandachtspunt is opgelost.
`getAllEligibleUsersWithDefaults` (`src/server/services/sim-usage-alert.service.ts`)
sloot in de "implicit"-bucket voorheen alleen gebruikers met een *ingeschakelde*
instellingenrij uit, waardoor een gebruiker met een expliciete opt-out alsnog de default
`enabledDataThresholdAlert: true` kreeg. De functie bepaalt nu de volledige set
gebruikers die een instellingenrij hebben en sluit die integraal uit van de
implicit-defaults. Alleen gebruikers **zonder** instellingenrij krijgen nog
default-waarden, zodat een expliciete keuze (aan of uit) altijd leidend is.

Het eerste aandachtspunt (scope-skip) is **niet** gewijzigd; dit vereist een
inhoudelijke afweging (gedrag/UX) en staat hier gedocumenteerd als openstaand punt.

## Testresultaten

| Scope | Resultaat |
| --- | --- |
| `tests/sim-usage-alert-multi-user.test.ts` | 9/9 pass |
| Volledige suite (`npx vitest run`) | 368/369 pass |

De testsuite is uitgebreid met een regressietest die verifieert dat een gebruiker met een
expliciete opt-out géén e-mail ontvangt, terwijl een gebruiker zonder instellingenrij
(impliciete default) dat wél doet. De enige failure in de volledige suite is een
bestaande, ongerelateerde timing-test in `tests/inserve-client.test.ts` (429 rate-limit
retry) en staat los van notificaties. `npx tsc --noEmit` geeft geen typefouten in de
gewijzigde bestanden.

## Openstaande punten / aanbevelingen

1. Bepaal of een gebruiker met een lege klantenscope een expliciete melding of
   fallback moet krijgen in plaats van stilzwijgend overgeslagen te worden.

*(Het opt-out-punt is opgelost — zie Oplossing.)*

## Referenties

- Service: `src/server/services/sim-usage-alert.service.ts`
- Tests: `tests/sim-usage-alert-multi-user.test.ts`
- Schema: `prisma/schema.prisma` (`UserNotificationSettings`, `SimUsageAlert`)
- RBAC-scope: `src/lib/rbac.ts` (`collectUserCustomerIds`)
- Fix/aanleiding: commit `b4e89ae`
