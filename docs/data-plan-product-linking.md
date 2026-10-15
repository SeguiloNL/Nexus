# Dataplan ↔ facturatieproduct koppeling (Sim-only)

Dit document beschrijft de architectuur, datamodellen, validatieregels en het
onderhoud van de koppeling tussen **dataplannen** en **factureerbare producten**
zoals gebruikt in de "Nieuwe activatie"-wizard (Sim-only datasimkaarten).

- [1. Overzicht en scheiding van concerns](#1-overzicht-en-scheiding-van-concerns)
- [2. Datamodellen en relaties](#2-datamodellen-en-relaties)
- [3. Facturatie-integratie en idempotentie](#3-facturatie-integratie-en-idempotentie)
- [4. Validatieregels en foutafhandeling](#4-validatieregels-en-foutafhandeling)
- [5. Onderhoud: bestaande koppelingen beheren](#5-onderhoud-bestaande-koppelingen-beheren)
- [6. Nieuwe dataplannen of producttypes toevoegen](#6-nieuwe-dataplannen-of-producttypes-toevoegen)
- [7. Uitbreidingsmogelijkheden](#7-uitbreidingsmogelijkheden)
- [8. Tests](#8-tests)

---

## 1. Overzicht en scheiding van concerns

Drie begrippen zijn bewust gescheiden:

| Concept | Waar | Rol |
| --- | --- | --- |
| **DataPlan** | `data_plans` | Commerciële databundel (GB's, geldigheid, prijs) + targeting. |
| **Product** | `products` | Factureerbaar artikel; bron voor de Inserve-artikelkoppeling (`inserveArticleId`). |
| **SIM** | `sims` | Fysieke simkaart; heeft een `dataPlanId` (welk plan erop actief is). |
| **ActivationOrder** | `activation_orders` | Bestelling; verwijst naar `productId` + optioneel `dataPlanId`. |

Kernregel: **een dataplan is de commerciële laag, een product is de
facturatielaag.** De wizard toont dataplannen; het onderliggende product wordt
automatisch afgeleid uit het gekozen dataplan, zodat de bestelling altijd naar
het juiste factureerbare artikel verwijst.

```
DataPlan (1) ──(0..1 productId, uniek)──> Product (1) ──* Subscription / ActivationOrder
   │
   ├─ targetRegions[]        (beschikbaarheid per regio)
   ├─ targetCustomerTypes[]  (beschikbaarheid per klanttype)
   └─ availableUntil         (vervaldatum)
```

## 2. Datamodellen en relaties

### `DataPlan` (uitbreiding)

```prisma
model DataPlan {
  // ... bestaande bundelvelden ...

  // 1-op-1 koppeling naar het factureerbare product.
  productId             String?       @unique
  product               Product?      @relation(fields: [productId], references: [id], onDelete: SetNull)

  // Targeting: leeg = beschikbaar voor alles.
  targetRegions         String[]      @default([])
  targetCustomerTypes   CustomerType[] @default([])

  // Optionele vervaldatum (null = geen vervaldatum).
  availableUntil        DateTime?

  @@index([productId])
  @@index([availableUntil])
}
```

| Veld | Verplicht | Betekenis | Constraint |
| --- | --- | --- | --- |
| `productId` | Nee* | Factureerbaar product waaraan dit plan is gekoppeld. | **Uniek** (1-op-1) + FK `ON DELETE SET NULL`. |
| `targetRegions` | Nee | Toegestane regio's (landcodes, uppercase). Leeg = alle regio's. | Array; geïndexeerd via GIN-impliciete array-opslag. |
| `targetCustomerTypes` | Nee | Toegestane klanttypes. Leeg = alle klanttypes. | Postgres enum-array. |
| `availableUntil` | Nee | Plan niet meer tonen na deze datum. | Geïndexeerd. |

\* Voor de **Sim-only wizard** is een koppeling functioneel verplicht: een plan
zonder (actief) product wordt niet getoond en wordt door de backend geweigerd.

### `Product`

Ongewijzigd, maar nu optioneel gekoppeld:

```prisma
model Product {
  inserveArticleId Int?      @unique   // bron voor Inserve-artikel
  dataPlan         DataPlan?           // inverse van DataPlan.product
}
```

### Overige relaties

- `ActivationOrder.dataPlanId` → `DataPlan` (`ON DELETE SET NULL`) en
  `ActivationOrder.productId` → `Product` (`ON DELETE RESTRICT`).
- `SIM.dataPlanId` → `DataPlan` (`ON DELETE SET NULL`).
- `Subscription.dataPlanId` → `DataPlan`, `Subscription.productId` → `Product`.

### Migratie

De wijzigingen staan in
[`prisma/migrations/20261016120000_data_plan_product_linking/migration.sql`](../prisma/migrations/20261016120000_data_plan_product_linking/migration.sql).
Voer DDL **altijd uit vóór** de code-deploy (`prisma migrate deploy`).

## 3. Facturatie-integratie en idempotentie

- **Artikel**: bij de eerste facturatie van een abonnement wordt via
  `ensureArticle` een Inserve-artikel aangemaakt en de id gecached in
  `Product.inserveArticleId`. Bestaat de id al, dan wordt het artikel
  hergebruikt (geen duplicaten).
- **Factuur**: de Inserve-factuur-id wordt opgeslagen op `Invoice.inserveInvoiceId`.
  Bij een herhaalde sync wordt een **bestaande** factuur bijgewerkt in plaats van
  opnieuw aangemaakt (idempotent). Ontbreekt de factuur aan de Inserve-zijde, dan
  wordt een nieuwe draft aangemaakt als fallback.
- **Foutafhandeling externe service**: bij een niet-beschikbare Inserve API wordt
  `Invoice.inserveSyncStatus = FAILED` met `inserveSyncError` gezet; de lokale
  order/abonnement blijft intact. De sync is opnieuw uitvoerbaar (retry) zonder
  dubbele facturatie.
- **Klantgegevens**: prijs, BTW en klant worden per regel (`lines[]`) meegegeven:
  `price = Subscription.monthlyPrice`, `btw_percentage = Product.btwPercentage`,
  `company_id` = Inserve-klant-id.

Zie [`inserve-invoice-sync.service.ts`](../src/server/services/inserve-invoice-sync.service.ts)
en [`inserve-sync.service.ts`](../src/server/services/inserve-sync.service.ts).

## 4. Validatieregels en foutafhandeling

Validatie is **drievoudig** (defense in depth):

### 4.1 Database-constraints
- `UNIQUE (productId)` op `data_plans` — dwingt 1-op-1 af.
- FK `data_plans.productId → products.id ON DELETE SET NULL`.
- FK's vanaf `activation_orders`/`subscriptions`/`sims` naar `data_plans`.

### 4.2 Backend / businessregels

| Regel | Locatie | Gedrag |
| --- | --- | --- |
| Product moet bestaan | `assertProductLinkable` (data-plan.service) | Fout bij onbekend product. |
| Product moet **actief** zijn (factureerbaar) | `assertProductLinkable` | Fout bij inactief product. |
| Product mag aan max. 1 dataplan hangen | `assertProductLinkable` + unieke index | Fout bij dubbele koppeling. |
| Beschikbaarheid (actief, sim-only, niet vervallen, targeting, actief product) | `isDataPlanAvailableFor` (pure functie) | Retourneert `{ available, reasons }`. |
| Sim-only order vereist geldig dataplan | `assertSimOnlyDataPlanValid` (activation-order.service) | Gooit fout met redenen. |
| `order.productId === dataPlan.productId` | `assertSimOnlyDataPlanValid` + `markReady` | Blokkeert mismatches. |
| Alleen actieve/gekoppelde plannen tonen | `listAvailableDataPlansForCustomer` + `/api/data-plans/available` | Eén geïndexeerde query. |

Belangrijk: **lege targeting-arrays = "beschikbaar voor alles"**. Regio wordt
afgeleid uit `Customer.country`, klanttype uit `Customer.type` (beide
case-insensitief genormaliseerd naar uppercase).

### 4.3 Frontend
- Zod-schema's [`dataPlan.ts`](../src/server/validators/dataPlan.ts) valideren
  `productId`, `targetRegions`, `targetCustomerTypes`, `availableUntil`.
- De wizard toont dataplannen **alleen** wanneer `orderType = SIM_ONLY_DATA`;
  bij een klantwissel of typewissel wordt de lijst opnieuw geladen.
- Gebruikersvriendelijke meldingen: lege lijst ("geen passende plannen"),
  laadindicator, en een rode foutregel bij het mislukken van de laad-API.

### 4.4 Foutscenario's

| Scenario | Gedrag | Waar zichtbaar |
| --- | --- | --- |
| Geen productkoppeling | Plan niet getoond; backend weigert met "geen factureerbaar product gekoppeld". | Wizard + order-validatie |
| Product inactief | Plan niet getoond/geweigerd. | Idem |
| Plan vervallen (`availableUntil` < nu) | Plan niet getoond; alsnog kiezen → geweigerd. | Idem |
| Product/plan mismatch in order | `markReady` faalt met "product komt niet overeen". | Readiness-check |
| Facturatiesysteem onbeschikbaar | `inserveSyncStatus = FAILED` + technische `inserveSyncError`; order blijft bestaan. | Factuur/auditlog |
| Laad-API faalt (401/403/500) | Rode foutmelding in de wizard; technische details in server logs (`console.error`). | Wizard + logs |

## 5. Onderhoud: bestaande koppelingen beheren

Koppelingen beheer je via **Beheer → Dataplannen** (aanmaken/bewerken) of het
detailscherm van een dataplan:

1. **Koppelen**: open het dataplan → tab *Bewerken* → *Facturatie &
   beschikbaarheid* → kies een **actief** product. Opslaan valideert de 1-op-1
   regel.
2. **Ontkoppelen**: kies "— Geen product (niet factureerbaar) —". Het plan wordt
   daarna niet meer getoond in de Sim-only wizard.
3. **Targeting wijzigen**: vul `targetRegions` (komma-gescheiden, bv. `NL, BE`) en
   selecteer klanttypes. Alles leeg = alle klanten.
4. **Vervaldatum**: zet "Beschikbaar tot" om een plan tijdelijk aan te bieden.
5. **Uitfaseren**: deactiveer het plan (`isActive = false`) i.p.v. verwijderen;
   bestaande orders/abonnementen blijven intact (delete is geblokkeerd zolang er
   koppelingen zijn).

> Let op: het wijzigen van de productkoppeling van een plan heeft **geen** invloed
> op reeds afgesloten abonnementen (die verwijzen naar hun eigen `productId`).

## 6. Nieuwe dataplannen of producttypes toevoegen

### Nieuw dataplan
1. Maak (of kies) eerst een **actief product** onder Beheer → Producten.
2. Beheer → Dataplannen → **Nieuw dataplan**: vul bundel, geldigheid, prijs.
3. Koppel in *Facturatie & beschikbaarheid* het product en stel targeting in.
4. Sla op. Het plan verschijnt direct in de Sim-only wizard voor passende klanten.

### Nieuw producttype
- Voeg het product toe met een unieke `productCode`; `inserveArticleId` wordt bij
  de eerste facturatie automatisch aangemaakt (laat leeg).
- Koppel het aan precies één dataplan.

## 7. Uitbreidingsmogelijkheden

- **Nieuwe simkaarttypes**: breid `ActivationOrderProductType` uit en voeg in de
  wizard een stap toe. Hergebruik `isDataPlanAvailableFor` en
  `listAvailableDataPlansForCustomer` voor consistente filtering.
- **Bundelproducten (multi-plan)**: vervang de 1-op-1 door een join-tabel
  (`DataPlanProduct`) zodra één plan aan meerdere artikelen moet hangen. De
  validatie (`assertProductLinkable`) en de unieke index worden dan verplaatst
  naar de join-tabel.
- **Aangepaste facturatiestromen**: introduceer een `BillingProfile`/adapter per
  provider (analoog aan het `SimProviderRegistry`-patroon) en resolve op basis van
  capabilities, zodat Inserve niet hard-gekoppeld blijft.
- **Regio's als entiteit**: vervang de `targetRegions`-string-array door een
  `Region`-tabel met FK's voor rijkere targeting (meerdere landen, groepen).
- **Schaalbaarheid**: houd de lees-query (`listAvailableDataPlansForCustomer`)
  geïndexeerd en vrij van N+1; de schrijf-/facturatiepaden zijn idempotent en
  horizontaal schaalbaar over meerdere applicatie-instanties.

## 8. Tests

- [`tests/data-plan-linking.test.ts`](../tests/data-plan-linking.test.ts) —
  beschikbaarheidsregels (klanttype/regio/vervaldatum/product), validator-normalisatie
  en productmismatch-scenario's.
- [`tests/data-plan.test.ts`](../tests/data-plan.test.ts) — bestaande bundel- en
  delete-guard-tests.
- [`tests/activation-sim-only.test.ts`](../tests/activation-sim-only.test.ts) —
  Sim-only order-validatie en statusovergangen.

Uitvoeren:

```bash
npm test
```
