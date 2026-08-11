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
dc exec -T db psql -q -U ygo -d ygo -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/00-schema.sql
dc up -d
dc ps
echo '==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health'
