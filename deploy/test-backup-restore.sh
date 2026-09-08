#!/usr/bin/env bash
# Test de backup.sh et restore.sh sur deux conteneurs jetables (étape 8B, point 3, D3).
#   bash deploy/test-backup-restore.sh        Docker en marche, ports 55438 et 55439 libres
# Source (testhand-bkp-src, 127.0.0.1:55438) : schéma + jeu représentatif pré-001 ; cible
# (testhand-bkp-dst, 127.0.0.1:55439) : schéma seul. Cas joués, dans l'ordre :
#   1. backup.sh : archive, .sha256, .fingerprint, ligne « sauvegarde ok: … » au format du cron
#      puis « sauvegarde vérifiée: … », ygo_verify supprimée après coup ;
#   2. rétention : une archive datée de 20 jours disparaît avec ses compagnons, keep/ est gardé ;
#   3. backup.sh --pre-migration : archive dans keep/, vérification stricte ;
#   4. vérification en échec partiel (BACKUP_VERIFY_DB=ygo, refusé par la garde) : archive
#      conservée, ligne « sauvegarde ok » intacte, ligne « NON vérifiée », code 1, sans .fingerprint ;
#   5. restore.sh refuse sans .sha256, avec une somme fausse, avec une empreinte enregistrée
#      fausse — globale ou d'une table — (mutation M2), et ne modifie rien ;
#   6. restore.sh --yes restaure la source dans la cible : empreinte identique à l'archive,
#      effectifs attendus, sauvegarde de sécurité keep/ygo-pre-restauration-* vérifiée, base
#      ygo_previous présente, aucune base de travail restante ;
#   7. retour arrière : restore.sh --yes sur la sauvegarde de sécurité → empreinte initiale de
#      la cible retrouvée ;
#   8. archive sans .fingerprint : refusée, puis acceptée avec --without-fingerprint.
# Sorties dans deploy/out/test-backup-restore-<horodatage>/ (ignoré par git). Conteneurs
# supprimés à la fin (--rm), y compris en cas d'échec. Jamais la base de dev (5433).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

SRC=testhand-bkp-src; DST=testhand-bkp-dst; SRC_PORT=55438; DST_PORT=55439
OUT="$LIB_DIR/out/test-backup-restore-$(stamp)"
mkdir -p "$OUT/copies"
export BACKUP_DIR="$OUT/backups"
FAILS=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); }
expect() { local label=$1; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }
not() { ! "$@"; }
grep_file() { grep -Eq -- "$1" "$2"; }
run_rc() {  # run_rc <journal> <commande…> : code de retour dans RC, sortie dans le journal
  RC=0; "${@:2}" > "$1" 2>&1 || RC=$?
}
global_of_db() { db_fingerprint "$DB_NAME" | fingerprint_global; }
db_count() { db_query "select count(*) from $1"; }
db_exists() { db_query "select count(*) from pg_database where datname = '$1'" postgres; }

for c in "$SRC" "$DST"; do
  if [ -n "$(docker ps -a --filter "name=^/$c$" --format '{{.Names}}')" ]; then die "le conteneur $c existe déjà : docker stop $c" 2; fi
done
start_db() {  # <nom> <port>
  docker run --name "$1" --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo \
    -p "127.0.0.1:$2:5432" -d postgres:17-alpine > /dev/null
  TESTHAND_DB_CONTAINER=$1 db_ready || die "conteneur $1 injoignable"
}
cleanup() {
  docker stop "$SRC" > /dev/null 2>&1 || true
  docker stop "$DST" > /dev/null 2>&1 || true
}
trap cleanup EXIT

say "conteneurs jetables $SRC (127.0.0.1:$SRC_PORT) et $DST (127.0.0.1:$DST_PORT), sorties : $OUT"
start_db "$SRC" "$SRC_PORT"
start_db "$DST" "$DST_PORT"
export TESTHAND_DB_CONTAINER=$SRC
db_psql < "$ROOT_DIR/db/schema.sql"
db_psql < "$ROOT_DIR/server/tests/fixtures/legacy-representative.sql"
SRC_GLOBAL=$(global_of_db)

say "1. backup.sh (cron) sur la source"
run_rc "$OUT/backup-1.log" bash ./backup.sh
expect "code 0" test "$RC" = 0
ARCHIVE1=$(ls "$BACKUP_DIR"/ygo-*.sql.gz 2>/dev/null | head -n 1 || true)
expect "archive ygo-<horodatage>.sql.gz présente" test -s "${ARCHIVE1:-/nonexistent}"
expect "ligne « sauvegarde ok » au format du cron" grep_file '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2} sauvegarde ok: ygo-[0-9]{8}-[0-9]{6}\.sql\.gz \([0-9.,]+[KMGT]?\)$' "$OUT/backup-1.log"
expect "ligne « sauvegarde vérifiée » avec sha256 et empreinte" grep_file ' sauvegarde vérifiée: ygo-[0-9]{8}-[0-9]{6}\.sql\.gz sha256 [0-9a-f]{64} empreinte [0-9a-f]{32}$' "$OUT/backup-1.log"
expect ".sha256 présent et exact" bash -c "cd '$BACKUP_DIR' && sha256sum -c --status '$(basename "$ARCHIVE1").sha256'"
expect ".fingerprint présent" test -s "$ARCHIVE1.fingerprint"
expect "empreinte de l'archive = empreinte de la base source" test "$(fingerprint_global "$ARCHIVE1.fingerprint")" = "$SRC_GLOBAL"
expect "ygo_verify supprimée après la vérification" test "$(db_exists ygo_verify)" = 0
expect "la source est intacte" test "$(global_of_db)" = "$SRC_GLOBAL"

say "2. rétention : archives de plus de 14 jours du dossier racine, keep/ exclu"
OLD="$BACKUP_DIR/ygo-20000101-000000.sql.gz"
mkdir -p "$BACKUP_DIR/keep"
for f in "$OLD" "$OLD.sha256" "$OLD.fingerprint" "$BACKUP_DIR/keep/ygo-pre-migration-20000101-000000.sql.gz"; do printf 'ancien\n' > "$f"; touch -d '20 days ago' "$f"; done
run_rc "$OUT/backup-2.log" bash ./backup.sh
expect "code 0" test "$RC" = 0
expect "archive ancienne supprimée" not test -e "$OLD"
expect "ses compagnons supprimés" not test -e "$OLD.sha256"
expect "keep/ conservé hors rétention" test -e "$BACKUP_DIR/keep/ygo-pre-migration-20000101-000000.sql.gz"
expect "archive récente conservée" test -s "$ARCHIVE1"
rm -f "$BACKUP_DIR/keep/ygo-pre-migration-20000101-000000.sql.gz"

say "3. backup.sh --pre-migration"
run_rc "$OUT/backup-3.log" bash ./backup.sh --pre-migration
expect "code 0" test "$RC" = 0
PRE=$(ls "$BACKUP_DIR"/keep/ygo-pre-migration-*.sql.gz 2>/dev/null | head -n 1 || true)
expect "archive keep/ygo-pre-migration-<horodatage>.sql.gz" test -s "${PRE:-/nonexistent}"
expect "ligne « sauvegarde vérifiée: keep/… »" grep_file ' sauvegarde vérifiée: keep/ygo-pre-migration-[0-9]{8}-[0-9]{6}\.sql\.gz sha256 ' "$OUT/backup-3.log"
expect ".sha256 et .fingerprint présents" bash -c "test -s '$PRE.sha256' && test -s '$PRE.fingerprint'"
expect "empreinte = base source" test "$(fingerprint_global "$PRE.fingerprint")" = "$SRC_GLOBAL"

say "4. extension en échec partiel : la garde refuse BACKUP_VERIFY_DB=ygo (base servie)"
BEFORE4=$(ls "$BACKUP_DIR"/ygo-*.sql.gz | wc -l | tr -d ' ')
run_rc "$OUT/backup-4.log" env BACKUP_VERIFY_DB=ygo bash ./backup.sh
expect "code 1" test "$RC" = 1
expect "ligne « sauvegarde ok » toujours écrite" grep_file ' sauvegarde ok: ygo-[0-9]{8}-[0-9]{6}\.sql\.gz \(' "$OUT/backup-4.log"
expect "ligne « sauvegarde NON vérifiée » avec la raison" grep_file ' sauvegarde NON vérifiée: ygo-.* base de travail invalide' "$OUT/backup-4.log"
expect "archive conservée" test "$(ls "$BACKUP_DIR"/ygo-*.sql.gz | wc -l | tr -d ' ')" = "$((BEFORE4 + 1))"
ARCHIVE4=$(ls -t "$BACKUP_DIR"/ygo-*.sql.gz | head -n 1)
expect "aucun .fingerprint pour l'archive non vérifiée" not test -e "$ARCHIVE4.fingerprint"
expect "la base servie n'a pas été touchée" test "$(global_of_db)" = "$SRC_GLOBAL"

say "5. restore.sh : refus sans .sha256, somme fausse, empreinte enregistrée fausse (M2)"
export TESTHAND_DB_CONTAINER=$DST
db_psql < "$ROOT_DIR/db/schema.sql"
DST0=$(global_of_db)
cp "$PRE" "$OUT/copies/sans-sha.sql.gz"
run_rc "$OUT/restore-5a.log" bash ./restore.sh "$OUT/copies/sans-sha.sql.gz" --yes
expect "5a sans .sha256 : code 2" test "$RC" = 2
expect "5a message nommant le .sha256 absent" grep_file '\.sha256 » absent' "$OUT/restore-5a.log"
cp "$PRE" "$OUT/copies/corrompue.sql.gz"; printf 'x' >> "$OUT/copies/corrompue.sql.gz"
sed "s/$(basename "$PRE")/corrompue.sql.gz/" "$PRE.sha256" > "$OUT/copies/corrompue.sql.gz.sha256"
cp "$PRE.fingerprint" "$OUT/copies/corrompue.sql.gz.fingerprint"
run_rc "$OUT/restore-5b.log" bash ./restore.sh "$OUT/copies/corrompue.sql.gz" --yes
expect "5b somme fausse : code 2" test "$RC" = 2
expect "5b message « somme SHA-256 différente »" grep_file 'somme SHA-256 différente' "$OUT/restore-5b.log"
for variant in globale table; do
  cp "$PRE" "$OUT/copies/empreinte-$variant.sql.gz"
  sed "s/$(basename "$PRE")/empreinte-$variant.sql.gz/" "$PRE.sha256" > "$OUT/copies/empreinte-$variant.sql.gz.sha256"
  if [ "$variant" = globale ]; then sed 's/^empreinte|\(.\)/empreinte|0/; t; s/^empreinte|0/empreinte|1/' "$PRE.fingerprint" > "$OUT/copies/empreinte-$variant.sql.gz.fingerprint"
  else sed 's/^decks|\([0-9]*\)|\(.\)/decks|\1|0/' "$PRE.fingerprint" > "$OUT/copies/empreinte-$variant.sql.gz.fingerprint"; fi
  expect "5c fichier .fingerprint réellement altéré ($variant)" not cmp -s "$PRE.fingerprint" "$OUT/copies/empreinte-$variant.sql.gz.fingerprint"
  run_rc "$OUT/restore-5c-$variant.log" bash ./restore.sh "$OUT/copies/empreinte-$variant.sql.gz" --yes
  expect "5c empreinte $variant fausse : code 2" test "$RC" = 2
  expect "5c message « ne porte pas l'empreinte enregistrée »" grep_file "ne porte pas l'empreinte enregistrée" "$OUT/restore-5c-$variant.log"
done
expect "5 la cible n'a pas été modifiée" test "$(global_of_db)" = "$DST0"
expect "5 aucune base de travail restante" test "$(db_exists ygo_restore)" = 0
expect "5 aucune sauvegarde de sécurité créée" not ls "$BACKUP_DIR"/keep/ygo-pre-restauration-*.sql.gz

say "6. restore.sh --yes : la source restaurée dans la cible, sauvegarde de sécurité, base précédente"
run_rc "$OUT/restore-6.log" bash ./restore.sh "$PRE" --yes
expect "code 0" test "$RC" = 0
expect "ligne « restauration ok »" grep_file ' restauration ok: ygo-pre-migration-' "$OUT/restore-6.log"
DST_FP=$(mktemp); db_fingerprint "$DB_NAME" > "$DST_FP"
expect "empreinte de la cible identique à l'archive (ligne à ligne)" cmp -s "$DST_FP" "$PRE.fingerprint"
expect "4 decks" test "$(db_count decks)" = 4
expect "4 paires globales" test "$(db_count combo_pairs)" = 4
expect "19 cartes" test "$(db_count cards)" = 19
SAFETY=$(ls "$BACKUP_DIR"/keep/ygo-pre-restauration-*.sql.gz 2>/dev/null | head -n 1 || true)
expect "sauvegarde de sécurité keep/ygo-pre-restauration-*" test -s "${SAFETY:-/nonexistent}"
expect "sa somme et son empreinte" bash -c "test -s '$SAFETY.sha256' && test -s '$SAFETY.fingerprint'"
expect "son empreinte = état initial de la cible" test "$(fingerprint_global "$SAFETY.fingerprint")" = "$DST0"
expect "base ygo_previous présente" test "$(db_exists ygo_previous)" = 1
expect "aucune base de travail restante" test "$(db_exists ygo_restore)" = 0
rm -f "$DST_FP"

say "7. retour arrière : restore.sh --yes sur la sauvegarde de sécurité"
run_rc "$OUT/restore-7.log" bash ./restore.sh "$SAFETY" --yes
expect "code 0" test "$RC" = 0
expect "empreinte initiale de la cible retrouvée" test "$(global_of_db)" = "$DST0"
expect "0 deck" test "$(db_count decks)" = 0

say "8. archive sans .fingerprint : refusée, puis acceptée avec --without-fingerprint"
cp "$PRE" "$OUT/copies/sans-empreinte.sql.gz"
sed "s/$(basename "$PRE")/sans-empreinte.sql.gz/" "$PRE.sha256" > "$OUT/copies/sans-empreinte.sql.gz.sha256"
run_rc "$OUT/restore-8a.log" bash ./restore.sh "$OUT/copies/sans-empreinte.sql.gz" --yes
expect "8a refus : code 2" test "$RC" = 2
expect "8a message nommant le .fingerprint absent" grep_file '\.fingerprint » absent' "$OUT/restore-8a.log"
expect "8a cible intacte" test "$(global_of_db)" = "$DST0"
run_rc "$OUT/restore-8b.log" bash ./restore.sh "$OUT/copies/sans-empreinte.sql.gz" --yes --without-fingerprint
expect "8b --without-fingerprint : code 0" test "$RC" = 0
expect "8b empreinte de la cible = source" test "$(global_of_db)" = "$SRC_GLOBAL"

echo
if [ "$FAILS" -gt 0 ]; then echo "ÉCHEC : $FAILS garde(s) en échec — journaux dans $OUT"; exit 1; fi
echo "OK : toutes les gardes passent — journaux dans $OUT"
