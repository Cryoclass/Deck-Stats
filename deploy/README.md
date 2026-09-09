# Déploiement — analysis.scratchrecode.com

Les étapes 2 et 3 introduisent une migration additive obligatoire avant cette
version de l'app. Lire [configuration-v2.md](configuration-v2.md) pour ses effets,
la séquence de déploiement, les contrôles et les tests PostgreSQL reproductibles.
La migration `003-purge-legacy.sql` (étape 8, partie A) purge le modèle historique
après simulation et acceptation explicite du rapport. Depuis la partie B, `deploy.sh`
l'enchaîne (sauvegarde pré-migration vérifiée, simulation, « OUI » ou `--accept`,
contrôles après migration), `backup.sh` vérifie chaque archive (`.sha256`, restauration
dans `ygo_verify`, `.fingerprint`), `restore.sh` restaure de façon réversible et
`rehearsal.sh` répète toute la séquence sur une copie jetable — voir §9 et, pour
l'exécution 8C, [docs/deploy-runbook.md](../docs/deploy-runbook.md). Aucun déploiement
VPS n'a été exécuté depuis l'étape 1.

Cible : le VPS OVH existant (`137.74.172.32`, Ubuntu 24.04) qui héberge déjà
goldfish (`tcg.scratchrecode.com`). **On réutilise son Caddy** (ports 80/443,
Let's Encrypt) via un réseau Docker partagé `edge` — cette stack-ci ne publie
aucun port (Docker contourne ufw, cf. compte-rendu goldfish, contrainte n°7).

```
Internet ──443──▶ Caddy (stack goldfish) ──edge──▶ ygo-app:8787 ──▶ db (postgres 17)
                  tcg.scratchrecode.com → goldfish
                  analysis.scratchrecode.com → ygo-app
```

## 1. DNS (Cloudflare)

`analysis.scratchrecode.com` → **A** → `137.74.172.32`, **DNS only (nuage
gris)** — même contrainte que `tcg` : Caddy obtient ses certificats par
challenge HTTP-01, le proxy orange l'en empêcherait.

## 2. Sur le VPS — cloner et configurer

```bash
# Deploy key lecture seule (comme goldfish) : générer, puis l'ajouter dans
# GitHub → repo Deck-Stats → Settings → Deploy keys.
ssh-keygen -t ed25519 -f ~/.ssh/id_ygo -N '' -C 'deploy ygo-proba'
cat ~/.ssh/id_ygo.pub

cat >> ~/.ssh/config << 'EOF'
Host github-ygo
  HostName github.com
  IdentityFile ~/.ssh/id_ygo
  IdentitiesOnly yes
EOF

git clone git@github-ygo:Cryoclass/Deck-Stats.git ~/apps/ygo-proba
cd ~/apps/ygo-proba/deploy
cp .env.prod.example .env.prod && chmod 600 .env.prod
nano .env.prod    # POSTGRES_PASSWORD (openssl rand -base64 24), INVITE_CODES, Discord
```

## 3. Réseau partagé + branchement sur le Caddy goldfish

```bash
docker network create edge
```

Dans la stack **goldfish** :

1. `docker-compose.prod.yml` — le service `caddy` rejoint `edge` :

   ```yaml
   services:
     caddy:
       networks: [default, edge]   # default = réseau implicite existant
   networks:
     edge:
       external: true
   ```

2. `Caddyfile` — nouveau bloc de site (mêmes en-têtes de discrétion que tcg) :

   ```caddyfile
   analysis.scratchrecode.com {
     encode zstd gzip
     header X-Robots-Tag "noindex, nofollow"
     reverse_proxy ygo-app:8787
   }
   ```

3. Redémarrer le Caddy goldfish :

   ```bash
   cd ~/apps/goldfish/deploy
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --force-recreate caddy
   ```

Caddy ira chercher le certificat Let's Encrypt d'`analysis` tout seul au
premier démarrage (le DNS de l'étape 1 doit déjà pointer).

## 4. Premier déploiement

```bash
bash ~/apps/ygo-proba/deploy/deploy.sh
curl -s https://analysis.scratchrecode.com/api/health   # → {"ok":true,"cards":0,"catalog":null}
```

Un volume `pgdata` neuf est initialisé par les quatre fichiers montés dans
`docker-entrypoint-initdb.d` (schéma, 001, 002, 003 : rien à purger, journalisée sans
acceptation) ; `deploy.sh` trouve alors 003 journalisée et ne pose aucune question. Le
catalogue n'est chargé ni à l'initialisation ni par l'app : le remplir avec `migrate-cards.js`
depuis le conteneur `app` (§8, ≈ 15 s pour 14 500 cartes). C'est le chemin retenu pour 8C
(« départ à vide », [docs/deploy-runbook.md](../docs/deploy-runbook.md), V1–V7).

## 5. Importer les données locales (cartes, comptes, decks) — historique

Procédure du premier déploiement de 2026, conservée pour mémoire ; depuis 8C le catalogue vient
de la source (§8) et les decks se réimportent depuis leurs fichiers YDK.

Le catalogue (~14 k cartes) et tes decks viennent de ta base locale — pas
besoin de rejouer la migration Supabase sur le VPS.

Sur le poste local (PowerShell, depuis la racine du repo) :

```powershell
docker compose exec -T db pg_dump -U ygo --clean --if-exists ygo > dump.sql
scp dump.sql ubuntu@137.74.172.32:/tmp/
Remove-Item dump.sql
```

Sur le VPS :

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  exec -T db psql -U ygo -d ygo < /tmp/dump.sql
rm /tmp/dump.sql
curl -s https://analysis.scratchrecode.com/api/health    # → "cards" ≈ 14000
```

`--clean --if-exists` : le dump remplace le schéma vierge créé au premier
boot. Rejouable : chaque restauration repart du dump.

## 6. Discord

Portail développeur → l'app existante → OAuth2 → Redirects → **ajouter**
`https://analysis.scratchrecode.com/api/auth/discord/callback` (en plus de la
redirection localhost, les deux coexistent).

## 7. Sauvegardes

```bash
crontab -e
# 17 3 * * * bash $HOME/apps/ygo-proba/deploy/backup.sh >> $HOME/ygo-backup.log 2>&1
```

Dumps dans `/var/backups/ygo-proba`, `umask 077`, rétention 14 jours. Depuis l'étape 8B
chaque archive `ygo-<horodatage>.sql.gz` est accompagnée de `.sha256` et, une fois
vérifiée par restauration dans `ygo_verify` (recréée puis supprimée), de `.fingerprint`
(empreinte de données par table, `fingerprint.sql`). Le journal garde sa ligne
`sauvegarde ok: …` puis ajoute `sauvegarde vérifiée: …` ; une vérification en échec
laisse l'archive, écrit `sauvegarde NON vérifiée: …` sans `.fingerprint` et rend le code 1.
`bash backup.sh --pre-migration` (utilisé par `deploy.sh`) et `--keep <libellé>` (utilisé
par `restore.sh`) écrivent dans `keep/`, hors rétention.

Restauration, toujours réversible :

```bash
bash restore.sh /var/backups/ygo-proba/ygo-<horodatage>.sql.gz          # OUI demandé
bash restore.sh <archive> --check-only                                    # vérification seule
```

`restore.sh` refuse sans `.sha256` (ou somme fausse), sans `.fingerprint` (sauf
`--without-fingerprint`, archives antérieures à 8B), ou si l'archive restaurée dans
`ygo_restore` ne porte pas l'empreinte enregistrée ; puis arrête l'app, sauvegarde l'état
courant dans `keep/ygo-pre-restauration-<horodatage>.sql.gz` (vérifiée), renomme la base
courante en `ygo_previous` (l'ancienne `ygo_previous` est supprimée) et `ygo_restore` en
`ygo`, relit l'empreinte, redémarre l'app. Retour arrière : `restore.sh` sur l'archive de
sécurité.

## 8. Mettre le catalogue à jour (cartes récentes)

Les scripts de maintenance sont **déjà dans l'image** (`tsc` compile `scripts/` en
même temps que `src/`) : rien à installer sur le VPS, on les lance dans le conteneur
`app`, qui a `DATABASE_URL` et les dépendances de production.

```bash
cd ~/apps/ygo-proba/deploy
dc() { docker compose --env-file .env.prod -f docker-compose.prod.yml "$@"; }

bash backup.sh                                            # 1. sauvegarder AVANT
dc exec app node server/dist/scripts/migrate-cards.js      # 2. nouvelles cartes (upsert)
dc exec app node server/dist/scripts/prune-stale-cards.js  # 3. SIMULATION de la purge
```

L'étape 3 n'écrit rien : elle joue toutes les opérations puis annule la transaction,
et affiche le plan (cartes reportées, cartes supprimées, cartes conservées faute de
cible sûre). Depuis l'étape 8, le script refuse de tourner tant que la migration 003
n'est pas journalisée, et annule tout si un report exige de fusionner deux conditions
ou tranche entre des profils contradictoires. **Lire ce plan**, puis seulement :

```bash
dc exec app node server/dist/scripts/prune-stale-cards.js --apply
curl -s https://analysis.scratchrecode.com/api/health       # "cards" ≈ 14 500
```

Pas besoin des clés Supabase dans `.env.prod` : les valeurs publiques (URL + clé anon)
sont les valeurs par défaut du script.

> Ne **pas** reprendre le `pg_dump` local de la §5 pour cela : `--clean --if-exists`
> écraserait les comptes et les decks créés en ligne depuis. La §5 est la procédure de
> *premier* remplissage.

**Répétition à blanc** (facultatif, recommandé avant une grosse purge) — rejouer un
dump de prod en local et y produire le SQL, à relire avant de le jouer en ligne :

```bash
scp ubuntu@137.74.172.32:/var/backups/ygo-proba/ygo-<stamp>.sql.gz .
# en local : restaurer dans une base jetable, puis
DATABASE_URL=postgres://ygo:ygo@localhost:5433/ygo_repet \
  npm run prune-cards -- --emit-sql purge.sql
```

## 9. Migration 003, restauration et répétition (étape 8B)

`deploy.sh` enchaîne : `git pull` → build → db → attente `db_ready` (étape 9B : `healthy`, puis
serveur définitif annoncé dans les journaux après le marqueur de l'entrypoint — jamais le seul
`pg_isready`, qui accepte le serveur temporaire d'initialisation d'un volume neuf) → séquence partagée de `lib.sh`
(`run_migration_sequence`, la même que `rehearsal.sh`) : arrêt de l'app → sauvegarde
pré-migration vérifiée dans `keep/` → inventaire (effectifs, journal, résumés, modèle
historique) → schéma → 001 → 002 (plus rejoués une fois 003 journalisée : 001 recréerait
`deck_requirements`) → 003 en simulation (rapport `deploy/out/deploy-<horodatage>/003-simulation.txt` ;
succès = code 0 **et** ligne « SIMULATION TERMINÉE », jamais le seul code) → acceptation
(« OUI » au terminal, `--expect <empreinte>` pour afficher la comparaison, `--accept
<empreinte>` sans question) → 003 réelle (« PURGE APPLIQUÉE ») → contrôles après migration
(`check-migration.sql`, empreintes avant / après) → `up -d`. Codes : 0 déployé ; 1 échec
avant 003 (ancienne app relancée, base intacte) ou 003 en échec (nouvelle app sans 003) ;
2 contrôle après migration en échec (app **arrêtée**, commande de restauration affichée) ;
3 rapport refusé (nouvelle app sans 003). Procédure complète, sorties attendues et retours
arrière : [docs/deploy-runbook.md](../docs/deploy-runbook.md).

Répétition et tests, en local sur conteneurs jetables (jamais la base de dev 5433) :

```bash
bash deploy/rehearsal.sh <archive.sql.gz> --accept <empreinte>   # dump réel hors dépôt, 55436 + 8790 + 5174
bash deploy/rehearsal.sh --fixture                                # jeu représentatif
bash deploy/test-backup-restore.sh                                # backup.sh / restore.sh, 55438 + 55439
bash deploy/test-migration-sequence.sh                            # cas A–I de la séquence (négatifs, base vide, volume neuf), 55440
```

`rehearsal.sh` restaure l'archive, joue la séquence, restaure l'archive pré-migration dans
`ygo_old` pour que `scripts/recompute-check.ts` compare l'ancien moteur (e890078,
matérialisé depuis git dans `deploy/out/`) au nouveau (paires réinjectées : identique ;
après purge : écart chiffré), joue les gardes e2e sur la pile migrée, prouve le retour
arrière par `restore.sh`, puis démonte. Rapport : `deploy/out/rehearsal-<horodatage>/rapport.md`.
Le dossier `deploy/out/` est ignoré par git et contient des archives complètes : ne pas le
partager.

## Exploitation courante

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app
bash deploy.sh        # redéployer (pull + build + séquence lib.sh + up), voir §9 et le runbook
```

## Notes de sécurité

- Cookies `Secure` : `NODE_ENV=production` dans l'image ; le navigateur ne
  parle qu'en HTTPS à Caddy.
- `TRUST_PROXY=1` : notre rate-limit (login, register, /discord/start) lit
  `req.ip` — sans ça, tous les visiteurs partageraient l'IP du conteneur
  Caddy. Sûr car l'app n'est joignable QUE par Caddy (aucun port publié) et
  Caddy n'accepte pas de X-Forwarded-For forgé sans `trusted_proxies`.
- Codes d'invitation : en ligne, prendre des codes non devinables.
- Le jour du passage en nuage orange : `trusted_proxies` (plages Cloudflare)
  côté Caddy **et** revalider la source d'IP du rate-limit — les deux
  ensemble (même piège que goldfish, §8 de son compte-rendu).
