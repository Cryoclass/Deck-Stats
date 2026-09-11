# Runbook — déploiement sur le VPS

Procédure d'exécution, commande par commande, avec les scripts de `deploy/` (`deploy.sh`,
`backup.sh`, `restore.sh`, `lib.sh`). Trois variantes, selon l'état de la production :

- **« Déploiement courant »** (étape 9C, ci-dessous) : base **non vide**, 003 **déjà
  journalisée**, aucune migration nouvelle — c'est le cas de tout déploiement depuis 8C, et celui
  de l'étape 9. Aucune question n'est attendue ; l'archive pré-migration réelle prise par
  `deploy.sh` est le retour arrière des données.
- **« Départ à vide »** (8C, exécutée sur le VPS le 8 septembre 2026, code `9d281cf`,
  docs/etape-8.md « Compte rendu 8C ») : volume recréé, 001–003 jouées par `initdb`, catalogue
  rechargé. Conservée telle quelle ; l'incident du premier `deploy.sh` est consigné en V4.
- **« Base conservée »** (§3 à §5, pour mémoire) : migration 001 → 002 → 003 d'une base pré-001
  avec simulation, rapport et acceptation `OUI` ; répétée sur le dump réel en 8B, jamais jouée
  en production (décision « départ à vide »).

## Variante « déploiement courant » — étape 9 (base non vide, 003 journalisée)

État attendu de la production avant de commencer : code `9d281cf` (8C), base v2 purgée avec
`app_migrations` = 001, 002, 003, comptes et decks ressaisis depuis 8C, catalogue chargé, cron
`backup.sh` à 03:17. Ce que l'étape 9 change **sur le VPS** : l'image (web et serveur : aperçus
versionnés, endpoint `PUT /decks/:id/summary`, vue transitoire, mode Non-engine combiné, extra /
side éditables), `deploy/lib.sh` (`db_ready`) et `deploy/deploy.sh` (attente par `db_ready`).
**Rien dans `db/`** : `git diff --stat 9d281cf..etape-9-ok -- db` est vide. La séquence de
`deploy.sh` rejoue donc le schéma (idempotent, sans effet), constate 003 journalisée et ne pose
aucune question — c'est exactement le cas « F, rejeu » de `deploy/test-migration-sequence.sh`
(base non vide, 003 journalisée → code 0, « déjà journalisée », empreinte identique).

> **Si `main` contient l'étape 10** (plans de side, 10A–10D) : `deploy.sh` faisant lui-même
> `git pull`, déployer l'étape 9 depuis `main` déploie aussi l'étape 10 — la migration additive
> `004-side-plans.sql` (trois tables vides, aucune donnée migrée), l'onglet « Plans de side », la
> fiche imprimable et le comparateur sur un deck sidé. La procédure reste la même, **toujours sans
> question** ; seules ces sorties diffèrent :
> - C0 : `git diff --stat 9d281cf..HEAD -- db` n'est plus vide, il liste
>   `db/migrations/004-side-plans.sql` et rien d'autre ;
> - C4 : la ligne « 003 déjà journalisée : … » se termine par « schéma et migrations additives
>   postérieures seulement », suivie de `rejeu par stdin : db/schema.sql` **puis**
>   `rejeu par stdin : db/migrations/004-side-plans.sql` ; les contrôles ajoutent
>   `OK|journal 004-side-plans : journalisée` et trois `OK|table v2 deck_matchups / deck_side_plans
>   / deck_side_plan_cards : présente` ; aucune `KO|` ;
> - C5, retour arrière du code seul : toujours valable — l'ancienne app ignore les trois tables.
> - C1 : noter le commit **réellement** en service. Au déploiement de l'étape 10 (11 septembre 2026)
>   c'était `d0d8210` (étape 9, déployée le 9 septembre), pas `9d281cf` : l'inventaire affichait alors
>   `3 résumé(s)` et non 0 — normal une fois l'étape 9 en service.
> - C3 : le conteneur `db` est **recréé** en tête (`Container ygo-proba-db-1 Recreate`), parce que
>   le montage de `04-side-plans.sql` change sa configuration Compose ; le volume est conservé
>   (journaux : « Skipping initialization »), et l'app encore en service perd sa base quelques
>   secondes avant son propre arrêt. Un `FATAL: terminating autovacuum process due to
>   administrator command` pendant la sauvegarde pré-migration est la suppression normale de la base
>   de vérification, pas un incident.
> - Déploiement de code seul (compose inchangé ; retouche de la fiche, 11 septembre 2026,
>   `bc5a004` → `4cf9493`) : `db` reste « Running », non recréé ; app coupée ≈ 20 s.
> - Piloté par `ssh goldfish bash -s <<'EOF'` : `docker compose exec -T` lit l'entrée standard et
>   avale la suite du script — `< /dev/null` sur chaque `exec -T` (et sur `backup.sh`).
>
> Preuve locale : cas « F sans 004 » de `deploy/test-migration-sequence.sh` (base à 003 sans 004 →
> code 0 sans question, 004 rejouée, journal 001 à 004). Toute autre différence : `NON` et stop.

Indisponibilité : de « arrêt de l'app » à « démarrage de l'app » dans la séquence, soit la
sauvegarde pré-migration vérifiée (≈ 1 min) et les contrôles (quelques secondes) ; le build de
l'image se fait **avant** l'arrêt, app en service. Choisir un créneau calme.

Règles : ne jamais taper Ctrl-C pendant `deploy.sh` ; ne jamais modifier un script de `deploy/`
pendant qu'il tourne ; **toute question de `deploy.sh` signifie que l'état n'est pas celui
attendu** — répondre `NON` (code 3, nouvelle app démarrée sans effet sur la donnée) et comprendre
avant de relancer.

### C0. La veille, en local (T2)

```bash
git status --short && git log -1 --oneline && git tag --points-at HEAD     # propre, etape-9-ok
git diff --stat 9d281cf..HEAD -- db                                          # vide : aucune migration
bash deploy/test-migration-sequence.sh                                       # cas A–I, dont « F rejeu » = ce déploiement
bash deploy/rehearsal.sh --fixture                                           # séquence complète + e2e sur la pile migrée + retour arrière
git push --follow-tags                                                       # commits et tags etape-9a-ok, etape-9b-ok, etape-9-ok
```

Attendu : `test-migration-sequence.sh` termine sur `OK` sans garde en échec (« F rejeu : code 0
sans question », « déjà journalisée », « base identique ») ; `rehearsal.sh --fixture` sur
`RÉPÉTITION CONFORME`. Ne pas lancer les deux en même temps que `npm run e2e -w web` (échec non
reproduit de `setup` sous charge, 9B). La répétition sur une archive **réelle** déjà à 003 n'est
pas prévue par `rehearsal.sh` (son contrôle de recalcul attend l'ancien modèle dans `ygo_old`) :
pour vérifier la dernière archive du cron, utiliser `restore.sh --check-only` (§4b, conteneur
55441), pas `rehearsal.sh`.

### C1. Code à jour sur le VPS (T1)

```bash
cd ~/apps/ygo-proba
git rev-parse --short HEAD          # NOTER ce commit (attendu : 9d281cf) : c'est le retour arrière du code (C5)
git pull --ff-only
git log -1 --oneline                # attendu : le commit de l'étape 9C
git tag --points-at HEAD            # attendu : etape-9-ok
```

L'app en service n'est pas touchée (elle tourne dans son image). Retour arrière à ce stade :
`git checkout <commit noté>`.

### C2. État des lieux, effectifs et sauvegarde quotidienne vérifiée (T1)

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml ps        # db (healthy) et app « Up »
tail -n 2 ~/ygo-backup.log                                               # « sauvegarde ok » puis « sauvegarde vérifiée »
df -h /var/backups                                                       # place : ≈ 1,5 Mo par archive, keep/ hors rétention
curl -s https://analysis.scratchrecode.com/api/health                    # {"ok":true,"cards":14529,"catalog":{...}}
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select id from app_migrations order by id"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select (select count(*) from users) as users, (select count(*) from decks) as decks, (select count(*) from deck_cards where zone <> 'main') as extra_side, (select count(*) from decks where summary is not null) as summaries"
bash backup.sh
```

Attendu : trois lignes `001-deck-configuration`, `002-profiles-and-conditions`,
`003-purge-legacy` ; **noter** `users`, `decks`, `extra_side` (ils doivent être identiques après
C3) et `summaries` (0 attendu : rien n'écrivait le cache avant 9A) ; `backup.sh` :

```text
<date> sauvegarde ok: ygo-<horodatage>.sql.gz (1.5M)
<date> sauvegarde vérifiée: ygo-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
```

Une ligne « sauvegarde NON vérifiée » arrête tout : ne pas déployer, lire la raison.

### C3. `deploy.sh` — aucune question attendue (T1)

```bash
cd ~/apps/ygo-proba/deploy
bash deploy.sh
```

Sortie attendue, dans l'ordre (horodatages omis, sorties de Compose résumées) :

```text
Already up to date.                         (git pull, déjà fait en C1)
... build de l'image (plusieurs minutes : web et serveur ont changé)
... up -d db : « Running » (conteneur déjà en service, non recréé)
==> Attente de la DB (healthy, serveur définitif annoncé dans les journaux, select 1)...
séquence de migration — dossier : .../deploy/out/deploy-<horodatage> — acceptation : OUI au terminal
arrêt de l'app (aucune écriture pendant la transition)
    ... Container ygo-proba-app-1 Stopped
empreinte de la base avant toute modification (fingerprint-0.txt)
sauvegarde pré-migration vérifiée (obligatoire, hors rétention)
    <date> sauvegarde ok: keep/ygo-pre-migration-<horodatage>.sql.gz (1.5M)
    <date> sauvegarde vérifiée: keep/ygo-pre-migration-<horodatage>.sql.gz sha256 <64 hex> empreinte <32 hex>
archive pré-migration : /var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz — sha256 <64 hex> — empreinte <32 hex>
inventaire avant migration (inventory-before-*)
inventaire : 16 table(s), journal « 001-deck-configuration,002-profiles-and-conditions,003-purge-legacy », 0 résumé(s) non nul(s), modèle historique : 0 paire(s) globale(s), 0 exclusion(s) ou prérequis source paire
003 déjà journalisée : 001 et 002 ne se rejouent plus (001 recréerait deck_requirements), schéma seulement
rejeu par stdin : db/schema.sql
003 en simulation (rapport : .../003-simulation.txt)
003 déjà journalisée : aucun effet, contrôles seulement
contrôles après migration (check-migration.txt, fingerprint-3.txt)
    OK|journal 001-deck-configuration : journalisée
    ... (une trentaine de lignes OK|, aucune KO| ; dont « OK|decks : <decks noté en C2> » et « OK|résumés non nuls … : 0 »)
    OK|tables intactes de bout en bout (effectif et contenu) : cards catalog_version users user_identities sessions deck_cards deck_starters card_categories
    OK|003 n'a touché que ses propres objets ...
démarrage de l'app
    ... docker compose up -d, ps : db et app « Up »
séquence terminée : ok
==> Rapports : .../deploy/out/deploy-<horodatage>
==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health
```

Code **0**, **aucune question**. Points de lecture :

- `==> Attente de la DB` rend la main en quelques secondes : le conteneur `db` tourne déjà
  (volume initialisé, marqueur « Skipping initialization » présent dans les journaux du
  démarrage courant) — c'est l'attente corrigée en 9B, plus aucun « shutting down » possible ;
- la ligne `inventaire :` porte `16 table(s)`, les trois migrations au journal, `0 résumé(s)`
  (ou le nombre noté en C2 lors d'un déploiement ultérieur), `0 paire(s)`, `0 exclusion(s)` ;
- **`rejeu par stdin : db/schema.sql` seulement** — jamais `001…` ni `002…` ;
- **si `deploy.sh` pose une question** (`Appliquer la purge … ?`), affiche `rejeu par stdin :
  db/migrations/001…`, une simulation `à purger : N ligne(s)` avec N ≥ 1, un inventaire à
  `14 table(s)` ou un journal vide : la base n'est pas celle attendue (mauvaise pile, mauvais
  volume, base antérieure à 8C). Répondre `NON` : code 3, nouvelle app démarrée, rien de purgé.
  Arrêter, comprendre (`docker volume ls`, `inventory-before-*`), ne pas relancer avant d'avoir
  la cause ;
- l'archive `keep/ygo-pre-migration-<horodatage>.sql.gz` (≈ 1,5 Mo, avec le catalogue) est
  l'état exact d'avant ce déploiement : **noter son horodatage** (C5).

Échecs possibles : annexe A. Un code 1 avant les contrôles (sauvegarde en échec, schéma en échec)
relance l'ancienne app sur une base intacte ; un code 2 laisse l'app arrêtée avec la commande de
restauration affichée (C5).

### C4. Contrôles après déploiement (T1, puis navigateur)

```bash
curl -s https://analysis.scratchrecode.com/api/health       # cards = catalog.cards = 14529 (ou le nombre du dernier chargement)
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail 30 app
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select id from app_migrations order by id"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U ygo -d ygo -c "select (select count(*) from users) as users, (select count(*) from decks) as decks, (select count(*) from deck_cards where zone <> 'main') as extra_side, (select count(*) from decks where summary is not null) as summaries"
```

Attendu : trois lignes au journal ; `users`, `decks`, `extra_side` **identiques** à C2 ;
`summaries` encore 0 (il monte dès la première visite de l'accueil) ; aucune erreur dans les
journaux.

Au navigateur, sur https://analysis.scratchrecode.com :

1. **Accueil** : chaque deck affiche « … » puis ses deux valeurs (départs ≥1, brick) — recalcul à
   la demande (9A) ; recharger la page : les valeurs s'affichent directement, sans « … ».
   Contrôle SQL : `summaries` = nombre de decks, `engineVersion` à 16 hexadécimaux :
   `select count(*), min(summary->>'engineVersion') from decks where summary is not null`.
2. **Éditeur** : ouvrir un deck ; changer la vue du panneau (Départs → une catégorie) : le bouton
   Enregistrer reste grisé (vue transitoire, 9B) ; le mode **Non-engine** propose « Étiquette à
   poser » et « Profil posé avec l'étiquette » (« Profil inchangé » coché) ; le mode Profil est
   toujours là.
3. **Extra / side** (9C) : sous la grille, blocs « Extra deck » et « Side deck » avec
   « + Ajouter » ; ajouter une carte au side : la tuile apparaît avec son stepper, Enregistrer
   s'active, le panneau ne repasse **pas** en « Recalcul… » ; Enregistrer, recharger : la carte est
   là ; la retirer (− jusqu'à 0, toast « Retirée du side deck »), Enregistrer. Contrôle SQL :
   `extra_side` revenu à la valeur de C2.
4. **Enregistrer sans modification** impossible (bouton grisé) ; après une modification du main,
   Enregistrer puis recharger : révision +1, deck identique.
5. **Comparateur** sur deux decks : matrices, Δ, export Excel.

Le lendemain : `tail -n 2 ~/ygo-backup.log` montre « sauvegarde ok » puis « sauvegarde
vérifiée ».

### C5. Retour arrière

Deux niveaux, indépendants :

1. **Code seul** (la base est lisible par l'ancienne app : aucune migration, colonnes et
   configuration v2 inchangées ; les résumés écrits par l'étape 9 sont ignorés par `9d281cf`,
   qui renvoie `summary: null`, et effacés à son prochain enregistrement ; les cartes extra / side
   enregistrées se relisent) — remettre le commit noté en C1 **sans** passer par `deploy.sh`
   (il ferait `git pull`) :

   ```bash
   cd ~/apps/ygo-proba && git checkout <commit noté en C1>
   cd deploy
   docker compose --env-file .env.prod -f docker-compose.prod.yml build
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   curl -s https://analysis.scratchrecode.com/api/health
   ```

2. **Données** (seulement si l'état d'avant le déploiement doit revenir — tout ce qui a été
   enregistré depuis est perdu) : l'archive pré-migration réelle de C3, vérifiée par
   `restore.sh` (somme, empreinte, restauration de contrôle, sauvegarde de sécurité de l'état
   courant dans `keep/ygo-pre-restauration-*`, bascule, `ygo_previous`, conteneur app redémarré) :

   ```bash
   bash ~/apps/ygo-proba/deploy/restore.sh /var/backups/ygo-proba/keep/ygo-pre-migration-<horodatage>.sql.gz
   ```

   Puis, si le code doit aussi revenir, le niveau 1. Pour retenter plus tard : `git checkout main`
   et reprendre en C1.

### C6. Après coup

- Les rapports restent dans `~/apps/ygo-proba/deploy/out/deploy-<horodatage>/` (annexe B) ;
  `keep/` garde une archive pré-migration **par déploiement**, hors rétention : les supprimer à
  la main quand elles ne servent plus de retour arrière (≈ 1,5 Mo chacune).
- Copier l'archive pré-migration hors VPS n'est pas obligatoire pour ce déploiement (aucune
  purge) ; la vérifier hors VPS reste possible par §4b (`restore.sh --check-only`).

> **Historique — décision prise après 8B (8 septembre 2026) : la production repart d'une base
> vide.** Rien n'est conservé (ni decks, ni comptes, ni annotations). L'archive de l'état actuel
> est prise, vérifiée et copiée hors VPS par principe (souvenir), mais elle n'est plus un chemin
> de retour à préparer. La procédure suivie est la **variante « départ à vide »** ci-dessous, qui
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

> **Sur un volume neuf, attendre l'état `healthy` du conteneur `db` avant `deploy.sh`, pas une
> simple connexion réussie** (incident du 8 septembre 2026, ci-dessous). Si le conteneur `db`
> n'est pas déjà démarré : `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db`,
> puis `… ps` jusqu'à `db … (healthy)` et, dans `… logs db`, le **second** « database system is
> ready to accept connections » précédé de « PostgreSQL init process complete; ready for start
> up. ». Seulement ensuite :

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

**Incident rencontré le 8 septembre 2026 (premier `deploy.sh` sur le volume neuf).** L'entrypoint
de l'image PostgreSQL initialise un volume vierge avec un **serveur temporaire** (socket Unix
seulement) qui joue les fichiers montés, puis l'arrête et démarre le serveur définitif. L'attente
de `deploy.sh` (`until pg_isready -q -U ygo -d ygo`, par le socket) a accepté ce serveur
temporaire ; l'empreinte initiale (`fingerprint-0.txt`) a alors échoué pendant son extinction :

```text
FATAL:  the database system is shutting down
```

Code **1**, rien d'appliqué par la séquence (le contenu venait de `initdb`, intact), aucune app.
Le second `deploy.sh`, serveur définitif en place, a donné exactement la sortie attendue ci-dessus,
code 0. Conduite à tenir : ce code 1 sur « shutting down » à l'empreinte initiale se relance sans
autre action, après avoir constaté `healthy` ; il ne se produit que sur un volume neuf (un volume
déjà initialisé ne lance pas de serveur temporaire). **Corrigé en 9B** (docs/etape-9.md) :
`deploy.sh` attend par `db_ready` (lib.sh) — `healthy`, puis dans les journaux du démarrage
courant le dernier « ready to accept connections » après « PostgreSQL init process complete »
(ou « Skipping initialization » sur un volume déjà initialisé), puis `select 1` ; prouvé par le
cas I de `test-migration-sequence.sh` (volume neuf, séquence lancée pendant l'initialisation,
code 0). La consigne d'attente manuelle ci-dessus reste un rappel sans danger, plus une
obligation ; ce code 1 ne devrait plus se produire.

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
