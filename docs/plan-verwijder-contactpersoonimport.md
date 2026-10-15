# Implementatieplan — Volledige verwijdering van Inserve-contactpersoonimport

> Doel: alle functionaliteit rond het **importeren van contactpersonen uit Inserve** verwijderen,
> terwijl de **bedrijvenimport uit Inserve** en het **handmatige contactbeheer** volledig intact
> en operationeel blijven.

## 0. Scope & uitgangspunten

| Onderdeel | Besluit |
|---|---|
| Inserve **contactpersoon**-import (fetch/mapping/opslag/UI/logging) | **Verwijderen** |
| Inserve **bedrijven**-import (`companies`) | **Behouden** |
| Toegestane bedrijven-importlocatie | `Instellingen > Inserve Klantimport` (scheduler-kaart) |
| `Klanten > CSV importeren` | Alleen nog CSV (bedrijven) — de tab "Uit Inserve" verdwijnt |
| Handmatig contactbeheer (CRUD + `ContactPerson`/`CustomerContactPerson`) | **Behouden** |
| Vrij tekstveld `Customer.contactPerson` (CSV + klantformulier) | **Behouden** |

Contactimport is uitsluitend de *Inserve-import*. De `ContactPerson`- en
`CustomerContactPerson`-tabellen en -services worden gedeeld met handmatig beheer en blijven
bestaan; alleen de import-specifieke velden/helpers/queries verdwijnen.

---

## 1. Inventarisatie

### 1.1 Te verwijderen — backend

| Bestand | Wat |
|---|---|
| [service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/integrations/inserve/service.ts) | `INSERVE_CLIENT_ENDPOINT`, `ListClientsOptions`, contact-helpers (`getContactCompanyIds`, `groupContactsByCompanyId`, `resolveContactName/Email/PhoneLandline/PhoneMobile/Function`), `listClients`, `listAllClients`, `listClientsForCompanyIds`, `InserveContact`-import |
| [inserve-customer-import.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/inserve-customer-import.service.ts) | Contact-imports, `ImportSummary.contacts`/`clientsPagesProcessed`/`clientsTotalExpected`/`possibleContactMatches`/`contactFailedDetails`, `ZERO_CONTACTS`, PRE-SCAN + contact-fetch stappen, `syncContactsForCustomer()`, contact-velden in audit-/finalize-/failed-summary |
| [contact.service.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/services/contact.service.ts) | `findContactByInserveId`, `upsertContactForImport` (+ typen), `findSimilarContactsByCustomer`, `getCustomerIdsForContact`, `inserveContactId` in create/update |
| [validators/contact.ts](file:///Users/bas/Documents/trae_projects/STM/src/server/validators/contact.ts) | `inserveContactId` in `CreateContactSchema` |
| [sync-progress-registry.ts](file:///Users/bas/Documents/trae_projects/STM/src/lib/progress/sync-progress-registry.ts) | Stappen "Pre-scan Nexus-vrij veld" en "Contactpersonen ophalen"; contact-vermelding in stap 8 |

**Behouden in `service.ts`:** `listAllCompanies`, `listCompanyCustomFields`, `resolveNexusFieldFromCompany`,
alle asset-/invoice-/contract-/company-functies.
**Behouden in `contact.service.ts`:** `listContactsForCustomer`, `getContactDetail`,
`createContactService`, `updateContactService`, `deleteContactService`, `linkContactToCustomer`,
`unlinkContactFromCustomer`.

### 1.2 Te verwijderen — WebGUI

| Bestand | Actie |
|---|---|
| [inserve-customer-import-client.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/customers/import/_components/inserve-customer-import-client.tsx) | **Bestand verwijderen** |
| [customers/import/page.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/customers/import/page.tsx) | CSV-only maken (tabs + Inserve-tab weg) |
| [customers/actions.ts](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/customers/actions.ts) | `startInserveCustomerImportAction` + `...WithProgressAction` verwijderen; `inserveContactId` uit `readContactForm` |
| [customer-contacts-table.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/customers/_components/customer-contacts-table.tsx) | Inserve-kolom, "Inserve ID"-formulierveld, Inserve-teksten verwijderen |

**Behouden:** [sync-schedule-client.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/settings/_components/sync-schedule-client.tsx)
(de kaart "Inserve Klantimport" is de toegestane importlocatie), `settings/actions.ts` `triggerSyncJobAction`,
`customer-list.tsx` (knop "CSV importeren"), `sidebar.tsx` (geen aparte import-ingangen).

### 1.3 Te verwijderen — database

| Bestand | Actie |
|---|---|
| [schema.prisma](file:///Users/bas/Documents/trae_projects/STM/prisma/schema.prisma) | `ContactPerson.inserveContactId` + `@@index([inserveContactId])` verwijderen |
| Nieuwe migratie `20261016000000_drop_inserve_contact_id` | `DROP INDEX IF EXISTS ...inserveContactId_key/_idx`, `DROP COLUMN IF EXISTS inserveContactId` |

Tabellen `contact_persons` en `customer_contact_persons` **blijven** (handmatig beheer).

### 1.4 Te verwijderen — tests/documentatie

- [inserve-customer-import.test.ts](file:///Users/bas/Documents/trae_projects/STM/tests/inserve-customer-import.test.ts): contact-mocks + SM-4…SM-11/SM-16 + "Contactpersonen sync"-describe.
- [inserve-pagination-fix.test.ts](file:///Users/bas/Documents/trae_projects/STM/tests/inserve-pagination-fix.test.ts): 3 `listClientsForCompanyIds`-tests.
- [inserve-sync-progress.test.ts](file:///Users/bas/Documents/trae_projects/STM/tests/inserve-sync-progress.test.ts): contact-mocks, T-I3, step-index/count bijwerken (12 → 10).
- [scripts/reset-customers-contacts.sh](file:///Users/bas/Documents/trae_projects/STM/scripts/reset-customers-contacts.sh): slotregel "Inserve-import" → neutrale tekst.

---

## 2. Gefaseerde uitvoering

### Fase 1 — Dev: backend-verwijdering
1. `service.ts`: contact-exports + client-functies verwijderen; `listAllCompanies`/rest intact.
2. `inserve-customer-import.service.ts`: contact-imports, -types, -stappen, `syncContactsForCustomer`, pre-scan,
   contact-velden in alle summary-objecten verwijderen; `sourceReadComplete` zetten na succesvolle bedrijven-read.
3. `sync-progress-registry.ts`: stappenlijst naar 10 stappen; step-indices in service herindexeren.
4. `contact.service.ts` + `validators/contact.ts`: import-specifieke helpers/veld verwijderen.

### Fase 2 — Dev: WebGUI
5. `inserve-customer-import-client.tsx` verwijderen; `customers/import/page.tsx` CSV-only.
6. `customers/actions.ts`: Inserve-import-actions + `inserveContactId` verwijderen.
7. `customer-contacts-table.tsx`: Inserve-kolom/veld/teksten verwijderen.

### Fase 3 — Dev: database
8. `schema.prisma` aanvullen; nieuwe Prisma-migratie genereren/schrijven.
9. **DDL eerst** uitvoeren (migrate deploy) vóór code-deploy.

### Fase 4 — Dev: tests & statische controle
10. Tests aanpassen/verwijderen.
11. `npm run typecheck`, `npm run lint`, `npm run test` — alles groen, geen ongebruikte imports.

### Fase 5 — Documentatie
12. Plan/README/scripts bijwerken.

### Fase 6 — Dev-verificatie
13. Bedrijvenimport via `Instellingen > Inserve Klantimport` handmatig draaien (of proefmodus).
14. `Klanten > CSV importeren` = CSV-only; Inserve-tab weg.
15. Handmatig contactbeheer: toevoegen/bewerken/verwijderen werkt; geen Inserve-verwijzingen.

### Fase 7 — Staging
16. Migratie + deploy; volledige regressie van §3-checklist.

### Fase 8 — Productie
17. Backup → migratie (DDL) → deploy → rooktest → monitoring.

---

## 3. Verificatiechecklist

**Bedrijvenimport (moet blijven werken)**
- [ ] `Instellingen > Inserve Klantimport` toont de scheduler-kaart en "Handmatig nu synchroniseren".
- [ ] Handmatige run: bedrijven worden opgehaald (pagineren), aangemaakt/bijgewerkt/gedeactiveerd volgens Nexus=Actief.
- [ ] Voortgangsmonitoring (SSE) toont 10 stappen, zonder contact-stappen; percentages lopen monotoon.
- [ ] Mutex voorkomt parallelle runs; full-read-guard voorkomt massadeactivatie bij onvolledige bronlezing.
- [ ] Audit `INSERVE_CUSTOMERS_IMPORTED` bevat géén contact-velden.

**Verwijderde functionaliteit (mag niet meer bestaan)**
- [ ] `Klanten > CSV importeren` toont uitsluitend CSV-import.
- [ ] Geen UI/knoplabels/teksten die contactpersoonimport of `inserveContactId` noemen.
- [ ] Geen code-referenties naar `listAllClients`, `listClientsForCompanyIds`, `syncContactsForCustomer`,
      `upsertContactForImport`, `findContactByInserveId`, `findSimilarContactsByCustomer`.
- [ ] DB-kolom `contact_persons.inserveContactId` + bijbehorende indexen bestaan niet meer.

**Handmatig contactbeheer (moet blijven werken)**
- [ ] Contactpersoon toevoegen/bewerken/verwijderen op klantdetail werkt.
- [ ] `Customer.contactPerson` (vrij tekstveld) blijft in CSV en klantformulier.

**Kwaliteit**
- [ ] `npm run typecheck` zonder fouten.
- [ ] `npm run lint` zonder errors.
- [ ] `npm run test` groen.
- [ ] Geen ongebruikte imports/variabelen in gewijzigde bestanden.

---

## 4. Rollback

1. Migratie is additief-omgekeerd: kolom was nullable — terugdraaien vereist alleen
   `ALTER TABLE contact_persons ADD COLUMN "inserveContactId" INTEGER` + indexen (geen dataverlies
   van bedrijven/contacten).
2. Code: `git revert` van de release-commit; geen datamodel-afhankelijkheden buiten de kolom.
3. Volledige DB-backup vóór productie-deploy (`deploy/stm-db-backup.timer`).

---

## 5. Uitgevoerd op dev (resultaat)

### 5.1 Code & tests
- Broncode, schema, WebGUI, scripts en tests zijn aangepast; zie §1.
- `npm run test`: 282 passed, 1 pre-existing failure ([inserve-client.test.ts](file:///Users/bas/Documents/trae_projects/STM/tests/inserve-client.test.ts), 429-retry — ongerelateerd).
- `npm run lint`: alleen 2 pre-existing errors in [navixy-settings-client.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/settings/_components/navixy-settings-client.tsx#L545) + 1 warning in [sim-list.tsx](file:///Users/bas/Documents/trae_projects/STM/src/app/(app)/sims/_components/sim-list.tsx#L262).
- `npm run typecheck`: alleen 7 pre-existing fouten in [providers-registry.test.ts](file:///Users/bas/Documents/trae_projects/STM/tests/providers-registry.test.ts).

### 5.2 Database — reparatie van een blokkerende, pre-existente migratie
`migrate deploy` bleek **op PG16 structureel te falen** op migratie
[20261006120000_add_multi_thresholds_and_check_interval](file:///Users/bas/Documents/trae_projects/STM/prisma/migrations/20261006120000_add_multi_thresholds_and_check_interval/migration.sql):
die voegde enum-waarden toe én gebruikte ze in dezelfde transactie →
`ERROR: unsafe use of new value ... (New enum values must be committed before they can be used)`.
Omdat Prisma elke migratie in één transactie draait, blokkeerde dit **élke** latere `migrate deploy`
(waardoor de deployment op de tier-3 `db push --accept-data-loss`-fallback terugviel).

Herstel (buiten de contactimport-scope, maar blokkerend voor de uitrol):
1. `20261006120000`: backfill verwijderd; bevat nu alleen enum-waarden + kolommen + default.
2. Nieuw: `20261006120001_backfill_threshold_levels` — doet de `thresholdLevels`-backfill in een **eigen** transactie.
3. `20261016000000_drop_inserve_contact_id`: `DROP INDEX/COLUMN IF EXISTS` gemaakt (robuust tegen `db push`-drift).

**Verificatie:** op een schone scratch-DB zijn alle **32** migraties succesvol toegepast; daarna is
`contact_persons` zonder `inserveContactId` en is `user_notification_settings.thresholdLevels` `NOT NULL`.

### 5.3 Dev-DB (`stm`)
- `db push` liep vast op **ongerelateerde drift** (`relation "sims_eid_key" already exists`); de dev-DB is
  grotendeels via `db push` opgebouwd en de `_prisma_migrations`-boekhouding loopt achter (10 migraties
  `pending` terwijl de objecten al bestaan).
- Daarom is de dev-DB chirurgisch bijgewerkt met de migratie-DDL:
  `npx prisma db execute --file prisma/migrations/20261016000000_drop_inserve_contact_id/migration.sql`.
- Gecontroleerd: `contact_persons.inserveContactId` bestaat **niet** meer.
- `npx prisma generate` opnieuw gedraaid.

---

## 6. Overdracht — uitrol test → staging → productie

> De uitrol op de servers wordt door de gebruiker gedaan.

### 6.1 Belangrijk: migratie-drift op de servers
Op de servers doet [entrypoint.sh](file:///Users/bas/Documents/trae_projects/STM/entrypoint.sh#L105-L137) /
[nexus-install.sh](file:///Users/bas/Documents/trae_projects/STM/nexus-install.sh#L822-L845):
tier-1 `migrate deploy` → tier-2 retry → **tier-3 `db push --accept-data-loss`**.
Sinds het falen van `20261006120000` staan alle latere migraties daar als *niet toegepast*, terwijl hun
objecten wél bestaan (aangebracht door tier-3). Daardoor zal tier-1 `migrate deploy` ook ná de reparatie
nog afketsen op bestaande objecten (bijv. `CREATE TABLE contact_persons` → *already exists*).

Er zijn dus twee routes:

- **Route A (bestaand gedrag, minste werk):** niets aanpassen. Bij de deploy faalt tier-1 en synct tier-3
  `db push` het schema — inclusief het verwijderen van `contact_persons.inserveContactId`.
  Nadeel: `--accept-data-loss` wordt gebruikt en de migratie wordt niet geregistreerd.
- **Route B (schoon, aanbevolen):** de bestaande objecten expliciet boekhouden en daarna `migrate deploy`:
  ```bash
  # per reeds-aanwezige maar ongeregistreerde migratie:
  docker compose exec -T nexus-app sh -lc \
    'cd /app && npx prisma migrate resolve --applied 20261006120000_add_multi_thresholds_and_check_interval'
  #   ... idem voor 20261006120001, 20261006150000, 20261006153000, 20261006180000,
  #       20261007120000, 20261009140000, 20261010120000, 20261010140000,
  #       20261012000000, 20261015000000   (alleen die al aanwezig zijn!)
  docker compose exec -T nexus-app sh -lc 'cd /app && npx prisma migrate deploy'
  ```
  Let op: `20261016000000_drop_inserve_contact_id` **niet** resolven — die moet echt draaien.

### 6.2 Stappen per omgeving (test → staging → productie)
1. **Backup** (verplicht vóór productie): `deploy/stm-db-backup.timer` of `scripts/backup-stm-db.sh`.
2. **DDL vóór code**:
   `./nexus-install.sh --dbupdate` (doet alleen `prisma migrate deploy` + systeemrollen),
   of route A/B hierboven handmatig.
3. **Code deployen**: normale `./nexus-install.sh`.
4. **Rooktest**: §3-verificatiechecklist.
5. **Monitoring**: `docker logs nexus-app`, `/api/health`, `prisma migrate status`.

### 6.3 Specifieke controle na uitrol
- `contact_persons.inserveContactId` bestaat niet meer:
  `SELECT column_name FROM information_schema.columns WHERE table_name='contact_persons';`
- `prisma migrate status` toont geen *failed* migraties meer.
- Bedrijvenimport via `Instellingen > Inserve Klantimport` werkt; `Klanten > CSV importeren` is CSV-only.

### 6.4 Rollback
Zie §4. Voor de gerepareerde migratie: `git revert` van de twee migratiebestanden; de enum-waarden en
kolommen blijven bestaan (additief), dus geen dataverlies.
