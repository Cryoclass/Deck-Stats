# Runbook 8C — déploiement de l'étape 8 sur le VPS

Procédure d'exécution, commande par commande, de la migration 001 → 002 → 003 en production
avec les scripts livrés en 8B (`deploy/deploy.sh`, `backup.sh`, `restore.sh`, `lib.sh`). Elle a
été répétée à l'identique sur le dump réel du 8 septembre 2026 et sur le jeu représentatif
(docs/etape-8.md, « Compte rendu 8B »). Rien ici n'a encore été exécuté sur le VPS.

> **Décision prise après 8B (8 septembre 2026) : la production repart d'une base vide.** Rien
> n'est conservé (ni decks, ni comptes, ni annotations). L'archive de l'état actuel est prise,
> vérifiée et copiée hors VPS par principe (souvenir), mais elle n'est plus un chemin de retour
> à préparer. La procédure à suivre est la **variante « départ à vide »** ci-dessous, qui
> remplace les §3, §4 et §5 ; §0 (répétition sur archive fraîche) devient inutile, §1 et §2 sont
> inchangés, §6 est adapté dans la variante, §7 et §8 restent valables. Les §3 à §5 sont
> conservés pour mémoire : ils décrivent la migration d'une base conservée.

## Avant de commencer

- **État attendu de la production** : base pré-001 (14 tables, aucun journal `app_migrations`),
  ancienne API en service, cron `backup.sh` à 03:17 (journal `~/ygo-backup.log`).
- **Ce que 003 purgera** (rapport de 8A, reproduit en 8B) : 185 paires globales, 15 exclusions,
  0 prérequis source paire, 4 pertinences de catégories, 0 drapeau ; 15 prérequis v2 convertis
  retirés avec leur table ; 204 lignes ; empreinte `e0efff5c2ddacc8d27bbd9e9e76694b1` si aucune
  paire, exclusion, prérequis, catégorie ou drapeau n'a bougé depuis le dump du 8 septembre. Les
  185 paires sont ressaisies à la main après coup (décision prise en 8B, aucune conversion).
- **Deux terminaux** : T1 = SSH sur le VPS (`ssh ubuntu@137.74.172.32`), T2 = Git Bash à la racine
  du dépôt local, Docker Desktop en marche (vérification de l'archive copiée).
- **Indisponibilité** : l'app est arrêtée de « arrêt de l'app » jusqu'à « démarrage de l'app »,
  soit la migration (≈ 2 min) plus le temps de lire le rapport et de copier l'archive (§4). Choisir
  un créneau calme ; ne pas laisser T1 en attente plus longtemps que nécessaire.
- **Règles** (docs/etape-8.md, Q7 et Q8) : le point de non-retour est la saisie de `OUI` ; un
  rapport refusé démarre la nouvelle app sans 003 ; seul un contrôle après migration en échec
  laisse l'app arrêtée, avec la commande de restauration affichée.
- **Ne jamais** taper Ctrl-C pendant `deploy.sh` : répondre autre chose que `OUI` rend l'app
  (code 3). Ne jamais modifier un script de `deploy/` pendant qu'il tourne (bash le lit au fil de
  l'eau).

## 0. La veille, en local (T2)

```bash
git status --short && git log -1 --oneline && git tag --points-at HEAD     # propre, étape-8b-ok
```

Si la production a bougé depuis le 8 septembre (paires, catégories, decks), répéter d'abord sur
une archive fraîche du cron pour connaître la nouvelle empreinte attendue :

```bash
scp ubuntu@137.74.172.32:/var/backups/ygo-proba/ygo-<AAAAMMJJ-HHMMSS>.sql.gz ../testhand-dumps/
bash deploy/rehearsal.sh ../testhand-dumps/ygo-<AAAAMMJJ-HHMMSS>.sql.gz --skip-e2e
```

Attendu : `RÉPÉTITION CONFORME`, et dans `deploy/out/rehearsal-<horodatage>/rapport.md` la ligne
`empreinte | empreinte du rapport : <nouvelle empreinte>` à utiliser au §3 (`--expect`).

## 1. Code à jour sur le VPS (T1)

```bash
cd ~/apps/ygo-proba
git rev-parse --short HEAD          # NOTER ce commit : c'est le retour arrière du code (§7)
git pull --ff-only
git log -1 --oneline                # attendu : le commit de l'étape 8B
git tag --points-at HEAD            # attendu : etape-8b-ok
```

Retour arrière à ce stade : `git checkout <commit noté>` ; l'app en service n'est pas touchée
(elle tourne dans son image).

## 2. État des lieux et sauvegarde quotidienne vérifiée (T1)

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml ps        # db et app « Up »
tail -n 2 ~/ygo-backup.log                                               # dernière « sauvegarde ok »
df -h /var/backups                                                       # place : ≈ 1,5 Mo par archive
curl -s https://analysis.scratchrecode.com/api/health                    # {"ok":true,"cards":14529,...}
bash backup.sh
```

Sortie attendue de `backup.sh` (première exécution de l'extension 8B en production, app en
marche) :

```text
<date> sauvegarde ok: ygo-<horodatage>.sql.gz (1.5M)
<date> sauvegarde vérifiée: ygo-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
```

Une mention « (tables modifiées pendant la sauvegarde, non vérifiables : sessions) » est normale
si quelqu'un est connecté. Une ligne « sauvegarde NON vérifiée » arrête tout : ne pas déployer,
lire la raison (`ygo_verify` impossible ? restauration en échec ?). Rien n'a été modifié.

## Variante « départ à vide » — remplace §3, §4 et §5

Ce que la base neuve reçoit, et comment (vérifié le 8 septembre 2026 sur conteneurs jetables,
docs/etape-8.md « Préparation de 8C : départ à vide ») :

- **Le schéma et les migrations.** Un volume PostgreSQL neuf est initialisé par les quatre
  fichiers montés dans `docker-entrypoint-initdb.d` (`docker-compose.prod.yml` : `00-schema`,
  `01`, `02`, `03`) au premier démarrage du conteneur `db`, en ≈ 5 s. Sur une base neuve, 003
  n'a rien à purger et se journalise sans acceptation. `deploy.sh` trouve ensuite 003
  journalisée : schéma rejoué seul, aucune simulation, aucune question, contrôles, app démarrée
  (code 0, ≈ 20 s hors build).
- **Le catalogue de cartes.** Il n'est chargé ni au premier démarrage ni par l'app : `/api/health`
  répond `{"ok":true,"cards":0,"catalog":null}` tant qu'on ne l'a pas copié. La copie se fait par
  le script de maintenance embarqué dans l'image, `server/dist/scripts/migrate-cards.js`,
  exécuté dans le conteneur `app` (deploy/README.md §8) : lecture de la Supabase publique par
  PostgREST avec la clé anon par défaut (aucune clé à mettre dans `.env.prod`), 1 000 cartes par
  page, upsert par lots de 500, puis estampille `catalog_version` (version annoncée par la
  source, nombre annoncé, copié, local). Mesuré en local : 14 529 cartes, version source
  `2026-08-31`, 13 à 16 s, base de 22 Mo. Rejouable sans risque (idempotent).
- **Le compte** se crée au navigateur (onglet Inscription, code d'invitation de `INVITE_CODES`
  dans `.env.prod`) ; les catégories intégrées « Handtrap » et « Board breaker » sont posées à la
  création. Les decks se réimportent depuis leurs fichiers YDK.

Indisponibilité : de V1 (arrêt de l'app) à la fin de V4 (app démarrée), soit la sauvegarde
souvenir (≈ 1 min), la copie et sa vérification, la suppression du volume, puis `deploy.sh`
(build de l'image, plusieurs minutes la première fois, puis ≈ 30 s). Le catalogue (V5) se charge
app en marche.

### V1. Arrêt de l'app et sauvegarde souvenir vérifiée (T1)

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml stop app
bash backup.sh --keep souvenir
```

Attendu :

```text
<date> sauvegarde ok: keep/ygo-souvenir-<horodatage>.sql.gz (1.5M)
<date> sauvegarde vérifiée: keep/ygo-souvenir-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
```

Mode `keep` : vérification stricte, l'app doit être arrêtée (une table qui bouge pendant
l'export est un échec, pas une note). Une ligne « sauvegarde NON vérifiée » arrête tout :
lire la raison, relancer ; ne pas continuer sans archive vérifiée. Noter l'horodatage.

### V2. Copie hors VPS et vérification (T2)

```bash
mkdir -p ../testhand-dumps
scp 'ubuntu@137.74.172.32:/var/backups/ygo-proba/keep/ygo-souvenir-<horodatage>.sql.gz*' ../testhand-dumps/
ls -la ../testhand-dumps/ygo-souvenir-<horodatage>.sql.gz*        # .sql.gz, .sha256, .fingerprint
docker run --name testhand-verify-db --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo -p 127.0.0.1:55441:5432 -d postgres:17-alpine
sleep 8
TESTHAND_DB_CONTAINER=testhand-verify-db bash deploy/restore.sh ../testhand-dumps/ygo-souvenir-<horodatage>.sql.gz --check-only
docker stop testhand-verify-db
```

Attendu : mêmes lignes qu'au §4b (`somme SHA-256 exacte`, `empreinte enregistrée`, restauration
de contrôle identique, `16 deck(s), 14529 carte(s) au catalogue`, `archive vérifiée: …`). Un
refus = copie altérée : recopier ; tant que la copie n'est pas vérifiée, ne pas passer à V3.

### V3. Base recréée vide (T1) — point de non-retour

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml down     # app et db arrêtés et supprimés, volumes conservés
docker volume ls | grep ygo-proba                                        # attendu : ygo-proba_pgdata
docker volume rm ygo-proba_pgdata                                        # POINT DE NON-RETOUR
docker volume ls | grep ygo-proba                                        # attendu : rien
```

À partir d'ici, seule l'archive souvenir (V1, copiée en V2) porte l'ancien état ; les bases de
travail `ygo_verify` / `ygo_previous` disparaissent avec le volume, c'est attendu. `down` retire
aussi le réseau par défaut de la pile (recréé par `deploy.sh`) ; le réseau externe `edge` et le
Caddy goldfish ne sont pas touchés.

Alternative sans supprimer le volume (conteneur `db` conservé, app arrêtée) : recréer la seule
base `ygo` — `docker compose … exec -T db dropdb -U ygo ygo` puis `… createdb -U ygo -O ygo ygo`.
La base est alors vide **sans** passage par `initdb` : `deploy.sh` rejoue schéma, 001, 002, puis
003 en simulation (« à purger : 0 ligne(s) », « rien à purger : aucune acceptation requise »),
003 réelle (« 0 ligne(s) supprimée(s) ») et le contrôle « OK|base vide au départ (aucune table
avant le schéma) » (ajouté pour ce cas, prouvé par le cas G de `test-migration-sequence.sh`).
Aucune question non plus. Le chemin principal reste la suppression du volume.

### V4. `deploy.sh` — aucune question attendue (T1)

```bash
bash deploy.sh
```

Sortie attendue, dans l'ordre (horodatages omis) :

```text
Already up to date.                         (git pull)
... build de l'image (plusieurs minutes la première fois)
==> Attente de la DB...                     (conteneur db recréé : initdb joue 00-schema, 01, 02, 03 ; ≈ 5 s)
séquence de migration — dossier : .../deploy/out/deploy-<horodatage> — acceptation : OUI au terminal
arrêt de l'app (aucune écriture pendant la transition)          (aucun conteneur app : sans effet)
empreinte de la base avant toute modification (fingerprint-0.txt)
sauvegarde pré-migration vérifiée (obligatoire, hors rétention)
    <date> sauvegarde ok: keep/ygo-pre-migration-<horodatage>.sql.gz (4.0K)
    <date> sauvegarde vérifiée: keep/ygo-pre-migration-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
archive pré-migration : /var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz — ...
inventaire avant migration (inventory-before-*)
inventaire : 16 table(s), journal « 001-deck-configuration,002-profiles-and-conditions,003-purge-legacy », 0 résumé(s) non nul(s), modèle historique : 0 paire(s) globale(s), 0 exclusion(s) ou prérequis source paire
003 déjà journalisée : 001 et 002 ne se rejouent plus (001 recréerait deck_requirements), schéma seulement
rejeu par stdin : db/schema.sql
003 en simulation (rapport : .../003-simulation.txt)
003 déjà journalisée : aucun effet, contrôles seulement
contrôles après migration (check-migration.txt, fingerprint-3.txt)
    OK|journal 001-deck-configuration : journalisée
    ... (une trentaine de lignes OK|, aucune KO| ; dont « OK|decks : 0 »)
    OK|tables intactes de bout en bout (effectif et contenu) : cards catalog_version users user_identities sessions deck_cards deck_starters card_categories
    OK|003 n'a touché que ses propres objets ...
démarrage de l'app
... docker compose up -d, ps : db et app « Up »
séquence terminée : ok
==> Rapports : .../deploy/out/deploy-<horodatage>
==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health
```

Code 0, **aucune question**. L'archive « pré-migration » de 4 Ko est celle de la base vide déjà
à 003 : attendue, sans intérêt, laissée dans `keep/`. Points de lecture :

- la ligne `inventaire :` porte `16 table(s)`, les trois migrations au journal, `0 résumé(s)`,
  `0 paire(s)` ;
- **si `deploy.sh` pose une question** (`Appliquer la purge … ?`), ou affiche `rejeu par stdin :
  db/migrations/001…`, une simulation `à purger : N ligne(s)` avec N ≥ 1, un inventaire à
  `14 table(s)` ou des résumés / paires non nuls : **la base n'était pas vide** (volume non
  supprimé, mauvais nom, mauvaise pile). Répondre autre chose que `OUI` (`NON`) : code 3, nouvelle
  app démarrée sans 003 sur l'ancienne donnée, rien de purgé. Arrêter, comprendre (`docker volume
  ls`, `inventory-before-counts.txt`), ne pas relancer avant d'avoir la cause ;
- avec l'alternative `dropdb` / `createdb` de V3, la sortie attendue diffère : `inventaire : 0
  table(s), journal «  »`, rejeu de 001 et 002, `simulation terminée … à purger : 0 ligne(s)`,
  `rien à purger : aucune acceptation requise`, `PURGE APPLIQUÉE : … 0 ligne(s) supprimée(s)`,
  `OK|base vide au départ (aucune table avant le schéma)`. Là aussi, toute question = base non
  vide, répondre `NON`.

Santé juste après : `{"ok":true,"cards":0,"catalog":null}` (catalogue pas encore chargé).

Échecs possibles : ceux de l'annexe A. Sur base vide, un code 1 avant 003 laisse une base vide et
aucun conteneur app (l'« ancienne app » n'existe plus : `dc start app` échoue, sans effet) :
lire `journal.txt`, corriger, relancer `deploy.sh`.

### V5. Catalogue de cartes (T1)

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml exec app node server/dist/scripts/migrate-cards.js
curl -s https://analysis.scratchrecode.com/api/health
```

Attendu (≈ 15 s, selon le réseau du VPS) :

```text
→ Connexion au Postgres local: postgres://ygo:***@db:5432/ygo
→ Version source: 2026-08-31 (14529 cartes annoncées, empreinte <…>)
→ Colonnes copiées: id, name, type, race, attribute, atk, def, level, description, image_url, image_url_small, image_url_cropped
→ 14529 cartes copiées…
✓ Migration terminée. Table locale cards: 14529 lignes.
✓ Catalogue estampillé version 2026-08-31.
{"ok":true,"cards":14529,"catalog":{"version":"2026-08-31","migratedAt":"…","cards":14529}}
```

Le nombre exact est celui que la source annonce le jour J (14 529 pour la version `2026-08-31`) ;
`cards`, `catalog.cards` et le nombre annoncé doivent être égaux entre eux. Une ligne
`⚠ … aucune estampille posée` (source passée à une nouvelle version pendant la copie, ou écart
entre annoncé et copié) : relancer la commande, elle est idempotente. Une erreur `Supabase 4xx /
5xx` : la source est injoignable depuis le VPS, réessayer plus tard ; l'app reste utilisable
sans catalogue (recherche vide).

### V6. Création du compte (navigateur)

Sur https://analysis.scratchrecode.com : onglet **Inscription**, email, mot de passe, nom
affiché, code d'invitation (un des `INVITE_CODES` de `.env.prod`, à lire sur le VPS :
`grep INVITE_CODES ~/apps/ygo-proba/deploy/.env.prod`). Connexion Discord possible ensuite ou à
la place (le code d'invitation est demandé à la première venue). Attendu après connexion :
« Mes decks » vide, invitation à importer un YDK.

### V7. Contrôles après déploiement (§6 adapté)

```bash
curl -s https://analysis.scratchrecode.com/api/health       # cards = catalog.cards = nombre annoncé (14529 le 8 sept. 2026)
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 30 app
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select id, applied_at from app_migrations order by id"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select (select count(*) from users) as users, (select count(*) from decks) as decks, (select count(*) from cards) as cards"
```

Attendu : trois lignes `001-deck-configuration`, `002-profiles-and-conditions`,
`003-purge-legacy` (les `applied_at` des trois à quelques secondes d'intervalle, au premier
démarrage du conteneur `db`) ; `users 1, decks 0, cards 14529` ; aucune erreur dans les journaux.

Au navigateur :

1. « Mes decks » : 0 deck, aucun aperçu.
2. Catalogue complet : « + Nouveau deck », puis « Ajouter une carte » : une recherche par nom
   (par exemple une carte récente de la version `2026-08-31`) renvoie la carte avec son image.
3. Import YDK : « + Importer un deck » avec un fichier `.ydk` local (un export de l'ancienne
   base ou un deck de test) ; l'aperçu d'import rapporte les cartes reconnues, les passcodes hors
   catalogue sont nommés et non réduits ; accepter ; main deck complet, starters posables,
   statistiques calculées (« départs théoriques »), premier / second.
4. Enregistrer, puis recharger : la révision s'incrémente, le deck se rouvre identique ;
   enregistrer sans modification à nouveau : même comportement.
5. Comparateur : « Dupliquer » le deck depuis l'accueil, ouvrir le comparateur sur les deux :
   matrices affichées (Δ à « · » partout : decks identiques), export Excel téléchargeable.
6. Bibliothèque : catégories « Handtrap » et « Board breaker » présentes (intégrées, posées à la
   création du compte), aucune pertinence ; mode Profil disponible.

Le lendemain : `tail -n 2 ~/ygo-backup.log` montre « sauvegarde ok » puis « sauvegarde
vérifiée » (première archive quotidienne de la base neuve, ≈ 1,5 Mo avec le catalogue).

### Retour arrière et après coup

- §7 inchangé, avec l'archive souvenir : `bash restore.sh /var/backups/ygo-proba/keep/ygo-souvenir-<horodatage>.sql.gz`
  (restauration de contrôle dans `ygo_restore` sur le nouveau volume, sauvegarde de sécurité de
  la base neuve dans `keep/`, bascule), puis le code noté au §1 (la base restaurée est pré-001).
- §8 : la ressaisie des 185 paires est **sans objet** (aucun deck repris) ; les decks utiles se
  réimportent depuis leurs fichiers YDK ; l'archive souvenir reste la seule trace de l'ancien
  état (paires globales lisibles en SQL si besoin).

## 3. Lancement (T1) — base conservée, pour mémoire

```bash
bash deploy.sh --expect e0efff5c2ddacc8d27bbd9e9e76694b1
```

Sortie attendue, dans l'ordre (les horodatages sont omis) :

```text
Already up to date.                         (git pull)
... build de l'image (plusieurs minutes la première fois)
==> Attente de la DB...
séquence de migration — dossier : .../deploy/out/deploy-<horodatage> — acceptation : OUI au terminal
arrêt de l'app (aucune écriture pendant la transition)
empreinte de la base avant toute modification (fingerprint-0.txt)
sauvegarde pré-migration vérifiée (obligatoire, hors rétention)
    <date> sauvegarde ok: keep/ygo-pre-migration-<horodatage>.sql.gz (1.5M)
    <date> sauvegarde vérifiée: keep/ygo-pre-migration-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
archive pré-migration : /var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz — sha256 <64 hex> — empreinte <32 hex>
inventaire avant migration (inventory-before-*)
inventaire : 14 table(s), journal «  », 16 résumé(s) non nul(s), modèle historique : 185 paire(s) globale(s), 15 exclusion(s) ou prérequis source paire
rejeu par stdin : db/schema.sql
rejeu par stdin : db/migrations/001-deck-configuration.sql
rejeu par stdin : db/migrations/002-profiles-and-conditions.sql
003 en simulation (rapport : .../003-simulation.txt)
simulation terminée, code 0, marqueur présent — à purger : 204 ligne(s) — P1 paires 185, P2 exclusions 15, P3 prérequis source paire 0, P5 pertinences 4, P6 drapeaux 0 ; P4 prérequis v2 convertis retirés avec leur table : 15
empreinte du rapport : e0efff5c2ddacc8d27bbd9e9e76694b1
──── Rapport de simulation de 003 — extrait ; fichier complet : ... ────
compte | compte 70f2598f-... : 185 paire(s) globale(s), 15 exclusion(s), 0 prérequis source paire, 16 deck(s)
résumé | à purger : 204 ligne(s) — ...
empreinte | empreinte du rapport : e0efff5c2ddacc8d27bbd9e9e76694b1
statut | SIMULATION TERMINÉE : purge jouée puis annulée volontairement, aucune modification. ...
P1 : 185 ligne(s) — premières lignes : ...
P2 : 15 ligne(s) ...   P4 : 15 ligne(s) ...   P5 : 4 ligne(s) ...
Empreinte attendue e0efff5c2ddacc8d27bbd9e9e76694b1 : IDENTIQUE au rapport.
POINT DE NON-RETOUR : 204 ligne(s) seront supprimées. Relire le rapport complet, puis taper OUI ...
Appliquer la purge e0efff5c2ddacc8d27bbd9e9e76694b1 ?
```

`deploy.sh` attend. Noter l'horodatage de l'archive pré-migration et les deux empreintes
(archive et rapport). Ne pas répondre avant le §4.

Si la séquence s'arrête avant la question :

| Message | Code | État | Que faire |
| --- | --- | --- | --- |
| `sauvegarde pré-migration en échec` ou `l'archive pré-migration ne porte pas l'empreinte de la base` | 1 | base intacte, ancienne app relancée | lire `deploy/out/deploy-<horodatage>/backup.log`, corriger, relancer §3 |
| `db/schema.sql en échec`, `001… en échec`, `002… en échec` | 1 | transaction annulée, ancienne app relancée | lire `psql.err` ; la donnée fautive est nommée (adoption, prérequis invalide) |
| `003 refusée ou en erreur en simulation` | 1 | 001 et 002 appliquées, nouvelle app démarrée sans 003 | lire `003-simulation.txt.err` : refus nominatif (deck, prérequis, horizon) ; corriger la donnée, relancer §3 (le rejeu de 001/002 est sans effet) |

## 4. Avant de répondre : copie hors VPS, vérification, lecture du rapport (T2, puis T1)

### 4a. Copier l'archive pré-migration et ses compagnons (T2)

```bash
mkdir -p ../testhand-dumps
scp 'ubuntu@137.74.172.32:/var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz*' ../testhand-dumps/
ls -la ../testhand-dumps/ygo-pre-migration-<horodatage>.sql.gz*        # .sql.gz, .sha256, .fingerprint
```

### 4b. Vérifier l'archive copiée sur un conteneur jetable (T2)

```bash
docker run --name testhand-verify-db --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo -p 127.0.0.1:55441:5432 -d postgres:17-alpine
sleep 8
TESTHAND_DB_CONTAINER=testhand-verify-db bash deploy/restore.sh ../testhand-dumps/ygo-pre-migration-<horodatage>.sql.gz --check-only
docker stop testhand-verify-db
```

Attendu :

```text
==> somme SHA-256 exacte : <64 hex>                        = la somme affichée par deploy.sh
==> empreinte enregistrée : <32 hex>                        = l'empreinte « archive pré-migration » de deploy.sh
==> 3. Restauration de contrôle dans ygo_restore
==> empreinte de la restauration de contrôle identique à l'empreinte enregistrée
==> restauration de contrôle : 16 deck(s), 14529 carte(s) au catalogue
<date> archive vérifiée: ygo-pre-migration-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex> (--check-only : rien n'a été modifié)
```

Un refus (somme différente, empreinte différente) signifie une copie altérée : recopier (§4a),
et si le refus persiste, répondre NON au §5 et comprendre avant tout.

### 4c. Lire le rapport complet (T1, seconde session SSH, ou copie sur T2)

```bash
less ~/apps/ygo-proba/deploy/out/deploy-<horodatage>/003-simulation.txt
```

À lire avant d'accepter :

1. `compte |` : une seule ligne, `185 paire(s) globale(s), 15 exclusion(s), 0 prérequis source
   paire, 16 deck(s)`.
2. `résumé |` : `à purger : 204 ligne(s) — P1 paires 185, P2 exclusions 15, P3 prérequis source
   paire 0, P5 pertinences 4, P6 drapeaux 0 ; P4 prérequis v2 convertis retirés avec leur table :
   15`.
3. `empreinte |` : `e0efff5c2ddacc8d27bbd9e9e76694b1`.
4. `avant |` : `combo_pairs : 185`, `deck_pair_exclusions : 15`, `deck_start_requirements : 15
   (source carte 15, source paire 0)`, `deck_requirements : 15`, `card_flags.dead_first /
   dead_second vrais : 0`.
5. `P4 |` : 15 lignes, toutes `origine : prérequis historique converti par 001` et `condition
   conservée` — ce sont les seules conditions de start reprises dans la nouvelle app.
6. `P5 |` : 4 lignes (les catégories du compte, la colonne `relevance` disparaît, les catégories
   restent).
7. `P1 |` : 185 lignes, cartes nommées ; une paire `1111 « hors catalogue » + 2222 « hors
   catalogue »` est connue (paire de test).
8. `statut |` : `SIMULATION TERMINÉE`.

**Si l'empreinte diffère** de `e0efff5c…` (message « DIFFÉRENTE du rapport ») : chaque écart doit
s'expliquer par une action faite depuis le 8 septembre. Comparer avec le rapport de 8A joint à
docs/etape-8.md, depuis T2 :

```bash
scp ubuntu@137.74.172.32:~/apps/ygo-proba/deploy/out/deploy-<horodatage>/003-simulation.txt ../testhand-dumps/
for s in P1 P2 P3 P4 P5 P6; do echo "== $s"; diff <(grep "^$s | " ../testhand-dumps/003-simulation.txt) <(grep "^$s | " docs/etape-8.md); done
```

Une ligne `>` (dans 8A, plus dans le rapport réel) = donnée disparue ; une ligne `<` = donnée
apparue. Une paire ajoutée ou retirée dans l'ancienne app, une exclusion posée, une catégorie
créée expliquent un écart. Un écart inexpliqué = répondre NON (§5) et analyser sur une archive
fraîche (§0).

## 5. Point de non-retour (T1)

Taper `OUI` puis Entrée. Toute autre réponse (ou une session sans terminal) refuse : la nouvelle
app démarre sans 003 (code 3, 001 et 002 appliquées, tables historiques encore présentes) ;
`deploy.sh` peut être relancé plus tard, il refera sauvegarde, inventaire, simulation et question.

Sortie attendue après `OUI` :

```text
rapport accepté au terminal (OUI), empreinte e0efff5c2ddacc8d27bbd9e9e76694b1
003 réelle (rapport : .../003-apply.txt)
purge appliquée — PURGE APPLIQUÉE : 003-purge-legacy journalisée, 204 ligne(s) supprimée(s), empreinte e0efff5c2ddacc8d27bbd9e9e76694b1.
contrôles après migration (check-migration.txt, fingerprint-3.txt)
    OK|journal 001-deck-configuration : journalisée
    ... (une trentaine de lignes OK|, aucune KO|)
    OK|tables intactes de bout en bout (effectif et contenu) : cards catalog_version users user_identities sessions deck_cards deck_starters card_categories
    OK|003 n'a touché que ses propres objets ...
démarrage de l'app
... docker compose up -d, ps : db et app « Up »
séquence terminée : ok
==> Rapports : .../deploy/out/deploy-<horodatage>
==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health
```

Échecs possibles après `OUI` :

| Message | Code | État | Que faire |
| --- | --- | --- | --- |
| `003 en échec à l'application` (empreinte recalculée différente : une donnée a bougé entre la simulation et l'application) | 1 | transaction annulée, base à 001 / 002, nouvelle app démarrée sans 003 | relancer §3 : nouvelle simulation, nouvelle empreinte |
| `contrôle après migration en échec — app laissée ARRÊTÉE` | 2 | 003 journalisée, une ligne `KO\|` dans `check-migration.txt`, app arrêtée | lire la ligne KO ; retour arrière complet §7 (la commande de restauration est affichée) ou correction puis `docker compose ... up -d` |

## 6. Contrôles après déploiement (T1, puis navigateur)

```bash
curl -s https://analysis.scratchrecode.com/api/health       # {"ok":true,"cards":14529,"catalog":{...}}
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 30 app
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select id, applied_at from app_migrations order by id"
```

Attendu : trois lignes `001-deck-configuration`, `002-profiles-and-conditions`,
`003-purge-legacy`, aucune erreur dans les journaux.

Au navigateur, sur https://analysis.scratchrecode.com :

1. Connexion, « Mes decks » : 16 decks listés (aperçus vides : résumés invalidés, recalcul à
   l'étape 9).
2. Ouvrir un deck cité dans le rapport, par exemple « YCS paris 2 » (P2 : il excluait des paires
   globales) : main deck complet, starters conservés, condition(s) ET/OU présentes pour les
   prérequis convertis (P4), statistiques calculées (« départs théoriques »), premier / second.
3. Onglet Combos : aucune paire (les 185 paires globales sont à ressaisir à la main, par deck),
   aucun plafond partagé.
4. Enregistrer sans modification, puis recharger : la révision s'incrémente, le deck se rouvre
   identique.
5. Bibliothèque : catégories « Handtrap » et « Board breaker » présentes, sans pertinence ; poser
   ensuite les profils (mode Profil) des cartes étiquetées.
6. Comparateur sur deux decks : matrices affichées, export Excel téléchargeable.

Le lendemain : `tail -n 2 ~/ygo-backup.log` montre « sauvegarde ok » puis « sauvegarde vérifiée ».

## 7. Retour arrière complet (après `OUI`)

1. Base : `bash ~/apps/ygo-proba/deploy/restore.sh /var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz`
   — vérifie l'archive, demande `OUI`, sauvegarde l'état courant dans
   `keep/ygo-pre-restauration-<horodatage>.sql.gz`, bascule la base (l'état remplacé reste dans
   la base `ygo_previous` jusqu'à la prochaine restauration), redémarre le conteneur app.
2. Code : la base restaurée est pré-001, la nouvelle app ne peut pas la servir. Remettre le
   commit noté au §1 **sans** passer par l'ancien `deploy.sh` (il ferait `git pull`) :

   ```bash
   cd ~/apps/ygo-proba && git checkout <commit noté au §1>
   cd deploy
   docker compose --env-file .env.prod -f docker-compose.prod.yml build
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   curl -s https://analysis.scratchrecode.com/api/health
   ```

3. Pour retenter plus tard : `git checkout main` puis reprendre au §1.

## 8. Après coup

- Garder la copie locale de l'archive pré-migration (`../testhand-dumps/`, hors dépôt) : c'est
  l'état d'avant purge, avec les 185 paires globales lisibles en SQL si besoin.
- Les rapports restent dans `~/apps/ygo-proba/deploy/out/deploy-<horodatage>/` (umask 077).
- La ligne du cron ne change pas ; chaque archive quotidienne a désormais trois fichiers
  (`.sql.gz`, `.sha256`, `.fingerprint`), `keep/` est hors rétention.
- Ressaisie manuelle des paires par deck, puis profils des cartes étiquetées : hors runbook.

## Annexe A — codes de retour de `deploy.sh`

| Code | Signification | App |
| --- | --- | --- |
| 0 | déployé, 003 appliquée ou déjà journalisée | nouvelle, démarrée |
| 1 | échec avant 003 (sauvegarde, schéma, 001, 002) | ancienne relancée, base intacte |
| 1 | 003 refusée en simulation ou en échec à l'application | nouvelle, démarrée sans 003 |
| 2 | contrôle après migration en échec | ARRÊTÉE, restauration affichée |
| 3 | rapport refusé (réponse ≠ OUI, `--accept` différent, pas de terminal) | nouvelle, démarrée sans 003 |

## Annexe B — fichiers produits par `deploy.sh`

`deploy/out/deploy-<horodatage>/` : `journal.txt` (toute la séquence), `backup.log`,
`fingerprint-0.txt` (avant), `fingerprint-2.txt` (après 002), `fingerprint-3.txt` (après 003),
`inventory-before-counts.txt`, `inventory-before-journal.txt`, `inventory-before-summaries.json`
(16 résumés d'avant purge, noms de decks), `inventory-before-legacy.json` (185 paires, 15
exclusions), `003-simulation.txt` (+ `.err`), `003-apply.txt` (+ `.err`), `check-migration.txt`.
Archive : `/var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz` (+ `.sha256`,
`.fingerprint`).
