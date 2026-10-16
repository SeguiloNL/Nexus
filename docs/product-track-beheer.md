# Trajectbeschikbaarheid per product (beheerhandleiding)

Dit document beschrijft de functionaliteit waarmee je **per product** instelt in
welk(e) activatie-traject(en) het gekozen mag worden. Het is bedoeld voor het
beheerteam: hoe je de instelling vindt, instelt, en wat de gevolgen zijn voor
klanten in beide trajecten.

- [1. Waarom trajectbeschikbaarheid](#1-waarom-trajectbeschikbaarheid)
- [2. De drie instellingen](#2-de-drie-instellingen)
- [3. Instelling per product wijzigen](#3-instelling-per-product-wijzigen)
- [4. Effect op de twee trajecten](#4-effect-op-de-twee-trajecten)
- [5. Validatie en foutmeldingen](#5-validatie-en-foutmeldingen)
- [6. Datamodel en standaardwaarde](#6-datamodel-en-standaardwaarde)
- [7. Bestaande producten na de update](#7-bestaande-producten-na-de-update)
- [8. Blokkade bij directe URL-toegang](#8-blokkade-bij-directe-url-toegang)
- [9. Veelgestelde vragen](#9-veelgestelde-vragen)
- [10. Tests](#10-tests)

---

## 1. Waarom trajectbeschikbaarheid

De activatie-wizard kent twee trajecten:

| Traject | Omschrijving |
| --- | --- |
| **Nieuwe tracker met simkaart** | Bestelling van een nieuwe tractor/tracker inclusief simkaart. |
| **Sim-only datasimkaart** | Losse datasimkaart zonder tracker. |

Niet elk factureerbaar product is in beide trajecten zinvol. Met de
trajectbeschikbaarheid bepaal je dat een product **alleen** in het ene of het
andere traject verschijnt — of in beide. Zo ziet de klant in de wizard alleen
producten die voor dat traject bedoeld zijn.

## 2. De drie instellingen

| Keuze in het beheerpaneel | Technische waarde | Betekenis |
| --- | --- | --- |
| **Beide trajecten** | `BOTH` | Product is zichtbaar in beide trajecten. Dit is de standaard. |
| **Alleen Sim-only datasimkaart** | `SIM_ONLY` | Product is alleen zichtbaar in het Sim-only traject. |
| **Alleen Nieuwe tracker met simkaart** | `TRACKER` | Product is alleen zichtbaar in het tracker-traject. |

> Het veld is **verplicht**: elk product heeft altijd precies één van deze drie
> waarden.

## 3. Instelling per product wijzigen

1. Ga naar **Beheer → Producten** (of direct naar `/products`).
2. Open het gewenste product via **Details bekijken** of **Bewerken**
   (`/products/<id>`), of klik op **Nieuw product** voor een nieuw artikel.
3. In het tabblad **Bewerken** staat in de kaart **Algemeen** het veld
   **Beschikbaar in traject**.
4. Kies één van de drie opties in de keuzelijst.
5. Klik op **Opslaan**. De wijziging is direct actief in de wizard.

Het veld is gemarkeerd met een rode `*` (verplicht). De gekozen waarde is ook
zichtbaar op het detailscherm van het product, in de kaart **Systeem** onder de
regel **Traject**.

## 4. Effect op de twee trajecten

De filtering wordt op **twee niveaus** toegepast, zodat de regel niet te omzeilen
is:

- **Weergave:** de wizard toont per traject alleen producten met de
  overeenkomende waarde of `BOTH`.
  - *Sim-only traject* toont: `BOTH` + `SIM_ONLY`.
  - *Tracker-traject* toont: `BOTH` + `TRACKER`.
- **Opslag (backend):** ook het aanmaken/bijwerken/op gereed zetten van een
  bestelling wordt gecontroleerd. Een product dat niet voor het traject is
  vrijgegeven levert een foutmelding op, ook wanneer de bestelling buiten de
  wizard om wordt aangemaakt.
- **Sim-only dataplannen:** alleen dataplannen waarvan het gekoppelde product
  `BOTH` of `SIM_ONLY` is, worden in het Sim-only traject aangeboden.

## 5. Validatie en foutmeldingen

| Situatie | Gedrag |
| --- | --- |
| Geen keuze gemaakt / lege waarde | Opslaan wordt geweigerd. Het veld is verplicht. |
| Onbekende/ongeldige waarde | Backend weigert met de melding dat een geldig traject gekozen moet worden. |
| Product met `SIM_ONLY` in tracker-traject | Foutmelding: "Dit product is niet beschikbaar voor het Nieuwe tracker met simkaart-traject." |
| Product met `TRACKER` in Sim-only traject | Foutmelding: "Dit product is niet beschikbaar voor het Sim-only datasimkaart-traject." |

Validatie vindt plaats op drie lagen: het admin-formulier (verplicht veld), de
backend-validatie (beperkte set toegestane waarden) en de database (verplichte
kolom met een vaste enum). Zo kan er nooit een product zonder geldige
trajectinstelling ontstaan.

## 6. Datamodel en standaardwaarde

- Veld: `Product.track` in `products`.
- Type: Postgres enum `ProductTrack` met de waarden `BOTH`, `SIM_ONLY`, `TRACKER`.
- Verplicht: `NOT NULL` met **standaard `BOTH`**.
- Migratie:
  [`prisma/migrations/20261016170000_add_product_track/migration.sql`](../prisma/migrations/20261016170000_add_product_track/migration.sql).

Bij het aanmaken van een product zonder expliciete keuze valt het systeem terug
op `BOTH`.

## 7. Bestaande producten na de update

Alle producten die al bestonden vóór deze functionaliteit krijgen automatisch de
waarde **Beide trajecten**. Er verandert dus niets aan de zichtbaarheid: bestaande
producten blijven in beide trajecten zichtbaar totdat je de instelling bewust
aanpast. Er is geen actie nodig na de update.

## 8. Blokkade bij directe URL-toegang

Het is niet mogelijk om een product in het verkeerde traject te gebruiken door de
wizard-URL handmatig aan te passen of de bestelling via de API aan te maken: de
backend controleert de trajectgeschiktheid opnieuw bij het opslaan en bij het op
gereed zetten van de bestelling. Een dergelijke poging wordt geweigerd met de
foutmelding uit paragraaf 5.

## 9. Veelgestelde vragen

**Vraag: Een product is "verdwenen" uit de wizard. Wat is er aan de hand?**
Controleer de instelling **Beschikbaar in traject** van het product. Staat het op
`Alleen Sim-only datasimkaart`, dan verschijnt het niet in het tracker-traject
(en omgekeerd).

**Vraag: Moet ik bestaande producten aanpassen?**
Nee. Bestaande producten staan op **Beide trajecten** en gedragen zich zoals
voorheen.

**Vraag: Verandert het wijzigen van de trajectinstelling bestaande
abonnementen of orders?**
Nee. De instelling beïnvloedt alleen welke producten **nieuw** gekozen kunnen
worden in de wizard. Reeds afgesloten abonnementen en orders blijven ongewijzigd.

**Vraag: Een Sim-only dataplan is niet meer zichtbaar. Waarom?**
Het gekoppelde product staat dan waarschijnlijk op `Alleen Nieuwe tracker met
simkaart`. Zet het terug op **Beide trajecten** of **Alleen Sim-only
datasimkaart**.

## 10. Tests

- [`tests/product-track.test.ts`](../tests/product-track.test.ts) — de drie
  instellingen, de legacy-standaard (`BOTH`), de keuzelijst-labels, de
  Zod-validatie (default, geldige/ongeldige waarden), de dataplanbeschikbaarheid
  per traject en het opslaan/ophalen via de productenservice.

Uitvoeren:

```bash
npm test
```
