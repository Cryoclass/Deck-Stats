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
