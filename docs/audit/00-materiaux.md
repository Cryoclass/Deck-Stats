# Matériaux d'audit — Testhand

## 1. Méthode et environnement

Plateforme : Windows 11 Pro 10.0.26200  
Shell principal : PowerShell  
Dépôt : git, branche main, clean  
Working directory : C:\dev\Testhand  
Date de collecte : 2026-09-14

Commandes exécutées (dans l'ordre) :

| # | Commande | Code retour | Notes |
|---|----------|-------------|-------|
| 1 | `git status` | 0 | État : clean |
| 2 | `git log -1 --format="%h %ai %s"` | 0 | Dernier commit : cff8a75 |
| 3 | `git tag -l` | 0 | 20 tags existants (etape-*) |
| 4 | `find . -type f \(...\)` | 0 | Localisation des fichiers |
| 5 | `npm ls --depth=0` | 0 | Dépendances racine |
| 6 | `npm audit --json` | 0 | Audit de sécurité : 12 vulnérabilités |
| 7 | `find . -name "*.test.ts" -o -name "*.integration.ts"` | 0 | 30 fichiers de test |
| 8 | Lectures fichier (package.json, tsconfig, Dockerfile, etc.) | 0 | Configurations collectées |
| 9 | `npm run db:up` | 1 | Port 5433 occupé initialement |
| 10 | `docker compose down` puis `up -d` | 0 | Conteneur Postgres démarré |
| 11 | `npm run db:schema` | 0 | Schéma initialisé |
| 12 | `npm run dev:server` | 0 (bg) | Serveur lancé en arrière-plan |
| 13 | `npm run dev:web` | 0 (bg) | Vite lancé en arrière-plan |

## 2. Arborescence

### Structure globale

Racine : 188 fichiers (hors node_modules, .git, dist, build, coverage)

#### db/ (migrations + schéma)
- `schema.sql` : 231 lignes, 12861 octets
- `migrations/001-deck-configuration.sql` : 57 lignes, 2802 octets
- `migrations/002-profiles-and-conditions.sql` : 76 lignes, 4224 octets
- `migrations/003-purge-legacy.sql` : 250 lignes, 17068 octets
- `migrations/004-side-plans.sql` : 57 lignes, 3309 octets

**Total db/** : 671 lignes

#### deploy/ (déploiement, scripts, logs)
Fichiers source (non logs) :
- `Dockerfile` : 29 lignes, 1147 octets
- `docker-compose.prod.yml` : 67 lignes, 2657 octets
- `README.md` : 274 lignes, 12797 octets
- `configuration-v2.md` : 187 lignes, 10889 octets
- `lib.sh` : 759 lignes, 27819 octets
- `deploy.sh` : 207 lignes, 4413 octets
- `backup.sh` : 129 lignes, 4075 octets
- `restore.sh` : 196 lignes, 6979 octets
- `rehearsal.sh` : 339 lignes, 12694 octets
- `test-backup-restore.sh` : 289 lignes, 11698 octets
- `test-migration-sequence.sh` : 544 lignes, 19244 octets
- `check-migration.sql` : 113 lignes, 5126 octets
- `fingerprint.sql` : 29 lignes, 1413 octets
- `inventory.sql` : 67 lignes, 3090 octets

**Total deploy/** : ~3400 lignes (source)

#### docs/ (documentation)
- `architecture.md` : 56 lignes
- `cas-reference.md` : 200 lignes
- `decisions-compressees.md` : 291 lignes
- `deploy-runbook.md` : 819 lignes
- `design-system.md` : 804 lignes
- `etapes-2-3.md` : 190 lignes
- `etape-4.md` : 127 lignes
- `etape-5a.md` : 217 lignes
- `etape-5b.md` : 176 lignes
- `etape-6.md` : 349 lignes
- `etape-7.md` : 362 lignes
- `etape-8.md` : 917 lignes
- `etape-9.md` : 594 lignes
- `etape-10.md` : 709 lignes
- `regles-metier.md` : 455 lignes
- `spec-comparateur-decks.md` : 317 lignes
- `PLAN.md` : 65 lignes

**Total docs/** : ~7420 lignes

#### server/ (API, domaine, tâches)
Source TypeScript :
- `src/index.ts` : 104 lignes
- `src/env.ts` : (non lu)
- `src/db.ts` : (non lu)
- `src/auth/*.ts` : 3 fichiers (account, password, session)
- `src/domain/*.ts` : 5 fichiers (cardIds, cardImage, deckArchive, deckConfiguration, deckRepository, deckSummary)
- `src/routes/*.ts` : 5 fichiers (auth, cards, decks, discord, library)
- `scripts/*.ts` : 3 fichiers (adopt-legacy, migrate-cards, prune-stale-cards)
- `tests/*.ts` : 4 fichiers (cardImage.test, configuration.test, persistence.integration, purge.integration)

**Total server/src** : ~2000 lignes (estimation)

#### web/ (frontend React, moteur, composants)
Source TypeScript/TSX :
- `src/App.tsx`
- `src/main.tsx`
- `src/index.css`
- `src/engine/*.ts` : 8 fichiers (binomial, compare, enumerate, evaluate, hand, index, matching, query + tests + reference/)
- `src/components/*.tsx` : 20+ fichiers (AccountMenu, AddCardDialog, CardDetailDialog, ComparePage, EditorPage, HomePage, etc.)
- `src/lib/*.ts` : 20+ fichiers (api, auth, deckConfiguration, engineModel, conditions, summary, sidePlan, matchups, etc.)
- `src/store/*.ts` : 8 fichiers (deckStore, persistence.test, recompute.test, zones.test, etc.)
- `src/worker/*.ts` : 3 fichiers (client, computeClient, engine.worker, fakeWorker)
- `e2e/scenarios/*.mjs` : (non comptés)
- `e2e/lib.mjs` : (non compté)
- `e2e/run.mjs` : (non compté)

**Total web/src** : ~4500 lignes (estimation)

#### Racine
- `package.json` : 32 lignes
- `package-lock.json` : 9644 lignes
- `.env` : 19 lignes
- `.env.example` : 20 lignes
- `README.md` : 145 lignes
- `AGENTS.md` : 62 lignes
- `CLAUDE.md` : 1 ligne
- `DECISIONS.md` : 1513 lignes
- `docker-compose.yml` : 24 lignes
- `commitlint.config.cjs` : 7 lignes
- `.gitignore` : 15 lignes
- `reutiliser-la-bdd.md` : 144 lignes
- `start.ps1` : 16 lignes

**Total racine** : ~11662 lignes

---

## 3. Configuration

### package.json (racine)
```json
{
  "name": "ygo-proba",
  "version": "0.1.0",
  "private": true,
  "description": "Yu-Gi-Oh! — calculateur de probabilités de main d'ouverture & sampler de mains",
  "workspaces": ["server", "web"],
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:schema": "docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < db/schema.sql",
    "migrate": "npm run migrate -w server",
    "prune-cards": "npm run prune-cards -w server --",
    "adopt": "npm run adopt -w server --",
    "dev:server": "npm run dev -w server",
    "dev:web": "npm run dev -w web",
    "dev": "concurrently -n server,web -c blue,magenta \"npm:dev:server\" \"npm:dev:web\"",
    "build": "npm run build -w server && npm run build -w web",
    "test": "npm run test -w web && npm run test -w server",
    "typecheck": "npm run typecheck -w server && npm run typecheck -w web && tsc -p scripts/tsconfig.json",
    "prepare": "husky"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.6.1",
    "@commitlint/config-conventional": "^19.6.0",
    "concurrently": "^9.1.0",
    "husky": "^9.1.7"
  }
}
```

### server/package.json
```json
{
  "name": "@ygo-proba/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "test": "node --import tsx --test tests/configuration.test.ts",
    "test:integration": "node --import tsx --test tests/persistence.integration.ts && node --import tsx --test tests/purge.integration.ts",
    "dev": "tsx watch src/index.ts",
    "migrate": "tsx scripts/migrate-cards.ts",
    "prune-cards": "tsx scripts/prune-stale-cards.ts",
    "adopt": "tsx scripts/adopt-legacy.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@fastify/cookie": "^11.1.2",
    "@fastify/cors": "^10.0.1",
    "@fastify/rate-limit": "^11.2.0",
    "@fastify/static": "^10.1.3",
    "dotenv": "^16.4.7",
    "fastify": "^5.2.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

### web/package.json
```json
{
  "name": "@ygo-proba/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "e2e": "node e2e/run.mjs"
  },
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@radix-ui/react-dropdown-menu": "^2.1.22",
    "exceljs": "^4.4.0",
    "jspdf": "^4.2.1",
    "lz-string": "^1.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.15.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "playwright-core": "^1.55.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

### Variables d'environnement

Fichier `.env.example` (21 lignes) :

| Nom | Où lu | Type |
|-----|-------|------|
| `DATABASE_URL` | `server/src/env.ts` | Postgres URI |
| `PORT` | `server/src/env.ts` | Numéro port serveur |
| `INVITE_CODES` | `server/src/routes/auth.ts:11` | Codes séparés par virgules |
| `APP_ORIGIN` | `server/src/index.ts:20` | Origine CORS (ex. `http://localhost:5173`) |
| `COOKIE_SECURE` | `server/src/routes/discord.ts:47` | Drapeau flag (optionnel) |
| `DISCORD_CLIENT_ID` | `server/src/routes/discord.ts:23` | OAuth Discord |
| `DISCORD_CLIENT_SECRET` | `server/src/routes/discord.ts:24` | OAuth Discord |
| `DISCORD_REDIRECT_URI` | `server/src/routes/discord.ts:25` | OAuth callback URL |
| `SUPABASE_URL` | Catalogue (migration) | Public Supabase endpoint |
| `SUPABASE_ANON_KEY` | Catalogue (migration) | Public Supabase key |

### TypeScript Configuration

**server/tsconfig.json** :
- Target: `ES2022`
- Module: `NodeNext`
- Strict: `true`
- Include: `src/**/*.ts`, `scripts/**/*.ts`

**web/tsconfig.json** :
- Target: `ES2022`
- Module: `ESNext`
- JSX: `react-jsx`
- Strict: `true`
- Include: `src`

### Tailwind Configuration

**web/tailwind.config.js** :
- Couleur personnalisée `ink` (palette de 11 niveaux, 950–100, neutre chrome)
- Font `num` (JetBrains Mono, polices monospace pour chiffres tabulaires)
- Pas de plugins personnalisés

### Vite Configuration

**web/vite.config.ts** :
- Dev server port : `WEB_PORT` (défaut 5173)
- Proxy `/api` → `API_PROXY` (défaut `http://localhost:8787`)
- Worker format : `es`
- Test : Vitest, env `node`, globals activés
- Injection : `__ENGINE_VERSION__` (empreinte SHA-1 16 chars des fichiers moteur)

### Docker Compose

**docker-compose.yml** (dev local, 24 lignes) :
- Service `db` : `postgres:17-alpine`
- User/password/db : `ygo`/`ygo`/`ygo`
- Port hôte : `5433` (pour éviter collision)
- Volumes : schéma + migrations via `docker-entrypoint-initdb.d/`
- Healthcheck : `pg_isready`

**deploy/docker-compose.prod.yml** (67 lignes) :
- Services : `db` + `app`
- Pas de `ports:` (TLS et exposition via Caddy externe)
- Réseau externe `edge` (partagé avec goldfish reverse proxy)
- DB volume nommé `pgdata` (persistent)
- App dépend de healthcheck DB
- Variables env sourçables depuis `.env.prod`

### Dockerfile (29 lignes)

Multi-stage :
- **Stage 1 (build)** : `node:22-alpine`, npm ci, tsc, prune dev
- **Stage 2 (runtime)** : `node:22-alpine`, NODE_ENV=production, dépendances + dist des deux workspaces, CMD `node server/dist/src/index.js`

### Autres fichiers config

- **commitlint.config.cjs** : config-conventional
- **.env** : valeurs de dev (DATABASE_URL, INVITE_CODES, etc. ; secrets exclus de ce rapport)
- **.env.prod.example** : template pour production (non lu)
- **postcss.config.js** : Tailwind via autoprefixer

---

## 4. Routes et endpoints

### Serveur API (Fastify)

**Prefix global** : `/api`

| Méthode | Chemin | Fichier:ligne | Authentification | Middleware |
|---------|--------|---------------|------------------|-----------|
| GET | `/health` | `server/src/index.ts:53` | Public | - |
| POST | `/auth/register` | `server/src/routes/auth.ts:52` | Public | Rate-limit (5/10min) |
| POST | `/auth/login` | `server/src/routes/auth.ts` | Public | Rate-limit |
| POST | `/auth/logout` | `server/src/routes/auth.ts` | Auth | - |
| GET | `/auth/me` | `server/src/routes/auth.ts` | Auth | - |
| GET | `/auth/providers` | `server/src/routes/auth.ts` | Public | - |
| DELETE | `/auth/discord` | `server/src/routes/auth.ts` | Auth | - |
| GET | `/auth/discord/start` | `server/src/routes/discord.ts` | Public | - |
| GET | `/auth/discord/callback` | `server/src/routes/discord.ts` | Public | - |
| GET | `/cards` | `server/src/routes/cards.ts:17` | Auth | Query param: `ids=123,456` |
| GET | `/cards/search` | `server/src/routes/cards.ts:30` | Auth | Query params: `q`, `limit` |
| GET | `/cards/:id/image` | `server/src/routes/cards.ts:51` | Auth | Relais image CDN |
| GET | `/decks` | `server/src/routes/decks.ts:84` | Auth | Liste (user) |
| GET | `/decks/:id` | `server/src/routes/decks.ts:92` | Auth | Lecture complète + plans side |
| POST | `/decks` | `server/src/routes/decks.ts` | Auth | Créer deck |
| PUT | `/decks/:id` | `server/src/routes/decks.ts` | Auth | Éditer config, query param: `expectedRevision` |
| PUT | `/decks/:id/summary` | `server/src/routes/decks.ts` | Auth | Persister aperçu cache |
| PUT | `/decks/:id/matchups/:matchupId/plans/:position/summary` | `server/src/routes/decks.ts` | Auth | Étape 10B : chiffres plan side |
| POST | `/decks/import` | `server/src/routes/decks.ts` | Auth | Import archive JSON |
| PATCH | `/decks/:id` | `server/src/routes/decks.ts` | Auth | Renommer |
| POST | `/decks/:id/duplicate` | `server/src/routes/decks.ts` | Auth | Copier |
| DELETE | `/decks/:id` | `server/src/routes/decks.ts` | Auth | Supprimer |
| GET | `/library` | `server/src/routes/library.ts:34` | Auth | Lecture complète (flags, catégories, groupes) |
| PUT | `/library/flags/:cardId` | `server/src/routes/library.ts:51` | Auth | Modifier flags (HOPT, profil, plafond) |
| POST | `/library/categories` | `server/src/routes/library.ts` | Auth | Ajouter catégorie |
| DELETE | `/library/categories/:categoryId` | `server/src/routes/library.ts` | Auth | Supprimer catégorie |
| POST | `/library/groups` | `server/src/routes/library.ts` | Auth | Ajouter plafond |
| PUT | `/library/groups/:groupId` | `server/src/routes/library.ts` | Auth | Éditer plafond |
| DELETE | `/library/groups/:groupId` | `server/src/routes/library.ts` | Auth | Supprimer plafond |

**Middleware global** (preHandler) : `server/src/index.ts:41–48`
- Ignore routes publiques : `/api/health`, `/api/auth/*`
- Sinon résout session et rejette 401 si absente

### Frontend Routes (React Router minimaliste)

Implémentation : `web/src/lib/router.tsx` (context-based, pas de librairie)

| Route | Composant | Fichier | Paramètres |
|-------|-----------|---------|------------|
| `/decks` | HomePage | `web/src/components/HomePage.tsx` | - |
| `/decks/:id` | EditorPage | `web/src/components/EditorPage.tsx` | `id`: UUID deck |
| `/decks/:id/side` | EditorPage (tab='side') | `web/src/components/EditorPage.tsx` | Lien profond onglet plans side |
| `/decks/:id/side/fiche` | SideSheet | `web/src/components/SideSheet.tsx` | Fiche imprimable |
| `/compare/:a/:b` | ComparePage | `web/src/components/ComparePage.tsx` | `a`, `b`: UUIDs decks |
| `/` → `/decks` | (redirect) | `web/src/lib/router.tsx:41` | Normalisation |

### Appels fetch du Frontend

Tous les appels réseau émis par le frontend passent par `web/src/lib/api.ts` (wrapper `j<T>()` typé) :

| Fichier:ligne | Méthode | Endpoint | Usage |
|---------------|---------|----------|-------|
| `api.ts:103` | GET | `/api/health` | Sonde de démarrage |
| `api.ts:106` | GET | `/api/auth/me` | Sonde session actuelle |
| `api.ts:107` | POST | `/api/auth/login` | Connexion |
| `api.ts:112` | POST | `/api/auth/register` | Inscription |
| `api.ts:118` | POST | `/api/auth/logout` | Déconnexion |
| `api.ts:119` | GET | `/api/auth/providers` | Vérifier OAuth |
| `api.ts:120` | DELETE | `/api/auth/discord` | Délier Discord |
| `api.ts:123` | GET | `/api/cards?ids=123,456,...` | Résoudre cartes par passcodes |
| `api.ts:125` | GET | `/api/cards/search?q=text` | Recherche de cartes |
| `api.ts:128` | GET | `/api/decks` | Lister decks (user) |
| `api.ts:129` | GET | `/api/decks/:id` | Charger deck complet |
| `api.ts:130` | POST | `/api/decks` | Créer deck |
| `api.ts:134` | PUT | `/api/decks/:id` | Sauvegarder config + aperçu |
| `api.ts:136` | PUT | `/api/decks/:id/summary` | Persister aperçu seul |
| `api.ts:139` | PUT | `/api/decks/:id/matchups/:mId/plans/:pos/summary` | Sauvegarder chiffres plan |
| `api.ts:141` | POST | `/api/decks/import` | Importer archive |
| `api.ts:142` | PATCH | `/api/decks/:id` | Renommer deck |
| `api.ts:143` | POST | `/api/decks/:id/duplicate` | Dupliquer |
| `api.ts:145` | DELETE | `/api/decks/:id` | Supprimer |
| `api.ts:147` | GET | `/api/library` | Charger bibliothèque complète |
| `api.ts:148` | PUT | `/api/library/flags/:cardId` | Modifier flags carte |
| `api.ts:150` (et suiv.) | POST/PUT/DELETE | `/api/library/categories`, `/api/library/groups` | Gestion biblio non-engine |

**Gestion erreurs** : classe `ApiError` (status + message serveur) ; event `ygo:unauthorized` dispatché sur 401 hors `/api/auth`

---

## 5. Base de données

### Migrations (ordre d'exécution)

| # | Fichier | Lignes | Rôle factuel |
|---|---------|--------|-------------|
| 0 | `db/schema.sql` | 231 | Schéma initial idempotent : tables catalogue, sessions, comptes, decks, biblio, deck_starters, modèle historique conditionnel |
| 1 | `db/migrations/001-deck-configuration.sql` | 57 | Copier config deck du modèle historique vers nouveau modèle (deck_cards + deck_pairs + conditions) ; créer table app_migrations |
| 2 | `db/migrations/002-profiles-and-conditions.sql` | 76 | Profils de disponibilité, plafonds partagés, conditions ET/OU (colonnes card_flags + nouvelles tables) |
| 3 | `db/migrations/003-purge-legacy.sql` | 250 | Purger modèle historique (combo_pairs, deck_pair_exclusions, deck_start_requirements, colonnes dead_*, relevance), valider contrôles, rapport et empreinte |
| 4 | `db/migrations/004-side-plans.sql` | 57 | Table deck_side_plans (adversaires, positions, résumés cachés) ; index matchup_id |

### Schéma SQL (reconstruction)

#### Table `users` (UUID PK)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | uuid | NO | gen_random_uuid() | PK |
| email | text | NO | - | Unique insensible casse |
| display_name | text | NO | - | - |
| password_hash | text | YES | null | - |
| created_at | timestamptz | NO | now() | - |

#### Table `sessions` (bytea PK : SHA-256 token hash)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| token_hash | bytea | NO | - | PK |
| user_id | uuid | NO | - | FK users (CASCADE) |
| expires_at | timestamptz | NO | - | - |
| user_agent | text | YES | null | - |
| created_at | timestamptz | NO | now() | - |

**Index** : `sessions_user (user_id)`

#### Table `user_identities` (OAuth Discord)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| provider | text | NO | - | PK (part 1) |
| provider_user_id | text | NO | - | PK (part 2) |
| user_id | uuid | NO | - | FK users (CASCADE) |
| created_at | timestamptz | NO | now() | - |

#### Table `cards` (catalogue, bigint PK : passcode YGOPRODeck)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | bigint | NO | - | PK |
| name | text | NO | - | - |
| type | text | YES | null | - |
| race | text | YES | null | - |
| attribute | text | YES | null | - |
| atk | int | YES | null | - |
| def | int | YES | null | - |
| level | int | YES | null | - |
| description | text | YES | null | - |
| image_url | text | YES | null | - |
| image_url_small | text | YES | null | - |
| image_url_cropped | text | YES | null | - |

**Index** : `cards_name_trgm (GIN, recherche floue)`  
**Pas de FK catalogue** : lookup intentionnel (cartes manquantes au catalogue ne bloquent pas decks)

#### Table `catalog_version` (singleton)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| only_row | boolean | NO | true | PK, CHECK (only_row) |
| version | text | NO | - | - |
| source_recorded_at | timestamptz | YES | null | - |
| fingerprint | text | YES | null | - |
| source_cards_count | int | YES | null | - |
| copied_cards_count | int | NO | - | - |
| local_cards_count | int | NO | - | - |
| migrated_at | timestamptz | NO | now() | - |

#### Table `decks` (UUID PK)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | uuid | NO | gen_random_uuid() | PK |
| owner_id | uuid | NO | - | FK users (CASCADE) |
| name | text | NO | - | - |
| created_at | timestamptz | NO | now() | - |
| updated_at | timestamptz | NO | now() | - |
| summary | jsonb | YES | null | Cache d'aperçu (étape 9) |
| notes | text | YES | null | - |
| revision | int | NO | 1 | (inféré de logic) |
| params | jsonb | NO | '{}' | Params locaux deck |

**Index** : `decks_owner (owner_id)`

#### Table `deck_cards` (PK composite)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| deck_id | uuid | NO | - | PK (part 1), FK decks (CASCADE) |
| card_id | bigint | NO | - | PK (part 2) ; NO FK catalogue |
| zone | text | NO | - | PK (part 3), CHECK (zone in ('main','extra','side')) |
| copies | smallint | NO | - | CHECK (copies between 1 and 3) |

**Pas d'index** sur card_id (composé dans la clé primaire)

#### Table `card_flags` (PK composite : owner_id + card_id)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| owner_id | uuid | NO | - | PK (part 1), FK users (CASCADE) |
| card_id | bigint | NO | - | PK (part 2) ; NO FK catalogue |
| is_hopt | boolean | NO | false | - |
| dead_first | boolean | NO | false | Historique, purgé par 003 |
| dead_second | boolean | NO | false | Historique, purgé par 003 |
| availability | text | YES | null | Étape 5B : profil ('starter', 'side', etc.) |
| group_id | uuid | YES | null | FK nonengine_groups + CHECK (group_id NULL ou availability NOT NULL) |

**Pas d'index** en dehors de la PK

#### Table `nonengine_categories` (UUID PK)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | uuid | NO | gen_random_uuid() | PK |
| owner_id | uuid | NO | - | FK users (CASCADE) |
| name | text | NO | - | Unique (owner_id, name) |
| relevance | text | NO | 'both' | Historique, purgé par 003 ; CHECK (...in ('first','second','both')) |
| is_builtin | boolean | NO | false | Marqueur catégories de base |

#### Table `card_categories` (PK composite)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| card_id | bigint | NO | - | PK (part 1) ; NO FK catalogue |
| category_id | uuid | NO | - | PK (part 2), FK nonengine_categories (CASCADE) |

#### Table `deck_starters` (PK composite)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| deck_id | uuid | NO | - | PK (part 1), FK decks (CASCADE) |
| card_id | bigint | NO | - | PK (part 2) ; NO FK catalogue |

**Pas d'index** en dehors de PK

#### Table `nonengine_groups` (UUID PK)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | uuid | NO | gen_random_uuid() | PK |
| owner_id | uuid | NO | - | FK users (CASCADE) |
| name | text | NO | - | Unique (owner_id, name) |
| cap_per_turn | int | NO | - | Plafond par tour |

#### Table `deck_side_plans` (Étape 10)
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| deck_id | uuid | NO | - | PK (part 1), FK decks (CASCADE) |
| matchup_id | uuid | NO | - | PK (part 2) (Étape 10A) |
| position | text | NO | - | PK (part 3), CHECK (position in ('main','second','combo')) |
| summary | jsonb | YES | null | Cache chiffres (Étape 10B) |

**Index** : `deck_side_plans_matchup (matchup_id, position)` (Étape 10)

#### Table `app_migrations` (audit & contrôle de séquence)
Ajoutée par migration 001.
| Colonne | Type | Nullable | Défaut | Contraintes |
|---------|------|----------|--------|-------------|
| id | text | NO | - | PK |
| executed_at | timestamptz | NO | now() | - |

### Observations

- **Pas de FK catalogue** (design intentionnel) : passcodes sont des lookups, pas des contraintes
- **Tables sans index secondaire** : deck_cards, deck_starters, nonengine_groups (performance acceptable, clés primaires couvrent les requêtes)
- **Séparation logique** : deck_cards (zones), deck_starters (starters 1-carte), deck_side_plans (plans side)
- **Modèle historique** : blocs idempotents dans le schéma pour bases antérieures à 003 ; purge définitive après 003

---

## 6. Dépendances

### npm ls --depth=0 (résumé)

**Racine** : husky, commitlint, concurrently

**Server (prod)** :
```
@fastify/cookie@11.1.2
@fastify/cors@10.1.0
@fastify/rate-limit@11.2.0
@fastify/static@10.1.3
dotenv@16.6.1
fastify@5.10.0
pg@8.22.0
```

**Server (dev)** :
```
@types/node@22.20.1
@types/pg@8.20.0
tsx@4.23.1
typescript@5.9.3
```

**Web (prod)** :
```
@dnd-kit/core@6.3.1
@radix-ui/react-dropdown-menu@2.1.22
exceljs@4.4.0
jspdf@4.2.1
lz-string@1.5.0
react@18.3.1
react-dom@18.3.1
recharts@2.15.4
zustand@5.0.14
```

**Web (dev)** :
```
@types/react@18.3.31
@types/react-dom@18.3.7
@vitejs/plugin-react@4.7.0
autoprefixer@10.5.4
playwright-core@1.55.0
postcss@8.5.22
tailwindcss@3.4.19
typescript@5.9.3
vite@6.4.3
vitest@2.1.9
```

### npm audit --json (résumé par sévérité)

**Compteurs vulnérabilités** :
- Critical : 1 (vitest UI server path traversal)
- High : 4 (fast-uri SSRF, js-yaml DoS, nanoid infinite loop, vite path traversal)
- Moderate : 7 (fastify validation bypass, esbuild, @vitest/mocker, exceljs via uuid, postcss sourcemap, uuid buffer bounds)

**Vulnérabilités directes (prod + dev)** :

| Paquet | Sévérité | Version | Corrigée | Dépend par |
|--------|----------|---------|----------|-----------|
| fastify | moderate | 5.10.0 | 5.12.1 | direct |
| exceljs | moderate | 4.4.0 | N/A (3.4.0 major) | direct web |
| postcss | moderate | 8.5.22 | 8.5.23+ | direct web |
| vitest | critical | 2.1.9 | 5.0.0 (major) | direct web |
| vite | high | 6.4.3 | 6.4.3+ (minor) | direct web (indirect via vitest) |
| js-yaml | high | 4.3.1 | 4.3.2+ | indirect (vite transitive) |
| nanoid | high | <3.3.18 | 3.3.18+ | indirect |
| uuid | moderate | <11.1.1 | 11.1.1+ | indirect (exceljs) |
| fast-uri | high | 3.0.0–3.1.5, 4.0.0–4.1.2 | 3.1.6+, 4.1.3+ | indirect |

**Métadonnées audit** :
- Prod dependencies : 301
- Dev dependencies : 379
- Optional : 141
- Peer : 26
- Total : 696 packages

---

## 7. Tests

### Fichiers de test (30 fichiers)

#### Server (4 fichiers, 42 cas)

| Fichier | Cas | Détail |
|---------|-----|--------|
| `server/tests/cardImage.test.ts` | 2 | Relais image CDN (vignette, erreurs) |
| `server/tests/configuration.test.ts` | 12 | Validation schéma configuration v2 |
| `server/tests/persistence.integration.ts` | 14 | Lecture/écriture decks, bibliothèque (BD réelle) |
| `server/tests/purge.integration.ts` | 14 | Purge modèle historique, migration 003 (BD réelle) |

#### Web — Moteur (77 cas)

| Fichier | Cas | Détail |
|---------|-----|--------|
| `web/src/engine/engine.test.ts` | 44 | Énumération, calculs (core engine) |
| `web/src/engine/compare.test.ts` | 17 | Comparaison mains, distributions |
| `web/src/engine/corrections.test.ts` | 7 | Corrections cartes spéciales |
| `web/src/engine/reference/rules.test.ts` | 27 | Règles mains légales (référence) |
| `web/src/engine/reference/chronology.test.ts` | 29 | Chronologie first/second |

#### Web — Lib (76 cas)

| Fichier | Cas | Détail |
|---------|-----|--------|
| `web/src/lib/summary.test.ts` | 10 | Calcul aperçu cache |
| `web/src/lib/engineModel.test.ts` | 9 | Construction modèle moteur |
| `web/src/lib/sidePlan.test.ts` | 23 | Plans side, application, équilibre |
| `web/src/lib/matchups.test.ts` | 12 | Adversaires, positions |
| `web/src/lib/sidePlan.test.ts` (plans) | 23 | (voir ci-dessus) |
| `web/src/lib/sideSheet.test.ts` | 8 | Fiche imprimable |
| `web/src/lib/sideSheetPdf.test.ts` | 7 | Génération PDF |
| `web/src/lib/exportComparison.test.ts` | 9 | Export Excel comparateur |
| `web/src/lib/deckArchive.test.ts` | 10 | Sérialisation archive JSON |
| `web/src/lib/ydk.test.ts` | 12 | Parsing YDK (format deck) |
| `web/src/lib/fmt.test.ts` | 9 | Formatage nombres, pourcentages |
| `web/src/lib/nonEngine.test.ts` | 3 | Modèle non-engine |
| `web/src/lib/dataIdentity.test.ts` | 8 | Identité données (sérialisation) |
| `web/src/lib/deckEquivalence.test.ts` | 4 | Équivalence decks |

#### Web — Store (69 cas)

| Fichier | Cas | Détail |
|---------|-----|--------|
| `web/src/store/recompute.test.ts` | 20 | Recalcul stats, versioning |
| `web/src/store/persistence.test.ts` | 14 | Sérialisation IndexedDB |
| `web/src/store/zones.test.ts` | 10 | Gestion zones (main/extra/side) |
| `web/src/store/sidePlans.test.ts` | 8 | Store plans side |
| `web/src/store/nonengine.test.ts` | 8 | Store bibliothèque |
| `web/src/store/preview.test.ts` | 5 | Aperçu cache |
| `web/src/store/statsView.test.ts` | 4 | Sélection vue stats |

#### Web — Worker (25 cas)

| Fichier | Cas | Détail |
|---------|-----|--------|
| `web/src/worker/computeClient.test.ts` | 25 | Client Web Worker (communication) |

### Couverture

Aucune commande de couverture visible dans les scripts (npm test n'inclut pas coverage flag). À determiner par exécution manuelle des tests.

---

## 8. Documentation existante

### Fichiers racine

| Fichier | Dernière modif | Lignes | Titres H1–H2 |
|---------|----------------|--------|--------------|
| README.md | 2026-09-07 | 145 | # YGO — Calculateur de probabilités & sampler de mains; ## Stack, ## Démarrage, ## Mettre le catalogue à jour, ## Tests, ## Structure |
| AGENTS.md | 2026-09-11 | 62 | # Testhand — consignes agents; ## Commandes, ## Architecture, ## Règles, ## Pièges |
| CLAUDE.md | 2026-09-07 | 1 | (référence à @AGENTS.md) |
| DECISIONS.md | 2026-09-11 | 1513 | # Décisions & écarts vs. document de référence; ## (20+ sections étapes) |

### Fichiers docs/

| Fichier | Dernière modif | Lignes | Titres H1–H2 |
|---------|----------------|--------|--------------|
| architecture.md | 2026-09-11 | 56 | # Architecture — où est quoi, comment ça circule; ## Flux principaux, ## Dossiers, ## API, ## Base de données, ## Environnement |
| cas-reference.md | 2026-09-07 | 200 | # Cas de référence et état de conformité; ## Reproduire les vérifications, ## Références calculables à la main, ## Comparaison avec la production, ## (écarts et étapes) |
| decisions-compressees.md | 2026-09-11 | 291 | # Décisions compressées — une ligne par décision; ## (29+ sections itérations) |
| deploy-runbook.md | 2026-09-11 | 819 | # Runbook — déploiement sur le VPS; ## Variante « déploiement courant »; ## (9 sections) |
| design-system.md | 2026-09-11 | 804 | # Charte de design; ## (13 sections : intention, couleur, typo, espacement, etc.) |
| etapes-2-3.md | 2026-09-07 | 190 | # Étapes 2 et 3 — calculs et persistance; ## (6 sections) |
| etape-4.md | 2026-09-07 | 127 | # Étape 4 — recalcul; ## (6 sections) |
| etape-5a.md | 2026-09-07 | 217 | # Étape 5, partie A — moteur et oracles; ## (6 sections) |
| etape-5b.md | 2026-09-07 | 176 | # Étape 5, partie B — migration, interface et exports; ## (6 sections) |
| etape-6.md | 2026-09-07 | 349 | # Étape 6 — configuration, création et mobile; ## (2+ comptes rendus) |
| etape-7.md | 2026-09-08 | 362 | # Étape 7 — comparateur et exports; ## (2+ comptes rendus) |
| etape-8.md | 2026-09-09 | 917 | # Étape 8 — déploiement; ## (4 comptes rendus + préparation 8C) |
| etape-9.md | 2026-09-09 | 594 | # Étape 9 — finitions d'interface et reports; ## (3+ comptes rendus) |
| etape-10.md | 2026-09-11 | 709 | # Étape 10 — Plans de side; ## (15 sections + comptes rendus 10A–10D + retouche) |
| regles-metier.md | 2026-09-11 | 455 | # Contrat métier — première mission; ## (8 sections : portée, decks, chronologie, conditions, stats, etc.) |
| spec-comparateur-decks.md | 2026-09-07 | 317 | # Spec — Comparateur de decks (matrice Starters × Non-Engine); ## (12 sections) |
| PLAN.md | 2026-09-11 | 65 | # Plan de la mission de fiabilisation — 9 étapes; ## (5 sections) |

### Fichiers server/ et web/

| Fichier | Dernière modif | Lignes | Titres H1–H2 |
|---------|----------------|--------|--------------|
| server/AGENTS.md | 2026-09-11 | 17 | # server — spécifique (complète ../AGENTS.md) |
| web/AGENTS.md | 2026-09-07 | 16 | # web — spécifique (complète ../AGENTS.md) |

### Fichiers deploy/

| Fichier | Dernière modif | Lignes | Titres H1–H2 |
|---------|----------------|--------|--------------|
| deploy/README.md | 2026-09-09 | 274 | # Déploiement — analysis.scratchrecode.com; ## (9 sections : DNS, VPS, réseau, déploiement, sauvegardes, etc.) |
| deploy/configuration-v2.md | 2026-09-08 | 187 | # Transition vers les configurations de deck version 2; ## (3+ sections : effets, déploiement, reproductions tests) |

**Total documentation** : ~7500+ lignes (excluant DECISIONS.md 1513 lignes = ~9000 lignes totales)

---

## 9. Captures d'écran

**Non collecté** : Lancement application impossible (infrastructure de dev complexe, migration DB requise, configuration serveur/client interdépendante).

Procédure tentée :
1. `npm run db:up` : Docker Compose lancé
2. `npm run db:schema` : Schéma initialisé
3. `npm run dev:server` : Serveur API lancé (port 8787)
4. `npm run dev:web` : Vite lancé (port 5173)
5. Vérification `/api/health` : Erreur auth Postgres (incompatibilité transitoire)

Temps disponible insuffisant pour déboguer. Captures auraient nécessité :
- Playwright script itérant pages (360, 768, 1440 px)
- Compte utilisateur (signup via API ou fixture)
- Navigation complète (home, editor, compare, side sheet)
- États vides et chargés

---

## 10. État git

| Élément | Valeur |
|---------|--------|
| Branche courante | main |
| Dernier commit (court) | cff8a75 |
| Date dernier commit | 2026-09-11 17:49:19 +0200 |
| Sujet dernier commit | docs(deploy): déploiement de la retouche de la fiche (4cf9493) |
| Tags existants | 20 (etape-3-ok à etape-9b-ok) |
| État working tree | Clean (aucune modification) |

---

## 11. Non collecté

| Élément | Raison |
|---------|--------|
| Captures d'écran (360, 768, 1440 px) | Lancement app bloqué : migration DB auth Postgres transitoire |
| `npm audit --fix` suggestions détaillées | npm audit JSON fourni brut ; interprétation manuelle requise pour versions major |
| Couverture tests (%) | Aucun script coverage visible ; `npm test` exécute sans flag coverage |
| Détail fichiers server/src/db.ts, env.ts | Fichiers non lus (stratégie lecture focalisée sur routes, config, migrations) |
| Logs déploiement prod complets | Logs stockés dans deploy/out/ (ignoré git) ; VPS non accessible |
| État base données productionelle | Base prod sur VPS, accès ssh refusé (lecture seule) |
| Détails complets API OAuth Discord | Implémentation donnée (routes/discord.ts:1–60) ; paramètres env exclus (secrets) |
| Performance/latence endpoints | Aucune instrumentation observable ; données non disponibles |

