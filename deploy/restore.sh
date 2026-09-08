#!/usr/bin/env bash
# Restauration d'une archive produite par backup.sh, réversible (étape 8B, D3).
#   bash restore.sh <archive.sql.gz> [--yes] [--without-fingerprint] [--check-only]
# Rien n'est modifié avant l'étape 4 (--check-only s'arrête après l'étape 3 : vérification d'une
# archive copiée hors VPS sur un conteneur jetable, TESTHAND_DB_CONTAINER) :
#   1. refus si « <archive>.sha256 » manque ou si la somme diffère ;
#   2. refus si « <archive>.fingerprint » manque (archive antérieure à 8B ou jamais vérifiée),
#      sauf --without-fingerprint ;
#   3. restauration de contrôle dans ygo_restore (recréée) et empreinte comparée ligne à ligne
#      à « <archive>.fingerprint » : la moindre différence est un refus ;
#   4. confirmation « OUI » au terminal (sauf --yes), arrêt de l'app, sauvegarde de sécurité
#      vérifiée de la base courante dans keep/ygo-pre-restauration-<horodatage>.sql.gz ;
#   5. bascule : la base courante est renommée ygo_previous (l'ancienne ygo_previous est
#      supprimée), ygo_restore devient ygo ; empreinte de ygo relue et comparée ;
#   6. app redémarrée.
# Retour arrière : bash restore.sh <keep/ygo-pre-restauration-….sql.gz> --yes (même procédure),
# ou, tant qu'elle existe, la base ygo_previous (deploy/README.md). Codes : 0 ok ; 2 refus
# avant toute modification ; 1 échec après l'arrêt de l'app (état indiqué, app relancée si
# la base servie est intacte).
# Environnement (répétition et tests seulement) : BACKUP_DIR, TESTHAND_DB_CONTAINER.
set -euo pipefail
umask 077
START_DIR=$PWD
cd "$(dirname "$0")"
. ./lib.sh

ARCHIVE=; YES=0; CHECK_ONLY=0; export WITHOUT_FINGERPRINT=0
while [ $# -gt 0 ]; do
  case $1 in
    --yes) YES=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    --without-fingerprint) WITHOUT_FINGERPRINT=1 ;;
    -*) die "option inconnue : $1" 2 ;;
    *) [ -z "$ARCHIVE" ] || die 'une seule archive attendue' 2; ARCHIVE=$1 ;;
  esac
  shift
done
[ -n "$ARCHIVE" ] || die 'usage : bash restore.sh <archive.sql.gz> [--yes] [--without-fingerprint] [--check-only]' 2
case $ARCHIVE in /*) ;; *) ARCHIVE="$START_DIR/$ARCHIVE" ;; esac

if [ -n "${TESTHAND_DB_CONTAINER:-}" ]; then
  app_stop() { :; }
  app_start() { :; }
else
  dc() { docker compose --env-file .env.prod -f docker-compose.prod.yml "$@"; }
  app_stop() { dc stop app; }
  app_start() { dc start app; dc ps; }
fi

say "1–2. Contrôle de l'archive : $ARCHIVE"
if ! check_archive_files "$ARCHIVE"; then die "$CHECK_ERROR" 2; fi
say "somme SHA-256 exacte : $(cut -d' ' -f1 "$ARCHIVE.sha256")"
if [ -s "$ARCHIVE.fingerprint" ]; then say "empreinte enregistrée : $(fingerprint_global "$ARCHIVE.fingerprint")"
else warn "aucune empreinte enregistrée : restauration sans comparaison (--without-fingerprint)"; fi

say "3. Restauration de contrôle dans $STAGING_DB"
if ! restore_into_scratch_db "$ARCHIVE" "$STAGING_DB"; then drop_scratch_db "$STAGING_DB"; die "$VERIFY_ERROR — rien n'a été modifié" 2; fi
FP=$(mktemp)
if ! db_fingerprint "$STAGING_DB" > "$FP"; then drop_scratch_db "$STAGING_DB"; rm -f "$FP"; die "empreinte de $STAGING_DB impossible — rien n'a été modifié" 2; fi
if [ -s "$ARCHIVE.fingerprint" ]; then
  if ! cmp -s "$FP" "$ARCHIVE.fingerprint"; then
    D=$(fingerprint_diff "$ARCHIVE.fingerprint" "$FP" | tr '\n' ' ')
    drop_scratch_db "$STAGING_DB"; rm -f "$FP"
    die "refus : l'archive restaurée ne porte pas l'empreinte enregistrée (tables : ${D:-empreinte globale seulement}) — archive ou .fingerprint altéré, rien n'a été modifié" 2
  fi
  say "empreinte de la restauration de contrôle identique à l'empreinte enregistrée"
fi
say "restauration de contrôle : $(sed -n 's/^decks|\([0-9]*\)|.*/\1/p' "$FP" | head -n 1) deck(s), $(sed -n 's/^cards|\([0-9]*\)|.*/\1/p' "$FP" | head -n 1) carte(s) au catalogue"

if [ "$CHECK_ONLY" = 1 ]; then
  drop_scratch_db "$STAGING_DB"
  echo "$(date -u -Is) archive vérifiée: $(basename "$ARCHIVE") sha256 $(cut -d' ' -f1 "$ARCHIVE.sha256") empreinte $(fingerprint_global "$FP") (--check-only : rien n'a été modifié)"
  rm -f "$FP"
  exit 0
fi

if [ "$YES" != 1 ]; then
  echo "POINT DE NON-RETOUR : la base $DB_NAME sera remplacée par l'archive. L'état courant restera disponible (sauvegarde de sécurité vérifiée dans keep/ et base $PREVIOUS_DB)."
  if [ ! -r /dev/tty ]; then drop_scratch_db "$STAGING_DB"; rm -f "$FP"; die 'aucun terminal : ajouter --yes' 2; fi
  printf 'Restaurer %s ? Taper OUI (en majuscules) : ' "$(basename "$ARCHIVE")"
  read -r answer < /dev/tty || answer=
  if [ "$answer" != OUI ]; then drop_scratch_db "$STAGING_DB"; rm -f "$FP"; die "restauration annulée (réponse « $answer »), rien n'a été modifié" 2; fi
fi

say "4. Arrêt de l'app et sauvegarde de sécurité vérifiée de $DB_NAME"
app_stop
SAFETY_LOG=$(mktemp)
if ! bash ./backup.sh --keep pre-restauration > "$SAFETY_LOG" 2>&1; then
  cat "$SAFETY_LOG"; rm -f "$SAFETY_LOG" "$FP"; drop_scratch_db "$STAGING_DB"; app_start
  die "sauvegarde de sécurité en échec : rien n'a été modifié, app relancée" 1
fi
sed 's/^/    /' "$SAFETY_LOG"
SAFETY=$(sed -n 's/.* sauvegarde vérifiée: \([^ ]*\) .*/\1/p' "$SAFETY_LOG" | tail -n 1); rm -f "$SAFETY_LOG"
SAFETY_PATH="${BACKUP_DIR:-/var/backups/ygo-proba}/$SAFETY"

say "5. Bascule : $DB_NAME → $PREVIOUS_DB, $STAGING_DB → $DB_NAME"
if ! db_query "drop database if exists \"$PREVIOUS_DB\"" postgres >/dev/null; then
  drop_scratch_db "$STAGING_DB"; rm -f "$FP"; app_start
  die "suppression de l'ancienne base $PREVIOUS_DB impossible : rien n'a été modifié, app relancée ; sauvegarde de sécurité : $SAFETY_PATH" 1
fi
if ! db_query "alter database \"$DB_NAME\" rename to \"$PREVIOUS_DB\"" postgres >/dev/null; then
  drop_scratch_db "$STAGING_DB"; rm -f "$FP"; app_start
  die "renommage de $DB_NAME impossible (connexion ouverte ?) : rien n'a été modifié, app relancée ; sauvegarde de sécurité : $SAFETY_PATH" 1
fi
if ! db_query "alter database \"$STAGING_DB\" rename to \"$DB_NAME\"" postgres >/dev/null; then
  db_query "alter database \"$PREVIOUS_DB\" rename to \"$DB_NAME\"" postgres >/dev/null || true
  drop_scratch_db "$STAGING_DB"; rm -f "$FP"; app_start
  die "renommage de $STAGING_DB impossible : base $DB_NAME remise en place, app relancée ; sauvegarde de sécurité : $SAFETY_PATH" 1
fi
FP2=$(mktemp)
if ! db_fingerprint "$DB_NAME" > "$FP2" || ! cmp -s "$FP" "$FP2"; then
  rm -f "$FP" "$FP2"
  die "la base $DB_NAME ne porte pas l'empreinte de la restauration de contrôle : app laissée ARRÊTÉE ; état précédent : base $PREVIOUS_DB et $SAFETY_PATH" 1
fi
rm -f "$FP" "$FP2"

say "6. Redémarrage de l'app"
app_start
echo "$(date -u -Is) restauration ok: $(basename "$ARCHIVE") → $DB_NAME ; empreinte $(fingerprint_global "$ARCHIVE.fingerprint" 2>/dev/null || echo 'non enregistrée') ; état précédent : $SAFETY_PATH (archive vérifiée) et base $PREVIOUS_DB ; retour arrière : bash $LIB_DIR/restore.sh $SAFETY_PATH --yes"
