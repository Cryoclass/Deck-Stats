#!/usr/bin/env bash
# Sauvegarde logique quotidienne (cron), rétention 14 jours.
#   17 3 * * * bash $HOME/apps/ygo-proba/deploy/backup.sh >> $HOME/ygo-backup.log 2>&1
# Les dumps contiennent emails et hachages de mots de passe → umask 077 (dette
# relevée sur goldfish, corrigée d'entrée ici).
#
# Étape 8B (D3) — chaque archive est accompagnée de « <archive>.sha256 » et vérifiée par
# restauration dans la base ygo_verify (recréée puis supprimée), dont l'empreinte de données
# (deploy/fingerprint.sql : effectif et md5 des lignes triées, par table) est écrite dans
# « <archive>.fingerprint » ; restore.sh la compare avant de toucher à la base.
#   bash backup.sh                   → $DIR/ygo-<horodatage>.sql.gz, rétention 14 jours
#   bash backup.sh --pre-migration   → $DIR/keep/ygo-pre-migration-<horodatage>.sql.gz, HORS
#                                      rétention, vérification stricte (app arrêtée attendue)
#   bash backup.sh --keep <libellé>  → $DIR/keep/ygo-<libellé>-<horodatage>.sql.gz (restore.sh
#                                      y range sa sauvegarde de sécurité « pre-restauration »)
# Comportement en cron : la ligne « … sauvegarde ok: … » garde son format et est écrite dès
# que l'archive et son .sha256 existent, AVANT la vérification. Si la vérification échoue,
# l'archive est conservée, une ligne « … sauvegarde NON vérifiée: … » est ajoutée, aucun
# .fingerprint n'est écrit et le code de retour est 1 : le cron continue le lendemain, le
# journal montre l'anomalie, restore.sh refuse l'archive sans --without-fingerprint.
# Environnement (répétition et tests seulement) : BACKUP_DIR, TESTHAND_DB_CONTAINER.
set -euo pipefail
umask 077

cd "$(dirname "$0")"
. ./lib.sh

MODE=daily; LABEL=
case "${1:-}" in
  '') ;;
  --pre-migration) MODE=keep; LABEL=pre-migration ;;
  --keep) MODE=keep; LABEL=${2:-}; [ -n "$LABEL" ] || die 'libellé attendu après --keep' 2 ;;
  *) die "option inconnue : $1 (attendu : rien, --pre-migration ou --keep <libellé>)" 2 ;;
esac
if [ -n "$LABEL" ] && ! printf '%s' "$LABEL" | grep -Eq '^[a-z0-9-]+$'; then
  die "libellé invalide : $LABEL (minuscules, chiffres, tirets)" 2
fi

DIR=${BACKUP_DIR:-/var/backups/ygo-proba}
if [ -z "${BACKUP_DIR:-}" ]; then
  sudo mkdir -p "$DIR" && sudo chown "$(id -u):$(id -g)" "$DIR"
else
  mkdir -p "$DIR"
fi

STAMP=$(date -u +%Y%m%d-%H%M%S)
if [ "$MODE" = keep ]; then mkdir -p "$DIR/keep"; NAME="keep/ygo-$LABEL-$STAMP.sql.gz"; else NAME="ygo-$STAMP.sql.gz"; fi
ARCHIVE="$DIR/$NAME"

# Empreinte de la base vivante AVANT l'export : en cron l'app tourne et une table peut bouger
# pendant l'export ; l'empreinte est reprise après pour ne comparer strictement que les
# tables stables (verify_backup, lib.sh). Une empreinte impossible n'empêche pas l'archive.
BEFORE=$(mktemp)
db_fingerprint "$DB_NAME" > "$BEFORE" 2>/dev/null || : > "$BEFORE"

db_exec pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" | gzip > "$ARCHIVE"
(cd "$(dirname "$ARCHIVE")" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")

# Rétention : archives datées du dossier racine seulement (keep/ en est exclu), avec leurs
# compagnons .sha256 et .fingerprint.
if [ "$MODE" = daily ]; then find "$DIR" -maxdepth 1 -name 'ygo-*.sql.gz*' -mtime +14 -delete; fi
echo "$(date -u -Is) sauvegarde ok: $NAME ($(du -h "$ARCHIVE" | cut -f1))"

if [ "$MODE" = keep ] && [ ! -s "$BEFORE" ]; then
  echo "$(date -u -Is) sauvegarde NON vérifiée: $NAME — empreinte de la base vivante impossible avant l'export (archive conservée, sans .fingerprint)"
  rm -f "$BEFORE"
  exit 1
fi
if [ -s "$BEFORE" ]; then LIVE=$BEFORE; else LIVE=; fi
if verify_backup "$ARCHIVE" "$LIVE" "$MODE"; then
  echo "$(date -u -Is) sauvegarde vérifiée: $NAME sha256 $(cut -d' ' -f1 "$ARCHIVE.sha256") empreinte $(fingerprint_global "$ARCHIVE.fingerprint")$VERIFY_NOTE"
  rm -f "$BEFORE"
else
  echo "$(date -u -Is) sauvegarde NON vérifiée: $NAME — $VERIFY_ERROR (archive conservée, sans .fingerprint)"
  rm -f "$BEFORE"
  exit 1
fi
