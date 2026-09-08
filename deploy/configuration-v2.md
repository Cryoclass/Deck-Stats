# Transition vers les configurations de deck version 2

Cette procédure accompagne les étapes 2 et 3. Elle prépare le déploiement sans
exécuter la purge des anciens combos prévue à l'étape 8.

## Effets exacts

Après `db/schema.sql`, appliquer `db/migrations/001-deck-configuration.sql` :

- ajoute `decks.revision`, `app_migrations`, `deck_combo_pairs`, `deck_requirements`
  et `deck_flags` ;
- copie les conditions de `deck_start_requirements` **avec source carte seulement** ;
- copie les flags `dead_first`/`dead_second` vers chaque deck du même compte ;
- met à NULL les résumés dérivés `decks.summary` ;
- conserve `combo_pairs`, `deck_pair_exclusions`, les anciennes conditions, les
  cartes, starters, comptes, catégories et affectations ;
- ne crée aucune paire locale depuis une paire globale.

Le journal de migration interdit de rejouer les copies après une modification
utilisateur. Le SQL est transactionnel ; un échec annule également les créations
de tables. Des données sans propriétaire exigent l'adoption historique préalable.

## Déploiement ultérieur

Conserver une sauvegarde complète de la base et le commit de la version en service
avant cette transition. La validation complète de restauration est prévue à
l'étape 8 ; cette livraison n'est pas un déploiement VPS déjà effectué.

`deploy.sh` construit d'abord l'image, attend PostgreSQL, arrête l'ancienne app,
rejoue le schéma, applique la migration puis démarre la nouvelle app. L'arrêt
empêche les écritures de l'ancienne API pendant la copie. Si la migration échoue,
le script s'arrête et **l'app reste arrêtée** ; corriger la donnée signalée puis
relancer, ou remettre l'image précédente après vérification de l'état de la base.
Ne pas servir simultanément ancienne et nouvelle API pendant cette transition.

Les montages Docker Compose exécutent aussi la migration à l'initialisation d'une
base neuve. Ils ne migrent pas un volume déjà initialisé : pour celui-ci, utiliser
le script de déploiement ou la séquence explicite suivante, app arrêtée :

```bash
# Depuis la racine ; adapter uniquement la commande Compose à l'environnement.
docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < db/schema.sql
docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < db/migrations/001-deck-configuration.sql
```

En production, employer les options `--env-file .env.prod -f docker-compose.prod.yml`
depuis `/deploy`, comme dans `deploy.sh`. Ne jamais réutiliser un ancien SQL de
nettoyage du catalogue sans revue : les références de cartes ont évolué.

Contrôles après migration :

```sql
select * from app_migrations where id = '001-deck-configuration';
select count(*) from deck_combo_pairs; -- 0 juste après la première migration
select count(*) from deck_requirements;
select count(*) from deck_flags;
select count(*) from decks where summary is not null; -- 0
-- Les trois tables historiques sont encore présentes et conservées :
select count(*) from combo_pairs;
select count(*) from deck_pair_exclusions;
select count(*) from deck_start_requirements;
```

Comparer les effectifs historiques à l'inventaire préalable. Les données nouvelles
sont distinctes des archives ; aucun `DELETE` de ces dernières n'est fourni ici.
Tester ensuite création/enregistrement/rechargement, duplication, JSON et comparaison.
Un client resté sur une ancienne version doit recharger l'application (HTTP 410
pour les anciennes écritures). Une édition concurrente reçoit HTTP 409 et conserve
son brouillon. Les anciens brouillons navigateur et JSON v1 ne sont plus repris.

## Migration 002 — profils, plafonds partagés et conditions ET/OU (étape 5B)

Après `001-deck-configuration.sql`, appliquer
`db/migrations/002-profiles-and-conditions.sql` (même mécanisme : transaction, verrou
consultatif, journal `app_migrations`, additive) :

- ajoute `nonengine_groups`, `card_flags.availability`, `card_flags.group_id` (avec la
  contrainte « un plafond exige un profil ») et `deck_conditions` ;
- convertit chaque source de `deck_requirements` en **un groupe ET** de feuilles, dans
  l'ordre des identifiants (le premier nomme la condition) ;
- retire `horizonFirst` / `horizonSecond` de `decks.params` ;
- met à NULL `decks.summary` pour tous les decks ;
- ne crée **aucun** profil ni plafond (redéfinition manuelle des cartes) ;
- conserve `deck_requirements`, plus jamais lue ni écrite par l'API.

Elle exige que 001 soit journalisée, s'arrête sur une ligne `deck_requirements`
invalide (aucune création de table ni de colonne ne survit), et se rejoue sans effet.

```bash
docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < db/migrations/002-profiles-and-conditions.sql
```

Contrôles après migration :

```sql
select * from app_migrations where id = '002-profiles-and-conditions';
select count(*) from deck_conditions;              -- = nombre de sources distinctes de deck_requirements
select count(distinct (deck_id, coalesce(source_card_id::text, source_pair_id::text))) from deck_requirements;
select count(*) from decks where params ? 'horizonFirst' or params ? 'horizonSecond'; -- 0
select count(*) from decks where summary is not null; -- 0
select count(*) from nonengine_groups;              -- 0 juste après la migration
select count(*) from card_flags where availability is not null; -- 0 juste après la migration
select count(*) from deck_requirements;             -- inchangé, conservée
```

Après déploiement : un client resté sur l'ancienne version reçoit HTTP 400 à
l'enregistrement (« format antérieur ») et doit recharger ; son brouillon est converti
à la réouverture. Les exports JSON antérieurs restent importables : leurs prérequis ET
sont convertis à l'import par la même règle, leurs catégories perdent leur pertinence,
et aucun profil n'est deviné. Poser ensuite, manuellement, les profils des cartes
étiquetées (mode Profil) : tant qu'une carte étiquetée n'a pas de profil, elle est
listée comme « non comptée » dans le potentiel non-engine.

## Reproduire les tests PostgreSQL sans données existantes

Les identifiants ci-dessous concernent uniquement une base de test jetable. Le test
refuse une URL différente et exige une base vide ; il ne vide jamais une base déjà
existante. Le port 55433 doit être libre. Depuis la racine, sous PowerShell :

```powershell
docker run --name testhand-step23-tests --label purpose=testhand-step23 --rm --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=step23 -e POSTGRES_PASSWORD=step23-disposable -e POSTGRES_DB=step23 -p 127.0.0.1:55433:5432 -d postgres:17-alpine
docker exec testhand-step23-tests pg_isready -U step23 -d step23
# Attendre que pg_isready confirme la disponibilité avant de lancer la suite.
$env:TEST_DATABASE_URL = 'postgres://step23:step23-disposable@127.0.0.1:55433/step23'
npm.cmd run test:integration -w server
docker inspect testhand-step23-tests --format '{{json .Config.Labels}}'
# Arrêter uniquement le conteneur créé ci-dessus, label purpose=testhand-step23.
docker stop testhand-step23-tests
Remove-Item Env:TEST_DATABASE_URL
```

`--rm` supprime ce conteneur après l'arrêt ; les données du montage tmpfs sont
jetables. Un second passage exige de recréer ce conteneur. La suite initialise le
schéma historique, sème des fixtures, éprouve une migration invalide puis valide,
rejoue la migration et utilise les vraies routes Fastify et transactions PostgreSQL.
Elle ne contacte ni Supabase ni le VPS. Les tests authentifient des comptes fictifs
dans leur propre serveur d'injection ; ils ne remplacent pas une recette de connexion.

## Migration 003 — purge du modèle historique (étape 8, partie A)

Après 001 et 002, appliquer `db/migrations/003-purge-legacy.sql` (transaction, verrou
consultatif, journal `app_migrations`, aucun psql-isme). Elle **supprime** :

- `combo_pairs` (paires globales, notes comprises), `deck_pair_exclusions`,
  `deck_start_requirements` (source carte convertie par 001, source paire jamais copiée),
  `deck_requirements` (v2 intermédiaire convertie par 002), avec leurs index et contraintes ;
- `nonengine_categories.relevance` (sans effet depuis 5B) et `card_flags.dead_first` /
  `dead_second` (copiés par deck par 001).

Elle **refuse**, sans rien modifier et en nommant les lignes : 001 ou 002 non journalisée ;
prérequis historique source carte absent de `deck_requirements` (jamais converti) ;
prérequis v2 sans condition ET/OU pour sa source ; horizon encore présent dans
`decks.params` ; rapport non accepté ; après journalisation, objet historique réapparu.

Modes, par GUC de session posée **avant** le fichier :

```bash
# Simulation : tout est joué (contrôles, rapport, suppressions, contrôles après) dans une
# sous-transaction annulée volontairement ; code 0, dernière ligne « SIMULATION TERMINÉE ».
docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -c "set testhand.purge_mode = 'simulate'" -f - < db/migrations/003-purge-legacy.sql
# Application : l'empreinte du rapport de simulation vaut acceptation explicite (purge
# exacte annoncée : une donnée apparue depuis change l'empreinte et bloque).
docker compose exec -T db psql -U ygo -d ygo -v ON_ERROR_STOP=1 -c "set testhand.purge_accept = '<empreinte du rapport>'" -f - < db/migrations/003-purge-legacy.sql
```

Une base neuve (montages `docker-entrypoint-initdb.d`, pile e2e) n'a rien à purger :
003 s'applique sans acceptation. Le rapport (sections `compte`, `P1` paires, `P2`
exclusions, `P3` prérequis source paire, `P4` prérequis v2 convertis, `P5` pertinences,
`P6` drapeaux, `avant`, `résumé`, `empreinte`, `après`, `statut`) sort sur stdout et en
`NOTICE`. Contrôles après migration :

```sql
select * from app_migrations where id = '003-purge-legacy';
select to_regclass('combo_pairs'), to_regclass('deck_pair_exclusions'),
       to_regclass('deck_start_requirements'), to_regclass('deck_requirements'); -- quatre NULL
select count(*) from information_schema.columns where table_name in ('card_flags', 'nonengine_categories')
   and column_name in ('relevance', 'dead_first', 'dead_second');              -- 0
select count(*) from deck_conditions;   -- inchangé par 003 (lignes « après » du rapport)
```

Rejeu : sans effet si journalisée ; un rejeu de `db/schema.sql` ne recrée aucun objet
historique (bloc conditionnel), et 003 refuse tout objet réapparu. `deploy.sh` ne rejoue
pas encore 003 : intégration, sauvegarde préalable, répétition sur dump réel et runbook en
partie B ([docs/etape-8.md](../docs/etape-8.md)).
