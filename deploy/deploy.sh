#!/usr/bin/env bash
# Déploiement : git pull → build → schéma (idempotent) → up. Depuis n'importe où :
#   bash ~/apps/ygo-proba/deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only

cd deploy
dc() { docker compose --env-file .env.prod -f docker-compose.prod.yml "$@"; }

dc build
dc up -d db
echo '==> Attente de la DB...'
dc exec -T db sh -c 'until pg_isready -q -U ygo -d ygo; do sleep 1; done'
echo '==> Rejeu du schéma (idempotent)...'
dc stop app # éviter des écritures de l'ancienne API pendant la transition
# Par STDIN, PAS par le fichier monté. `git pull` remplace db/schema.sql par un
# nouvel inode ; le bind-mount du conteneur db, lui, reste attaché à l'ancien
# tant que le conteneur n'est pas recréé — et il tourne des semaines. Le rejeu
# appliquait donc le schéma du jour du dernier `up`, sans le moindre message :
# une table ajoutée au schéma n'arrivait jamais en base (constaté le 2026-08-31,
# `catalog_version` absente après un déploiement pourtant vert).
dc exec -T db psql -q -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < ../db/schema.sql
echo '==> Migration additive des configurations (aucune purge des anciens combos)...'
dc exec -T db psql -q -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < ../db/migrations/001-deck-configuration.sql
echo '==> Migration additive des profils, plafonds et conditions ET/OU (etape 5B, aucune purge)...'
dc exec -T db psql -q -U ygo -d ygo -v ON_ERROR_STOP=1 -f - < ../db/migrations/002-profiles-and-conditions.sql
dc up -d
dc ps
echo '==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health'
