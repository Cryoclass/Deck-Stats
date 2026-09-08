# Architecture — où est quoi, comment ça circule

Complète AGENTS.md (commandes, règles, pièges). Sémantique métier : regles-metier.md. Décisions : decisions-compressees.md.

## Flux principaux

1. **Calcul** : composant React → `web/src/store/deckStore.ts` (état éditeur) → `web/src/lib/engineModel.ts` (deck + annotations → `EngineInput`) → `web/src/worker/computeClient.ts` (client possédé par le store : une tâche à la fois, annulée à toute invalidation, réponse adoptée seulement si sa version est encore demandée) → Web Worker → `engine/computeAll` → `EngineResult` (deux `PassResult`, deltas) → sélecteurs, panneau de stats, mode requête et mur de mains (ces deux derniers lisent les `buckets`, sans recalcul).
2. **Enregistrement d'un deck** : bouton Enregistrer → `lib/deckConfiguration.ts` (`configurationFromState`) → `PUT /api/decks/:id { configuration, expectedRevision }` → route (garde auth, transaction, verrou de la ligne, `parseConfiguration`) → `server/src/domain/deckRepository.ts` (écriture complète) → `revision + 1`. Brouillon IndexedDB (`lib/draft.ts`) écrit en continu, indépendant.
3. **Bibliothèque du compte** (HOPT, étiquettes non-engine et affectations, profils de disponibilité, plafonds partagés) : écriture immédiate via `/api/library/*`, sans passer par Enregistrer ; chaque écriture invalide `decks.summary` des decks concernés du compte.
4. **Comparateur** : deux `DeckDetail` + bibliothèque → même `engineModel` → worker mode `passes` → `engine/compare.ts` (pur) → page + export Excel (`lib/exportComparison.ts`, ExcelJS en import dynamique).
5. **Catalogue** : Supabase (clé anon, lecture) → `server/scripts/migrate-cards.ts` → table locale `cards` + `catalog_version` ; `prune-stale-cards.ts` reporte puis supprime les passcodes périmés. Images dérivées de l'id via le CDN YGOPRODeck.
6. **Auth** : cookie de session httpOnly → `server/src/auth/session.ts` → garde `preHandler` globale pose `req.user` ; côté web, `lib/auth.tsx` rend la page de connexion à la place de la route demandée ; 401 sur route protégée → événement `ygo:unauthorized`.

## Dossiers

| Chemin | Rôle |
| --- | --- |
| `db/schema.sql` | Schéma idempotent (catalogue, comptes, decks, bibliothèque, tables historiques), rejoué à chaque déploiement |
| `db/migrations/NNN-*.sql` | Migrations transactionnelles journalisées dans `app_migrations` : 001 et 002 additives ; 003 (étape 8) purge le modèle historique après simulation (GUC `testhand.purge_mode`) et acceptation par empreinte (`testhand.purge_accept`) |
| `server/src/index.ts` | Fastify : CORS, cookies, rate-limit, garde globale, `/api/health`, service du front en prod (`WEB_DIST`) |
| `server/src/env.ts`, `db.ts` | Chargement du `.env` racine ; pool pg, `query`, `tx` ; bigint → Number |
| `server/src/auth/` | scrypt, sessions (SHA-256 du token), création de compte + catégories de base |
| `server/src/domain/` | `deckConfiguration.ts` (contrat v2 pur, partagé avec le web : cartes, starters, paires, conditions ET/OU par source, `upgradeConfiguration` pour les documents antérieurs à l'étape 5B), `deckArchive.ts` (JSON v2 avec profils et plafonds), `deckRepository.ts` (SQL des configurations) |
| `server/src/routes/` | `auth`, `discord`, `cards`, `decks`, `library` |
| `server/scripts/` | `migrate-cards`, `prune-stale-cards` (emplacements v2, refuse avant 003), `adopt-legacy` (avant 001 seulement) — compilés dans l'image |
| `server/tests/` | `*.test.ts` unitaires (node:test), `persistence.integration.ts` puis `purge.integration.ts` (PostgreSQL jetable ; fixture `fixtures/legacy-representative.sql`) |
| `web/src/engine/` | Moteur exact pur à contexte unique (`'first'` = 5 cartes, `'second'` = 5 + sixième identifiée) : `binomial` (bigint), `matching` (couplage maximum), `evaluate` (prepare/evaluate, conditions ET/OU, profils de disponibilité, HOPT, plafonds partagés par coupe minimale, starts désactivés, signatures), `enumerate` (computePass/computeAll, issues pondérées Z, buckets avec unités couplées, deltas), `hand` (tirage et note), `query` (critères, potentiel par catégorie sous plafonds), `compare` (comparateur, garde de contexte), `reference/` (oracle de l'étape 1 + `deckOracle` + `monteCarlo`, tests P/N/S/C/M et chronologie) |
| `web/src/worker/` | `engine.worker.ts` (calcule, c'est tout ; erreur relayée avec l'id), `computeClient.ts` (client pur : propriété des tâches, annulation par `terminate`, promesses toujours réglées), `fakeWorker.ts` (faux worker contrôlable, tests), `client.ts` (seul import du worker Vite) |
| `web/src/store/` | `deckStore.ts` (état éditeur, dirty, révision, ouvertures numérotées, recalcul versionné `modelVersion`/`resultVersion`, `stale`, `resultContext`, debounce, annulation), `selectors.ts` |
| `web/src/lib/` | `api.ts`, `auth.tsx`, `router.tsx` (`/decks`, `/decks/:id`, `/compare/:a/:b`), `deckConfiguration.ts`, `conditions.ts` (opérations pures sur l'arbre ET/OU, traduction vers le moteur), `draft.ts`, `engineModel.ts` (profils, plafonds, conditions → `EngineInput` ; cartes étiquetées sans profil listées), `exportDeck.ts`, `exportComparison.ts`, `ydk.ts`, `fmt.ts`, `colors.ts` |
| `web/src/components/` | Pages (Home, Editor, Compare, Login), grille d'annotation et modes, combos, inventaire, stats, requête, mur de mains, dialogues |
| `deploy/` | `Dockerfile` (multi-étages, Node 22), `docker-compose.prod.yml` (db + app, aucun port publié, réseau `edge`), `lib.sh` (accès base, empreintes, séquence de migration partagée), `deploy.sh`, `backup.sh` (archive vérifiée : `.sha256`, `ygo_verify`, `.fingerprint`, `keep/` hors rétention), `restore.sh` (réversible, `--check-only`), `rehearsal.sh` (répétition sur copie jetable), `fingerprint.sql`, `inventory.sql`, `check-migration.sql`, `test-backup-restore.sh`, `test-migration-sequence.sh`, `configuration-v2.md` ; `out/` ignoré par git (rapports, archives de répétition, ancien moteur matérialisé) |
| `scripts/` | `test-quiet.mjs` (tests silencieux), `recompute-check.ts` (étape 8B : ancien moteur e890078 matérialisé depuis git en référence sur la base pré-migration, nouveau moteur avec paires réinjectées puis après purge ; `--fabricate` pour le jeu représentatif), `tsconfig.json` (typecheck racine), paquet ESM |
| `docs/` | `regles-metier.md`, `cas-reference.md`, `etapes-*.md`, `PLAN.md`, `spec-comparateur-decks.md`, `design-system.md`, `deploy-runbook.md` (exécution 8C) |

## API (préfixe `/api`, JSON, cookie de session sauf mention)

- Public : `GET /health` ; `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/providers` ; `GET /auth/discord/start`, `GET /auth/discord/callback`, `DELETE /auth/discord` (déliaison, en session).
- Catalogue : `GET /cards?ids=`, `GET /cards/search?q=&limit=`.
- Decks : `GET /decks`, `POST /decks`, `POST /decks/import`, `GET /decks/:id`, `PUT /decks/:id` (configuration complète + `expectedRevision`, 409 si périmée), `PATCH /decks/:id` (nom), `POST /decks/:id/duplicate`, `DELETE /decks/:id`. `PUT /decks/:id/{starters,pair-exclusions,start-requirements}` → 410.
- Bibliothèque : `GET /library` (HOPT, catégories, affectations, `profiles`, `groups`), `PUT /library/flags/:cardId` (`is_hopt`, `availability`, `group_id`, champs absents inchangés ; profil sans étiquette ou plafond sans profil → 400), `POST /library/categories`, `DELETE /library/categories/:id`, `POST /library/card-categories`, `DELETE /library/card-categories/:cardId/:categoryId`, `POST /library/groups`, `PATCH /library/groups/:id`, `DELETE /library/groups/:id`. `POST /library/pairs`, `DELETE /library/pairs/:id` → 410.
- Erreurs : 400 `ConfigurationError`, 401 non authentifié, 404 ressource absente ou d'autrui, 409 révision, 410 endpoint retiré.

## Base de données

- Catalogue : `cards` (id = passcode, lookup sans FK), `catalog_version` (une ligne).
- Comptes : `users`, `sessions`, `user_identities`.
- Deck (local, via Enregistrer) : `decks` (`revision`, `params` jsonb, `notes`, `summary` jsonb invalidé), `deck_cards`, `deck_starters`, `deck_combo_pairs`, `deck_conditions` (une condition ET/OU jsonb par source), `deck_flags`.
- Bibliothèque du compte : `card_flags` (`is_hopt`, `availability`, `group_id`), `nonengine_categories` (étiquette : `name`, `is_builtin`), `card_categories`, `nonengine_groups` (plafonds partagés par tour).
- Modèle historique (`combo_pairs`, `deck_pair_exclusions`, `deck_start_requirements`, `deck_requirements`, `nonengine_categories.relevance`, `card_flags.dead_first` / `dead_second`) : purgé par la migration 003 (étape 8) ; `db/schema.sql` ne le recrée que tant que 003 n'est pas journalisée, parce que 001 le lit sur une base neuve.
- Journal : `app_migrations`.

## Environnement

`DATABASE_URL`, `PORT`, `INVITE_CODES`, `APP_ORIGIN`, `COOKIE_SECURE`, `TRUST_PROXY`, `DISCORD_CLIENT_ID/SECRET/REDIRECT_URI` (+ `DISCORD_AUTHORIZE_URL/TOKEN_URL/USER_URL` pour un mock), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_DIST` (prod), `WEB_PORT`, `API_PROXY` (Vite), `TEST_DATABASE_URL` (intégration), `NODE_ENV`.
