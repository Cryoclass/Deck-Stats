# Testhand — consignes agents

## Commandes
- Installer : `npm install` (workspaces `server` + `web` ; Node ≥ 20, Docker, npm).
- Base locale : `npm run db:up` (Postgres 17, port hôte **5433**) · `npm run db:schema` (rejoue db/schema.sql, idempotent) · migrations sur base existante, dans l'ordre : `docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < db/migrations/001-deck-configuration.sql` puis la même commande avec `db/migrations/002-profiles-and-conditions.sql`.
- Catalogue : `npm run migrate` (Supabase → local, upsert) · `npm run prune-cards` (simulation) · `npm run prune-cards -- --apply` · legacy : `npm run adopt -- <email> <mdp>`.
- Dev : `npm run dev` (API :8787 + Vite :5173) ou `npm run dev:server` / `npm run dev:web` ; `./start.ps1` = db + dev.
- Vérifier : `npm run typecheck` · `npm run build` · `npm test` (web Vitest puis server node:test).
- Tests silencieux : `node scripts/test-quiet.mjs` (suite complète) · `node scripts/test-quiet.mjs web/src/engine/engine.test.ts` (un ou plusieurs fichiers). Après une modification ciblée, lance uniquement le fichier de test concerné ; la suite complète seulement avant de conclure une étape.
- Intégration PostgreSQL (base jetable sur 127.0.0.1:55433, procédure dans deploy/configuration-v2.md) : `TEST_DATABASE_URL=… npm run test:integration -w server`.
- Prod : `bash deploy/deploy.sh` s'exécute sur le VPS uniquement (deploy/README.md). Jamais depuis le poste.

## Architecture
Monorepo npm workspaces. `db/` : schéma normatif idempotent + migrations additives numérotées. `server/` : Fastify + pg — `src/domain/` contrat pur (configuration v2, archive JSON) partagé avec le web, `src/routes/` auth/cards/decks/library, `src/auth/` sessions et comptes, `scripts/` maintenance du catalogue. `web/` : Vite + React + Zustand + Tailwind — `src/engine/` moteur exact pur (énumération par composition, couplage maximum), `src/worker/` exécute le moteur hors UI, `src/store/` état de l'éditeur, `src/lib/` API, brouillons IndexedDB, modèle moteur, exports. `deploy/` : image Docker et compose prod derrière le Caddy du VPS. `docs/` : contrat métier, cas de référence, comptes rendus d'étape, spec, charte. Détail : docs/architecture.md ; décisions : docs/decisions-compressees.md.

## Règles
- Avant de toucher au moteur (`web/src/engine`), lis docs/regles-metier.md §4–5 et docs/cas-reference.md. Ne modifie jamais `engine/reference/oracle.ts` ni un test de référence pour faire passer le code.
- Avant de toucher au modèle de deck, aux routes decks/library ou au store, lis docs/etapes-2-3.md et deploy/configuration-v2.md.
- Avant de toucher au schéma ou aux migrations, lis server/AGENTS.md. Aucune table historique supprimée avant l'étape 8.
- Avant de toucher au comparateur ou à l'export Excel, lis docs/spec-comparateur-decks.md et docs/regles-metier.md §5 « Comparateur ».
- Avant de toucher à l'interface, lis docs/design-system.md.
- Avant de toucher à deploy/, lis deploy/README.md. Aucune commande vers le VPS, Supabase ou une base réelle sans demande explicite.
- Toute décision prise en cours de tâche : ajoute-la à DECISIONS.md et une ligne à docs/decisions-compressees.md.
- Ne « corrige » jamais les valeurs de contrôle historiques (33,76 %, 3,54 %, 30,21 %) ni les IDs P/N/S/C/M des cas de référence.
- Commits : Conventional Commits en français (commitlint via husky). Style : aucun linter ni formatter configuré ; `npm run typecheck` est la seule garde, imite le fichier touché.

## Pièges
- `.env` unique à la racine, chargé par `server/src/env.ts` par chemin explicite (les scripts tournent avec cwd `server/`). En conteneur, tout vient de l'environnement. Ne l'affiche jamais (secrets).
- Le SQL monté dans `docker-entrypoint-initdb.d` ne s'exécute que sur un `pgdata/` vierge. Sur une base existante, rejoue schéma et migrations **par stdin** (`-f -`), jamais via le fichier monté (inode figé après `git pull`).
- Nouvelle migration = fichier `db/migrations/NNN-*.sql` + montage dans docker-compose.yml et deploy/docker-compose.prod.yml + rejeu dans deploy/deploy.sh.
- Les tests d'intégration refusent toute URL autre que `postgres://step23:step23-disposable@127.0.0.1:55433/step23` et exigent une base vide : conteneur jetable, jamais le DATABASE_URL de dev.
- `npm run build` affiche un avertissement Vite sur le chunk ExcelJS (~940 kB) : attendu, pas une régression.
- Sous PowerShell les docs utilisent `npm.cmd`. Si Vitest échoue au premier lancement (esbuild, Windows), relance `npm run test -w web -- --no-cache`.
- `web/src/lib/deckConfiguration.ts` importe `server/src/domain/deckConfiguration.ts` par chemin relatif : ce contrat doit rester sans dépendance Node/Fastify/pg.
- Le catalogue `cards` est un lookup sans FK ; `card_id` = passcode, parsé en Number par `server/src/db.ts`. `decks.summary` est un cache invalidé, jamais une source de vérité.
- `migrate`, `prune-cards --apply`, `adopt` écrivent en base : sauvegarde avant, simulation d'abord.
- Anciennes écritures partielles → HTTP 410 ; `PUT /api/decks/:id` exige `expectedRevision` (409 sinon) ; deck d'autrui → 404, jamais 403.
- ExcelJS : import dynamique uniquement (chunk séparé chargé au premier export).
- PowerShell altère les accents d'un script passé à Node par un pipe (encodage par défaut) et ses apostrophes typographiques sont des délimiteurs : pour tout texte français, passe par un fichier explicitement UTF-8 ou un patch ; ne « corrige » jamais du code après une telle corruption.
- Postgres jetable des tests d'intégration : `docker run --rm --tmpfs … -p 127.0.0.1:55433:5432 postgres:17-alpine` (procédure dans deploy/configuration-v2.md) ; le port 55433 doit être libre, ce n'est jamais le 5433 de la base de dev.
- Sous PowerShell, `npm` est `npm.cmd` (`npm.cmd run …`) ; les exemples des docs suivent cette forme.
- En sandbox, esbuild (Vitest) peut être bloqué sur la lecture de `../../../..` et Docker sur son canal : relancer la commande hors sandbox, ne pas modifier la configuration pour contourner.
- Aucun lint ni formatter : `npm run typecheck` et les tests sont les seules gardes ; une suite verte ne dit rien du style, imite le fichier touché.

Plan courant : docs/PLAN.md — lis-le au début de chaque session, ainsi que le dernier compte rendu d'étape.
