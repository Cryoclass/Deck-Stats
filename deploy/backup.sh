#!/usr/bin/env bash
# Sauvegarde logique quotidienne (cron), rétention 14 jours.
#   17 3 * * * bash $HOME/apps/ygo-proba/deploy/backup.sh >> $HOME/ygo-backup.log 2>&1
# Les dumps contiennent emails et hachages de mots de passe → umask 077 (dette
# relevée sur goldfish, corrigée d'entrée ici).
set -euo pipefail
umask 077

DIR=/var/backups/ygo-proba
sudo mkdir -p "$DIR" && sudo chown "$(id -u):$(id -g)" "$DIR"

cd "$(dirname "$0")"
STAMP=$(date -u +%Y%m%d-%H%M%S)
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  exec -T db pg_dump -U ygo --clean --if-exists ygo | gzip > "$DIR/ygo-$STAMP.sql.gz"

find "$DIR" -name 'ygo-*.sql.gz' -mtime +14 -delete
echo "$(date -u -Is) sauvegarde ok: ygo-$STAMP.sql.gz ($(du -h "$DIR/ygo-$STAMP.sql.gz" | cut -f1))"
