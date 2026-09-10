# Nexus – Activation & Subscription Manager

**Doel:** Een moderne, op rollen gebaseerde webapplicatie voor het beheren van **klanten, trackers, SIM-kaarten, voertuigen, producten** en het **transactioneel uitvoeren van activaties** (6-stappen wizard) inclusief abonnementen (Suspend/Cancel/Beëindigen/Vervangen). Alle wijzigingen worden automatisch gelogd in een onafhankelijke **AuditLog** met diff-weergave.

> Geschikt voor fleet-managers en MDM/M2M dienstverleners die telematica-hardware (GPS trackers + SIM-kaarten) aan klanten toewijzen en per abonnement factureren.

---

## 1. Tech Stack

| Laag | Technologie |
|---|---|
| Framework | **Next.js 14.2.18** (App Router, RSC + Server Actions, `src/` mappenstructuur) |
| Taal | **TypeScript 5.7** (strict mode) |
| UI | **Tailwind CSS 3**, **shadcn/ui**, **Radix UI** primitives (Tabs, Dialog, Select, Toast), **TanStack DataTable** (v8) |
| Database | **PostgreSQL 16** via **Prisma 5.22** ORM (client gegenereerd) |
| Authenticatie | **Auth.js V5 (NextAuth 5 beta)** – Credentials provider (e-mail/wachtwoord) |
| Beveiliging | Wachtwoorden gehasht met **bcryptjs** (cost factor 12), RBAC (3 rollen) |
| Validatie | **Zod** (inclusief `z.preprocess` normalisatie) |
| Overige utilities | **date-fns**, **clsx** + **tailwind-merge**, **sonner** (notificaties) |
| Dev tools | ESLint (next/core-web-vitals), PostCSS 8 (.cjs config i.v.m. `"type": "module"`) |

---

## 2. Rollen & Rechten (RBAC)

| Rol | Rechten |
|---|---|
| **ADMIN** | Alle CRUD-acties, Gebruikers beheren, Instellingen, Wizard activeren, Abonnementen Suspend/Cancel/Beëindigen/Vervangen |
| **EMPLOYEE** | CRUD op Klanten / Trackers / SIMs / Voertuigen / Activaties, Wizard volgen en activeren — **GEEN** Gebruikers / Instellingen |
| **VIEWER** | Alleen **lezen** (geen writes, geen wizard, geen acties) |

Permissie-matrix is gedefinieerd in `src/lib/rbac.ts`. Alle server-actions worden expliciet beveiligd via de `withAuth()` wrapper uit `src/lib/auth/session.ts`.

---

## 3. Installatie

### 3.1 Vereisten

- **Node.js ≥ 20** (ontwikkeld met v26; LTS 20+ werkt ook)
- **npm ≥ 10** (project gebruikt npm; geen pnpm/yarn lockfiles aanwezig)
- **PostgreSQL ≥ 16** (lokaal of via Docker)

### 3.2 Stap-voor-stap

```bash
# 1. Clone of open de map
git clone <repository-url> nexus
cd nexus

# 2. Installeer dependencies
npm install

# 3. Environment variables opzetten
cp .env.example .env

# Pas .env aan:
#   - DATABASE_URL : naar jouw lokale Postgres (user/wachtwoord/poort)
#   - AUTH_SECRET : genereer met 👉 npx auth secret  of  openssl rand -hex 32
#   - AUTH_URL / NEXT_PUBLIC_APP_URL : pas de poort aan (gebruik 3001 als 3000 bezet is)

# 4. Genereer Prisma Client
npx prisma generate

# 5. Database migreren
# (DEV: maak ook migration entries aan)
npx prisma migrate dev
# --- of ---
# (PROD of bestaande DB: draai alleen gecommitte migraties)
npx prisma migrate deploy

# 6. Demo-data seeden (klanten, trackers, SIMs, voertuigen, producten, 3 testgebruikers)
npx prisma db seed

# 7. Start dev server (altijd poort 3001, 3000 is op veel systemen al bezet)
PORT=3001 npm run dev
```

Open daarna http://localhost:3001 en log in met onderstaande credentials.

### 3.3 (Optioneel) Postgres via Docker

Heb je geen lokale Postgres 16, start dan een container:

```bash
docker run --name nexus-pg16 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nexus \
  -p 5432:5432 \
  -d postgres:16-alpine
```

Gebruik dan in `.env`:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nexus?schema=public"
```

---

## 4. Login Credentials (uit `prisma/db.seed`)

Alle 3 accounts gebruiken hetzelfde testwachtwoord: **`Test1234!`**

| E-mail | Rol |
|---|---|
| `admin@nexus.local` | **ADMIN** – volledige toegang |
| `medewerker@nexus.local` | **EMPLOYEE** – CRUD zonder Gebruikers/Instellingen |
| `viewer@nexus.local` | **VIEWER** – alleen-lezen |

> Seed wordt NIET automatisch opnieuw uitgevoerd; verwijder eerst DB of doe handmatig `TRUNCATE ... CASCADE` indien je verse demo-data wil.

---

## 5. Gebruik & Belangrijkste Features

### 5.1 Hoofdmenu

- **Dashboard** — Statistieken (actieve abo's, voorraad, openstaande activaties) + Recente activaties-tabel.
- **Activaties** — Lijst + 6-stappen Wizard (Nieuwe activatie → Klant → Product → Tracker → SIM → Voertuig → Controle → Activeer nu).
- **Abonnementen** — Lijst, detailpagina met tabs (Bewerken, Tracker, SIM, Geschiedenis), acties (Suspend / Resume / Annuleren / Beëindigen, Tracker/SIM Vervangen of Ontkoppelen).
- **Klanten** — BHV, soft-delete, detailtabs (Abonnementen, Trackers, SIMs, Activaties, Geschiedenis).
- **Trackers / SIM-kaarten / Voertuigen / Producten** — Full CRUD met soft-delete (behalve Producten: `isActive` toggle).
- **Gebruikers** — Alleen ADMIN: nodig uit nodige rollen.
- **Auditlog** — Globaal overzicht van alle CREATE/UPDATE/DELETE/STATUS acties, met klikbare diff per rij.
- **Instellingen** — Alleen ADMIN: links naar Gebruikers, info.
- **⌘K / Ctrl+K** — CMDK globaal zoekscherm (ga direct naar Klant / Tracker / SIM / Abonnement / Order).

### 5.2 Identifiers (transactie-veilig, optionele tx parameter)

| Entiteit | Patroon | Voorbeeld |
|---|---|---|
| Klant | `K-<JJJJ>-NNNNN` | `C-2025-0001` |
| Abonnement | `SUB-<JJJJ>-NNNNN` | `SUB-2026-000001` |
| Activatie-order | `ACT-<JJJJ>-NNNNN` | `ACT-2026-000001` |
| Tracker | `TRK-<XXXXXX>-ST` | `TRK-00001-ST` |

### 5.3 Formaten

- **IMEI:** 15 cijfers, **Luhn-validatie**, gegroepeerd weergegeven als `4-4-4-3` (bv. `4901 5420 3237 518`).
- **ICCID:** 19–20 cijfers, **moet beginnen met `89`**.
- **Alle identifiers en nummers:** normalisatie via `z.preprocess` (streepjes, spaties enz. worden gestript vóór validatie).

### 5.4 6-Stappen Transactionele Activatie

De "Activeer nu"-knop in Stap 6 draait **atomair** binnen `prisma.$transaction` (Serializable):

1. `ActivationOrder` assert `READY` + voorraadchecks
2. `Subscription` aanmaken (status `PENDING_ACTIVATION`)
3. `Subscription` → `ACTIVE`
4. `Tracker` `IN_STOCK` → `ASSIGNED` + partial unique insert in `TrackerAssignment` (kan niet 2x tegelijk actief)
5. `SIM` → `ASSIGNED` + insert in `SimAssignment`
6. `ActivationOrder` → `COMPLETED` met `completedAt` + evt. `failureReason`

Gaat 1 stap fout, dan **rollback** de hele transactie. Status-transities worden vooraf gevalideerd via `assert*Transition()` helpers.

---

## 6. Ontwikkeling & Validatie

```bash
# Type-check (geen emit) — geef 0 errors op schone install
npm run typecheck

# ESLint — Next.js core rules
npm run lint

# Productie-build
npm run build && npm start
```

### Programmatische end-to-end transaction test

Er is een los CLI-script beschikbaar op `scripts/test-wizard-tx.ts` dat de 6-stappen flow los van de UI nabootst:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nexus?schema=public" \
npx ts-node --esm --transpile-only scripts/test-wizard-tx.ts
```

> Schrijft 1 nieuwe activation order, subscription, tracker- en simassignment (maakt dus echte data aan).

---

## 7. Valuta, Data & Soft-Delete

- **Valuta:** EUR (`€ 19,95 / mnd`). Producten gebruiken Decimal precision via Prisma `@db.Decimal(10,2)`; op alle RSC pages expliciet naar `Number` geserialiseerd voor client-components.
- **Soft-Delete:** Alle entiteiten behalve **Producten** gebruiken `deletedAt DateTime?`. In de UI en service-queries standaard `where: { deletedAt: null }`. Producten gebruiken `isActive Boolean @default(true)`.
- **AuditLog:** Automatisch per service-call via `includeDetail()` + `logAudit()` pattern. Oude/nieuwe waarden zichtbaar als JSON-diff.

---

## 8. Deployment (Docker + Caddy 2 — klaar voor VPS)

Deze repository bevat 3 deployment-bestanden voor een standaard Linux-VPS (Ubuntu/Debian). De setup is **volledig self-contained via Docker Compose**: Postgres, Next.js standalone app, **én Caddy (reverse proxy + automatic HTTPS)** draaien allemaal als Docker-container.

| Bestand | Doel |
|---|---|
| `Dockerfile` | Multi-stage Next.js **standalone** build → Node 20-alpine, non-root user `nextjs`, runtime entrypoint: `node server.js` op poort `3000`. |
| `docker-compose.yml` | **3 services**: `nexus-app` (Next.js, exposed intern), `nexus-db` (postgres:16-alpine, named volume `nexus-db-data`, healthcheck `pg_isready`), `caddy` (Caddy 2 alpine, poorten 80/443, Let's Encrypt cert opslag in named volumes). Maakt dedicated netwerk `nexus-net` aan. |
| `Caddyfile` | Reverse proxy met **automatische HTTPS (Let's Encrypt)**, gzip/zstd compressie, X-Forwarded-* headers (compatibel met Auth.js), security-headers (HSTS, X-Frame-Options). **Configuratie via ENV** (`NEXUS_DOMAIN`, `NEXUS_APP_URL`) — geen hard-coded domein. |

### 8.1 Vereisten

- VPS met Linux + Docker ≥ 24 + Docker Compose plugin (geen `docker-compose` v1)
- Publiek domein bv. `nexus.jouwdomein.nl` met A/AAAA-record naar VPS IP
- (Optioneel) `sudo`-rechten voor de gebruiker als Docker nog niet geïnstalleerd is. Het script `scripts/install.sh` installeert Docker automatisch op Ubuntu/Debian.

### 8.2 Environment-variabelen (`.env` op VPS)

Kopieer `.env.production.example` naar `.env` en vul in; **NIET committen** (laat `AUTH_SECRET` genereren via `openssl rand -hex 32`):

```env
# APP (verplicht)
NEXT_PUBLIC_APP_URL=https://nexus.jouwdomein.nl   # EXACHT je HTTPS-domein
NODE_ENV=production

# AUTH (verplicht)
AUTH_SECRET=24c4a35d17...                                     # ≥ 32 bytes, openssl rand -hex 32
AUTH_URL=https://nexus.jouwdomein.nl/api/auth                 # (default: <NEXT_PUBLIC_APP_URL>/api/auth)

# DATABASE (wordt in compose aan `nexus-db` gehangen — NIET naar 127.0.0.1:5432!)
POSTGRES_USER=nexus
POSTGRES_PASSWORD=sterk_wachtwoord_hier_minstens_16_chars
POSTGRES_DB=nexus

# CADDY (voor automatic HTTPS)
NEXUS_DOMAIN=nexus.jouwdomein.nl                               # Laat leeg voor localhost test zonder TLS
```

### 8.3 Deploy uitvoeren (handmatig)

```bash
# 1. Code op VPS zetten (git, scp, whatever), dan in project root:
cd /opt/nexus

# 2. Environment klaarzetten (of: ./scripts/setup-env.sh gebruiken voor interactieve setup)
cp .env.production.example .env
# ... invullen AUTH_SECRET, POSTGRES_PASSWORD, NEXUS_DOMAIN, enz.

# 3. Validate + run compose
docker compose config
docker compose up -d --build
docker compose logs -f --tail=200 nexus-app

# 4. Voer de eerste database-migraties uit (1malig)
docker compose run --rm nexus-app npx prisma migrate deploy

# 5. Controleer of DB juist is
docker compose exec nexus-db psql -U nexus -d nexus -c '\dt'
#  → 13 tabellen (users, customers, subscriptions, trackers, sims, vehicles,
#                  tracker_assignments, sim_assignments, activation_orders,
#                  products, audit_logs, ...)

# 6. Optioneel: seed data in productie (ENKEL bij NIEUWE lege DB):
docker compose run --rm nexus-app node prisma/seed.mjs
```

### 8.4 Deploy via Installatiewizard (aanbevolen)

Er is ook een **geautomatiseerd installatiescript** voor Ubuntu/Debian dat Docker (+ compose plugin) installeert, `.env` genereert met veilige defaults, de compose stack opstart, migraties draait en eindigt met een health-check:

```bash
chmod +x scripts/*.sh
./scripts/install.sh
```

Flags: `--skip-seed` (geen demo-data), `--force-rebuild`, `--non-interactive` (voor CI/Ansible).

### 8.5 Caddy & HTTPS (automatisch)

Omdat Caddy **als Docker container** meetraapt in `docker-compose.yml`, werkt automatic HTTPS out-of-the-box:

- Stel `NEXUS_DOMAIN=nexus.jouwdomein.nl` in **én** zorg dat het domein A/AAAA-record wijst naar de VPS.
- Bij de eerste `docker compose up -d` zal Caddy zelfstandig een **Let's Encrypt**-certificaat aanvragen en installeren.
- Hernieuwen van het certificaat gebeurt **automatisch** (Caddy intern, geen actie nodig).
- Bezoek `https://nexus.jouwdomein.nl` en login met de seed credentials (zie §4).

### 8.6 Upgraden (nieuwe versies)

```bash
cd /opt/nexus
git pull                                         # of: upload nieuwe code
docker compose up -d --build
docker compose logs -f nexus-app caddy nexus-db
```

Migrations worden **niet automatisch** bij elke build gedraaid (veilig voor zero-downtime). Voer daarom handmatig 1x uit na upgrade:

```bash
docker compose run --rm nexus-app npx prisma migrate deploy
```

---

## 9. Projectstructuur (core)

```
nexus/
├─ prisma/
│  ├─ schema.prisma         # 13 modellen + enums + indexes
│  ├─ migrations/           # SQL migrations (init + activation_order velden)
│  └─ seed.mjs              # Demo data (ESM, node prisma/seed.mjs)
├─ scripts/
│  ├─ install.sh            # Installatiewizard VPS (Ubuntu/Debian)
│  ├─ setup-env.sh          # Interactieve .env generator
│  └─ test-wizard-tx.ts     # E2E transaction smoke-test
├─ src/
│  ├─ app/(app)/            # Alle authenticated pages (App Router)
│  │  ├─ dashboard/         # RSC met statistieken + Recente activaties
│  │  ├─ activations/       # 6-stappen Wizard + order detail + actions
│  │  ├─ subscriptions/     # CRUD + detail tabs + Suspend/Cancel dialogs
│  │  ├─ customers/         # CRUD + 8 tabs (Abon/Track/Sim/Voert/Activ/Gesch)
│  │  ├─ trackers/ sims/ vehicles/ products/ users/ audit-log/ settings/ search/
│  ├─ server/services/      # Transactionele services (Prisma + auditlogs)
│  ├─ lib/                  # rbac.ts, prisma.ts, auth/session.ts, validators, formatters, identifiers
│  ├─ types/                # enums.ts + domain.ts DTO's
│  └─ components/           # Layout (Sidebar/Header) + UI (shadcn) + DataTable
├─ Caddyfile                # Caddy reverse proxy config (ENV-based)
├─ Dockerfile               # Multi-stage Next.js standalone build
├─ docker-compose.yml       # 3 services: nexus-app + nexus-db + caddy
├─ .env.example             # Template lokale development env vars
├─ .env.production.example  # Template VPS env vars
└─ package.json / next.config.mjs / tailwind.config.ts / postcss.config.cjs
```

---

## 10. Bekende beperkingen

- Unit tests (Vitest 2.x) zijn **toegevoegd sinds v0.2** in `tests/` (25 tests): `validation-imei`, `validation-iccid`, `validation-normalize`, `identifiers` (formaat + increment), `rbac` (3-rollen matrix). Runnen: `npm run test`.
- Lokale Postgres mag **GEEN** `brew services` gebruiken op macOS als Homebrew keg-only is geinstalleerd; gebruik `pg_ctl start -D .postgres/data` of Docker.
- `lucide-react` exporteert geen `SimCard` icoon; er wordt `CreditCard` gebruikt in de layout sidebar.
- Deployment op Windows lokaal is niet gevalideerd (geen test-Windows PC beschikbaar). Docker/Productie Linux is altijd de doelomgeving.

---

© 2026 – Nexus project
