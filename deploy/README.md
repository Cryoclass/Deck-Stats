# Déploiement — analysis.scratchrecode.com

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
curl -s https://analysis.scratchrecode.com/api/health   # → {"ok":true,"cards":0}
```

## 5. Importer les données locales (cartes, comptes, decks)

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

Dumps dans `/var/backups/ygo-proba`, `umask 077`, rétention 14 jours.

## Exploitation courante

```bash
cd ~/apps/ygo-proba/deploy
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app
bash deploy.sh        # redéployer (pull + build + schéma + up)
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
