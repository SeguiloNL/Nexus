# Implementatieplan — Historisch dataverbruik (12 maanden vergelijken)

> Doel: het dashboard de mogelijkheid geven om het dataverbruik van **alle SIMs over de
> afgelopen 12 maanden** te vergelijken. Hiervoor wordt maandverbruik **per SIM** duurzaam
> opgeslagen, zodat het rolling 12-maandsvenster gevuld raakt zodra het systeem draait.

## 0. Scope & besluiten

| Onderdeel | Besluit |
|---|---|
| Historische maanden vóór uitrol | **Niet backfillen** — historie wordt vanaf uitrol opgebouwd |
| Opslagniveau | **Per SIM per maand** (volledige detailhistorie) |
| Dashboardweergave | **12-maandstrendgrafiek + maandselector**; bestaande maandtegel wordt detailweergave van de geselecteerde maand |
| Nieuwe permissie | **Niet nodig** — hergebruik bestaande `view_all_sim_usage_dashboard` |
| Nieuwe scheduler-timer | **Niet nodig** — snapshot loopt mee met de bestaande usage-sync (elke 5 min) |
| Retentie | **24 maanden** (constante; rolling window van 12 + buffer voor jaar-op-jaar) |

### Uitgangspunten uit de huidige architectuur

- De SIM-tabel bevat al periodevelden: `usagePeriodStart`, `usagePeriodEnd`, `usageSource`,
  `usageBundleUsages` ([schema.prisma](file:///Users/bas/Documents/trae_projects/STM/prisma/schema.prisma#L577-L594)).
- `dataUsedBytes` op een SIM is de **cumulatieve teller van de huidige periode** en reset bij
  een nieuwe bundel/periode. Daardoor is de **laatste waarneming vóór de reset** de maandtotaalwaarde.
- De usage-sync schrijft uitsluitend de actuele waarde en kent al change-detectie per SIM
  ([simhuis-sim-sync.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/simhuis-sim-sync.service.ts#L1470-L1620)).
- Providers leveren periodes aan via `ProviderSimStatus` (`usagePeriodStart/End`, `usageBundleUsages`)
  ([types.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/providers/types.ts#L43-L81)).

### Kernidee van de oplossing

Bij elke synchronisatie waarin het verbruik van een SIM wijzigt, wordt een snapshot
weggeschreven naar een nieuwe tabel `sim_monthly_usage`, **gekeyd op (SIM, maand)** met een
**monotone max-guard**. Omdat de maandsleutel bij een periode-reset verandert, blijft de rij van
de afgelopen maand automatisch "bevroren" op de laatst waargenomen (hoogste) waarde. Zo ontstaat
zonder aparte einde-maand-job een betrouwbare maandhistorie.

---

## 1. Datamodel

### 1.1 Nieuw model `SimMonthlyUsage`

Toevoegen aan [schema.prisma](file:///Users/bas/Documents/trae_projects/STM/prisma/schema.prisma):

```prisma
model SimMonthlyUsage {
  id              String    @id @default(cuid())
  simId           String
  sim             SIM       @relation(fields: [simId], references: [id], onDelete: Cascade)
  iccid           String    @db.VarChar(40)
  monthKey        String    @db.VarChar(7)   // 'YYYY-MM'
  periodStart     DateTime? @db.Timestamptz
  periodEnd       DateTime? @db.Timestamptz
  dataUsedBytes   BigInt?
  dataLimitBytes  BigInt?
  smsUsedCount    Int?
  usageSource     String?   @db.VarChar(30)
  firstCapturedAt DateTime  @db.Timestamptz @default(now())
  lastCapturedAt  DateTime  @db.Timestamptz
  isFinal         Boolean   @default(false)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([simId, monthKey])
  @@index([monthKey])
  @@index([monthKey, dataUsedBytes(sort: Desc)])
  @@map("sim_monthly_usage")
}
```

Op `SIM`: relatie toevoegen — `monthlyUsage SimMonthlyUsage[]`.

### 1.2 Bucketing-regel (vastleggen in code + docs)

- `monthKey` = kalendermaand van **`usagePeriodStart`** indien aanwezig.
- Fallback 1: kalendermaand van **`usagePeriodEnd`**.
- Fallback 2: kalendermaand van **`now`** (alleen wanneer provider geen periode-info levert).
- Alleen snapshots met een **periodegebonden bron** (`usageSource = BUNDLE_COUNTER` of `CDR_STATS`)
  worden als maandverbruik opgeslagen. Bij `NONE`/`UNKNOWN` wordt **niets** opgeslagen
  (geen "silent default" — een niet-periodegebonden teller is niet vergelijkbaar).

### 1.3 Aggregatieregel

- Een maandtotaal = som van **alle** `sim_monthly_usage`-rijen van die `monthKey`, ongeacht de
  **huidige** SIM-status (historisch: een inmiddels gedeactiveerde SIM telt mee voor de maand
  waarin hij actief was).
- Ontbrekende maanden worden als **`null`** doorgegeven (niet als 0) en in de UI getoond als
  "geen data".

### 1.4 Migratie

- Nieuwe map `prisma/migrations/20261016150000_add_sim_monthly_usage/migration.sql` met
  `CREATE TABLE sim_monthly_usage`, unique index op `(simId, monthKey)`, indexen op `monthKey`.
- **DDL eerst uitvoeren, dan code deployen** (bestaande werkwijze).

---

## 2. Opname van snapshots (backend)

### 2.1 Nieuwe service `src/server/services/sim-usage-history.service.ts`

Functies:

| Functie | Verantwoordelijkheid |
|---|---|
| `deriveMonthKey(periodStart, periodEnd, usageSource, refDate)` | Bepaalt `monthKey` volgens 1.2; geeft `null` bij niet-periodegebonden bron |
| `captureUsageSnapshot(tx, sim)` | Upsert van één snapshot met monotone guard; markeert eerdere niet-finale rijen van de SIM als `isFinal` zodra een nieuwe maand begint |
| `getUsageHistory(months = 12)` | Aggregatie: totaal per maand + SIM-aantal; vult ontbrekende maanden met `null` |
| `getUsageHistoryForMonth(monthKey)` | Totalen + top-N SIMs van één maand (uit snapshots) |
| `pruneUsageHistory(keepMonths = 24)` | Verwijdert rijen ouder dan de retentie (lazy mee te lopen, zie 2.3) |

Monotone guard bij de upsert:

```ts
// Binnen dezelfde (simId, monthKey): alleen verhogen, nooit verlagen.
// lastCapturedAt wordt altijd bijgewerkt; periodStart/End/limit alleen gevuld indien nieuw.
```

### 2.2 Aanroeppunten (inline in de bestaande sync)

`captureUsageSnapshot(tx, sim)` wordt aangeroepen op de plekken waar usage reeds wordt
weggeschreven, uitsluitend voor gewijzigde SIMs (geen extra read van alle SIMs):

| Pad | Locatie |
|---|---|
| Bulk usage-sync actieve SIMs | [simhuis-sim-sync.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/simhuis-sim-sync.service.ts#L1592-L1610) |
| Beschikbare SIMs sync | [simhuis-sim-sync.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/simhuis-sim-sync.service.ts#L987-L1062) |
| Enkele SIM usage-sync | [simhuis-sim-sync.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/simhuis-sim-sync.service.ts#L2017-L2029) |

Elke aanroep zit in dezelfde transactie/batch als de bestaande update. Mislukken van de
snapshot mag de hoofd-sync **niet** blokkeren (defensief, zoals de audit-service) — loggen en
doorgaan.

### 2.3 Markeren "final" en retentie

- Finaliseren gebeurt tijdens het opnemen: zodra voor een SIM een `monthKey` nieuwer dan een
  bestaande rij wordt geschreven, wordt de oudere rij op `isFinal = true` gezet.
- `pruneUsageHistory(24)` wordt één keer per dag (of bij de eerste sync van de dag) aangeroepen;
  niet bij elke run om write-amplificatie te voorkomen.

### 2.4 Providers

- Werkt generiek via `ProviderSimStatus`; op dit moment levert alleen Simhuis usage
  (`syncUsage` capability, [adapter.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/providers/simhuis/adapter.ts#L421-L426)).
  Andere providers sluiten later automatisch aan zonder schemawijziging.

---

## 3. Dashboard & UI

### 3.1 Nieuwe component `src/components/admin-usage-history-chart.tsx`

- 12-maands trend (bar/line) van het **totaalverbruik** per maand.
- Maanden zonder data worden visueel onderscheiden (geen 0-balk) en in tooltip als "geen data" getoond.
- Maandselector (dropdown of klikbare balk) bepaalt de detailmaand.

### 3.2 Aanpassing [dashboard/page.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/dashboard/page.tsx#L423-L485)

- Data-loading uitbreiden met `getUsageHistory(12)` en, bij een gekozen maand,
  `getUsageHistoryForMonth(monthKey)`.
- Maandkeuze via query-param `?maand=YYYY-MM` (server-side), standaard = huidige maand.
- Huidige maand gebruikt de bestaande live-aggregatie; eerdere maanden komen uit snapshots.
- De bestaande tegel [admin-monthly-usage-chart.tsx](file:///Users/bas/Documents/trae_projects/STM/src/components/admin-monthly-usage-chart.tsx)
  blijft bestaan en toont de totalen + top-10 van de geselecteerde maand.
- Toegang blijft achter `canViewAllSimUsage` (`view_all_sim_usage_dashboard`),
  resolutie op [regels 399-421](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/dashboard/page.tsx#L399-L421).

### 3.3 Toegankelijkheid (A11y)

- Grafiek met `role="img"` + `aria-label`, maandselector met `<label>` en toetsenbordbediening.
- Trendgrafiek voorzien van een tekstuele samenvatting (`aria-live`-vriendelijk) voor screenreaders.

---

## 4. Gefaseerde uitrol (Dev → Test → Staging → Prod)

| Fase | Werk |
|---|---|
| 1. Dev | Migratie toevoegen + `prisma migrate dev`; service + model; unit tests |
| 2. Dev | Inline capture-hooks in de 3 sync-paden; verifiëren dat snapshots gevuld worden |
| 3. Test | Dashboard-componenten + maandselector; integratietests; A11y-check |
| 4. Staging | Volledige migratie → deploy → 24u laten draaien; verifiëren dat maandrijen ontstaan en finaliseren |
| 5. Prod | Migratie (DDL) → code deploy → 1 nacht laten lopen → steekproef verifiëren |

---

## 5. Verificatiechecklist

**Database / model**
- [ ] Migratie draait schoon op een lege én bestaande DB (idempotente indexen).
- [ ] Unique `(simId, monthKey)` voorkomt dubbele rijen bij herhaalde syncs.
- [ ] `pruneUsageHistory(24)` verwijdert uitsluitend rijen ouder dan 24 maanden.

**Capturing**
- [ ] Een SIM met `usageSource = NONE` levert **geen** snapshot op.
- [ ] Binnen één maand: herhaalde syncs verhogen de waarde, verlagen nooit (monotone guard).
- [ ] Simulatie periode-reset: oude maandrij blijft op eindwaarde staan, `isFinal = true`.
- [ ] Een fout in de snapshot blokkeert de hoofd-usage-sync niet.

**Aggregatie**
- [ ] Maanden zonder data komen als `null` terug (geen 0).
- [ ] Maandtotaal telt historische (later gedeactiveerde) SIMs mee.
- [ ] Top-N van een gekozen maand komt uit snapshots, niet uit live SIM-waarden.

**UI**
- [ ] Maandselector wisselt de detailtegel correct; standaard = huidige maand.
- [ ] Maanden zonder data worden niet als 0 getoond.
- [ ] Toegang alleen met `view_all_sim_usage_dashboard`; overige rollen zien de sectie niet.
- [ ] A11y: labels, toetsenbordnavigatie en aria-omschrijving op de grafiek.

**Regressie**
- [ ] Bestaande usage-sync (systemd, elke 5 min) blijft functioneren; tellers in `SyncJobRun` ongewijzigd.
- [ ] Bestaande maandtegel blijft de live huidige-maanddata correct tonen.

---

## 6. Risico's & maatregelen

| Risico | Maatregel |
|---|---|
| Bundle-periode valt niet samen met kalendermaand | Vaste bucketing-regel (maand van `periodStart`) + documenteren; periodegrenzen mee-opslaan |
| Provider zonder periodegebonden teller (NONE/UNKNOWN) | Niet opslaan; geen vervuiling van de trend |
| Write-amplificatie bij elke sync | Alleen bij gewijzigde SIMs; prune maximaal 1×/dag |
| Sync-fout mag historie niet aantasten | Snapshot schrijft uitsluitend toe/verhoogt; nooit massaal verwijderen bij falen |
| Uitgestelde provider-reset na maandwissel | Bucketing op periode, niet op `now`; monotone max-guard |

## 7. Rollback

- Code terugdraaien: de nieuwe tabel wordt niet meer beschreven; bestaande sync en dashboard
  blijven werken zonder de historische sectie.
- Tabel kan blijven staan (geen impact) of via een aparte migratie worden verwijderd.
- Geen datamutaties aan bestaande SIM-velden, dus geen dataverlies bij rollback.

## 8. Documentatie-updates

- [README.md](file:///Users/bas/Documents/trae_projects/STM/README.md): nieuwe tabel + capture-mechanisme benoemen.
- [adding-a-sim-provider.md](file:///Users/bas/Documents/trae_projects/STM/docs/adding-a-sim-provider.md):
  vereiste periodevelden in `ProviderSimStatus` voor historie-ondersteuning.
- Dit plan bijwerken zodra retentie of bucketing wijzigt.
