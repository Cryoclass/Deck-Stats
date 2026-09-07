# server — spécifique (complète ../AGENTS.md)

- ESM NodeNext : imports internes avec extension `.js` même vers des sources `.ts` ; `rootDir: "."` → l'entrée compilée est `dist/src/index.js`, les scripts `dist/scripts/*.js`.
- Importe `./env.js` avant tout (index, db, scripts) : le `.env` racine est chargé par chemin explicite ; en conteneur tout vient de l'environnement.
- `src/domain/` = contrat pur partagé avec le web (`deckConfiguration.ts`, `deckArchive.ts`) : aucun import Fastify/pg/node. Toute entrée passe par `parseConfiguration`/`parseArchive` avant persistance ; `ConfigurationError` → 400.
- `deckRepository.ts` : l'appelant ouvre la transaction (`tx()` de `db.ts`) et verrouille la ligne deck ; lecture et écriture sont complètes (delete + insert), sauf `deck_combo_pairs` dont les ids restent stables (upsert). Jamais d'écriture partielle.
- Routes : auth (`req.user` posé par la garde globale `preHandler`), transaction, `expectedRevision` (409), anciens endpoints partiels → 410. Toute requête bornée à `owner_id` ; ressource d'autrui → 404, jamais 403 ; références croisées validées en SQL, pas en JS.
- Public = `/api/health` et `/api/auth/*` uniquement ; rate-limit opt-in par route.
- `card_id` = passcode bigint parsé en Number (`db.ts`) ; aucune FK vers `cards`.
- `db/schema.sql` est idempotent (`if not exists`, blocs `do $$`) et rejoué à chaque déploiement ; les évolutions vont dans `db/migrations/NNN-nom.sql` : `begin` … `commit`, `pg_advisory_xact_lock`, journal `app_migrations`, additives (aucun DELETE des tables historiques avant l'étape 8).
- Une nouvelle migration se monte dans `docker-compose.yml` et `deploy/docker-compose.prod.yml`, et se rejoue par stdin dans `deploy/deploy.sh`.
- Tests node:test via tsx : `tests/*.test.ts` unitaires (`npm test`) ; `tests/persistence.integration.ts` (`npm run test:integration`) exige `TEST_DATABASE_URL=postgres://step23:step23-disposable@127.0.0.1:55433/step23`, base vide, conteneur jetable (deploy/configuration-v2.md). Ne pointe jamais un test vers la base de dev.
- Scripts `scripts/*.ts` : simulation par défaut, `--apply` écrit ; garde-fou < 10 000 ids source = abandon ; une carte référencée sans cible sûre est conservée, jamais supprimée.
