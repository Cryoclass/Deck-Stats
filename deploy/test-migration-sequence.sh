#!/usr/bin/env bash
# Cas négatifs de la séquence partagée de lib.sh (étape 8B, point 5) sur un conteneur jetable :
#   bash deploy/test-migration-sequence.sh        Docker en marche, port 55440 libre
# deploy.sh ne peut pas tourner hors VPS (git pull, Compose de production) : sa séquence vit dans
# lib.sh (run_migration_sequence) et se joue ici sur le jeu représentatif, avec des crochets qui
# enregistrent l'app relancée / laissée arrêtée. Chaque cas repart d'une base réinitialisée :
#   A. sauvegarde pré-migration en échec → code 1, ancienne app relancée, base intacte ;
#   B. 003 refusée (prérequis historique jamais converti, injecté après 002) → code 1, app
#      démarrée sans 003, 001, 002 et 004 journalisées, 003 absente ;
#   C. marqueur « SIMULATION TERMINÉE » retiré de la sortie de psql (code 0 conservé) → code 1,
#      003 non appliquée : le code de sortie seul n'est jamais un succès ;
#   D. --accept avec une empreinte différente → code 3, app démarrée sans 003 ;
#   E. contrôle après migration en échec (table combo_pairs recréée juste après l'application de
#      003) → code 2, app laissée ARRÊTÉE, commande de restauration nommant l'archive pré-migration ;
#   F. --accept avec l'empreinte de la simulation → code 0, 003 journalisée, contrôles OK ; rejeu →
#      code 0, « déjà appliquée », aucune nouvelle acceptation ; puis base à 003 SANS 004 (état de
#      la production avant l'étape 10) → 004 appliquée par la branche post-003, sans question ;
#   G. base vide (« départ à vide », 8C) en mode interactif sans terminal → code 0 sans question
#      (une question aurait rendu 3), 001 à 004 journalisées, 0 ligne purgée, contrôle
#      « base vide au départ » OK ; rejeu → code 0, « déjà journalisée », base identique ;
#   H. base vide mais une table conservée remplie après 003 (users) → code 2, app laissée
#      ARRÊTÉE, KO nominatif du contrôle « base vide au départ » ;
#   I. (étape 9B, incident 8C) volume neuf : conteneur créé par `docker create`, scripts
#      d'initialisation copiés par `docker cp` (schéma, 001 à 004 comme en production, plus
#      98-slow.sql à pg_sleep(6) qui prolonge la fenêtre du serveur temporaire une fois la base
#      complète), démarré ; un témoin en arrière-plan enregistre le premier `select 1` réussi par le
#      socket et les journaux à cet instant (« init process complete » absent = fenêtre ouverte,
#      l'ancienne attente aurait accepté) ; db_ready ne rend la main qu'avec le serveur définitif
#      annoncé ; la séquence lancée aussitôt finit en code 0 (003 journalisée par initdb, aucune
#      question), aucun « shutting down » dans ses sorties.
# Sorties dans deploy/out/test-migration-sequence-<horodatage>/ (ignoré par git). Conteneur
# supprimé à la fin (--rm), y compris en cas d'échec. Jamais la base de dev (5433).
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

CONTAINER=testhand-seq-db; PORT=55440
OUT="$LIB_DIR/out/test-migration-sequence-$(stamp)"
mkdir -p "$OUT"
export BACKUP_DIR="$OUT/backups"
export TESTHAND_DB_CONTAINER=$CONTAINER
FAILS=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; FAILS=$((FAILS + 1)); }
expect() { local label=$1; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }
not() { ! "$@"; }
grep_file() { grep -Eq -- "$1" "$2"; }
journal_now() { if [ "$(db_query "select to_regclass('public.app_migrations') is null")" = t ]; then echo ''; else db_query "select coalesce(string_agg(id, ',' order by id), '') from app_migrations"; fi; }
hooks_are() { [ "$(tr '\n' ' ' < "$HOOKS")" = "$1 " ]; }

if [ -n "$(docker ps -a --filter "name=^/$CONTAINER$" --format '{{.Names}}')" ]; then die "le conteneur $CONTAINER existe déjà : docker stop $CONTAINER" 2; fi
cleanup() { docker stop "$CONTAINER" > /dev/null 2>&1 || true; }
trap cleanup EXIT
say "conteneur jetable $CONTAINER (127.0.0.1:$PORT), sorties : $OUT"
docker run --name "$CONTAINER" --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo \
  -p "127.0.0.1:$PORT:5432" -d postgres:17-alpine > /dev/null
db_ready || die "conteneur $CONTAINER injoignable"

# Crochets : journal des appels dans $HOOKS ; sauvegarde réelle par backup.sh.
HOOKS=
hook_stop_app() { echo stop >> "$HOOKS"; }
hook_start_app() { echo start-new >> "$HOOKS"; }
hook_start_old_app() { echo start-old >> "$HOOKS"; }
hook_app_left_stopped() { echo "left-stopped $1" >> "$HOOKS"; }
hook_backup() { backup_pre_migration "$1"; }
# Redéfinition d'une fonction de lib.sh autour de l'originale (copie sous un autre nom).
keep_original() { eval "orig_$1() $(declare -f "$1" | sed '1d')"; }

begin_case() {  # <lettre> [empty|fresh] : base réinitialisée (schéma + fixture pré-001, ou vide ; fresh = aucun conteneur encore, cas I), crochets vides, lib.sh rechargée
  . ./lib.sh
  hook_stop_app() { echo stop >> "$HOOKS"; }
  hook_start_app() { echo start-new >> "$HOOKS"; }
  hook_start_old_app() { echo start-old >> "$HOOKS"; }
  hook_app_left_stopped() { echo "left-stopped $1" >> "$HOOKS"; }
  hook_backup() { backup_pre_migration "$1"; }
  CASE_OUT="$OUT/case-$1"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
  case "${2:-}" in
    fresh) ;;
    empty) db_query 'drop schema public cascade; create schema public;' > /dev/null ;;
    *)
      db_query 'drop schema public cascade; create schema public;' > /dev/null
      db_psql < "$ROOT_DIR/db/schema.sql"
      db_psql < "$ROOT_DIR/server/tests/fixtures/legacy-representative.sql" ;;
  esac
  say "cas $1"
}
run_seq() { RC=0; run_migration_sequence "$CASE_OUT" "$1" > "$CASE_OUT/sequence.log" 2>&1 || RC=$?; }

# ─── A. sauvegarde en échec ───
begin_case A
FP_A=$(db_fingerprint | fingerprint_global)
hook_backup() { echo 'sauvegarde volontairement en échec' >> "$1/backup.log"; return 1; }
run_seq auto
expect "A code 1" test "$RC" = 1
expect "A ancienne app relancée (stop, start-old)" hooks_are "stop start-old"
expect "A base intacte (empreinte identique, aucun journal)" test "$(db_fingerprint | fingerprint_global)" = "$FP_A" -a "$(journal_now)" = ''
expect "A journal : « sauvegarde pré-migration en échec »" grep_file 'sauvegarde pré-migration en échec' "$CASE_OUT/journal.txt"

# ─── B. 003 refusée sur donnée non convertie ───
begin_case B
keep_original simulate_003
simulate_003() {
  db_query "insert into deck_start_requirements (id, deck_id, source_card_id, required_card_id, min_in_deck) values ('00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-0000000000d3', 90000003, 90000005, 1)" > /dev/null
  orig_simulate_003 "$@"
}
run_seq auto
expect "B code 1" test "$RC" = 1
expect "B app démarrée sans 003 (stop, start-new)" hooks_are "stop start-new"
expect "B journal 001, 002 et 004 seulement" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans'
expect "B refus nominatif dans 003-simulation.txt.err" grep_file 'jamais converti' "$CASE_OUT/003-simulation.txt.err"
expect "B journal : « 003 refusée ou en erreur en simulation »" grep_file '003 refusée ou en erreur en simulation' "$CASE_OUT/journal.txt"

# ─── C. marqueur de simulation absent, code 0 ───
begin_case C
keep_original run_003
run_003() {
  local report=$1
  orig_run_003 "$@" || return $?
  case "$*" in *simulate*) sed -i '/SIMULATION TERMINÉE/d' "$report" ;; esac
  return 0
}
run_seq auto
expect "C code 1 (le code 0 de psql sans marqueur n'est pas un succès)" test "$RC" = 1
expect "C journal : « marqueur « SIMULATION TERMINÉE » absent »" grep_file 'marqueur « SIMULATION TERMINÉE » absent' "$CASE_OUT/journal.txt"
expect "C 003 non journalisée" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans'
expect "C app démarrée sans 003" hooks_are "stop start-new"
expect "C la table combo_pairs existe encore" test "$(db_query "select to_regclass('public.combo_pairs') is not null")" = t

# ─── D. empreinte fournie différente ───
begin_case D
run_seq 00000000000000000000000000000000
expect "D code 3" test "$RC" = 3
expect "D app démarrée sans 003" hooks_are "stop start-new"
expect "D journal : « différente du rapport »" grep_file 'différente du rapport' "$CASE_OUT/journal.txt"
expect "D 003 non journalisée, combo_pairs conservée" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans' -a "$(db_query 'select count(*) from combo_pairs')" = 4
SIM_FP_D=$SIM_FP
expect "D empreinte de la simulation capturée" bash -c "printf '%s' '$SIM_FP_D' | grep -Eq '^[0-9a-f]{32}$'"

# ─── E. contrôle après migration en échec ───
begin_case E
keep_original apply_003
apply_003() {
  orig_apply_003 "$@"
  db_query 'create table combo_pairs (id int)' > /dev/null
}
run_seq auto
expect "E code 2" test "$RC" = 2
expect "E app laissée arrêtée avec la commande de restauration" grep_file '^left-stopped bash .*/restore\.sh .*/keep/ygo-pre-migration-[0-9]{8}-[0-9]{6}\.sql\.gz$' "$HOOKS"
expect "E aucun démarrage de l'app" not grep_file 'start' "$HOOKS"
expect "E KO nominatif dans check-migration.txt" grep_file 'KO\|table historique combo_pairs : ENCORE PRÉSENTE' "$CASE_OUT/check-migration.txt"
expect "E l'archive pré-migration nommée existe avec sa somme et son empreinte" bash -c "a=\$(sed -n 's/^left-stopped bash [^ ]* //p' '$HOOKS'); test -s \"\$a\" && test -s \"\$a.sha256\" && test -s \"\$a.fingerprint\""

# ─── F. acceptation par l'empreinte exacte, puis rejeu ───
begin_case F
run_seq "$SIM_FP_D"
expect "F code 0" test "$RC" = 0
expect "F 001 à 004 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans'
expect "F 004 : les trois tables des plans de side existent" test "$(db_query "select count(*) from pg_tables where schemaname = 'public' and tablename in ('deck_matchups', 'deck_side_plans', 'deck_side_plan_cards')")" = 3
expect "F app démarrée (stop, start-new)" hooks_are "stop start-new"
expect "F journal : empreinte fournie identique" grep_file 'empreinte fournie identique au rapport' "$CASE_OUT/journal.txt"
expect "F purge appliquée : 14 lignes" grep_file 'PURGE APPLIQUÉE : 003-purge-legacy journalisée, 14 ligne' "$CASE_OUT/003-apply.txt"
expect "F aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"
expect "F combo_pairs supprimée" test "$(db_query "select to_regclass('public.combo_pairs') is null")" = t
FP_F=$(db_fingerprint | fingerprint_global)
CASE_OUT="$OUT/case-F-rejeu"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F rejeu : code 0 sans question" test "$RC" = 0
expect "F rejeu : « déjà journalisée »" grep_file 'déjà journalisée' "$CASE_OUT/journal.txt"
expect "F rejeu : base identique" test "$(db_fingerprint | fingerprint_global)" = "$FP_F"
# F, base à 003 SANS 004 : l'état de la production migrée en 8C, avant l'étape 10. Aucun autre cas
# ne le produit (initdb applique 004 dans le cas I, la première séquence dans F et G) : c'est la
# seule preuve que la branche « 003 déjà journalisée » rejoue bien les migrations additives.
db_query "drop table deck_side_plan_cards, deck_side_plans, deck_matchups; delete from app_migrations where id = '004-side-plans'" > /dev/null
CASE_OUT="$OUT/case-F-sans-004"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F sans 004 : code 0 sans question" test "$RC" = 0
expect "F sans 004 : 003 « déjà journalisée »" grep_file 'déjà journalisée' "$CASE_OUT/journal.txt"
expect "F sans 004 : 004 rejouée par la branche post-003" grep_file 'rejeu par stdin : db/migrations/004-side-plans.sql' "$CASE_OUT/journal.txt"
expect "F sans 004 : 001 à 004 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans'
expect "F sans 004 : les trois tables des plans de side existent" test "$(db_query "select count(*) from pg_tables where schemaname = 'public' and tablename in ('deck_matchups', 'deck_side_plans', 'deck_side_plan_cards')")" = 3
expect "F sans 004 : aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"

# ─── G. base vide (« départ à vide », 8C) : aucune question, 003 journalisée, contrôles OK ───
begin_case G empty
expect "G base vide au départ (aucune table dans public)" test "$(db_query "select count(*) from pg_tables where schemaname = 'public'")" = 0
run_seq interactive
expect "G code 0 sans question (aucun terminal : une question aurait rendu 3)" test "$RC" = 0
expect "G 001 à 004 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans'
expect "G app démarrée (stop, start-new)" hooks_are "stop start-new"
expect "G journal : « rien à purger : aucune acceptation requise »" grep_file 'rien à purger : aucune acceptation requise' "$CASE_OUT/journal.txt"
expect "G purge appliquée : 0 ligne" grep_file 'PURGE APPLIQUÉE : 003-purge-legacy journalisée, 0 ligne' "$CASE_OUT/003-apply.txt"
expect "G contrôle « base vide au départ » OK" grep_file '^OK\|base vide au départ' "$CASE_OUT/check-migration.txt"
expect "G aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"
expect "G tables conservées présentes et vides (users, cards, decks)" test "$(db_query 'select (select count(*) from users) + (select count(*) from cards) + (select count(*) from decks)')" = 0
FP_G=$(db_fingerprint | fingerprint_global)
CASE_OUT="$OUT/case-G-rejeu"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "G rejeu : code 0 sans question" test "$RC" = 0
expect "G rejeu : « déjà journalisée »" grep_file 'déjà journalisée' "$CASE_OUT/journal.txt"
expect "G rejeu : base identique" test "$(db_fingerprint | fingerprint_global)" = "$FP_G"

# ─── H. base vide mais une table conservée remplie après 003 → code 2, KO nominatif ───
begin_case H empty
keep_original apply_003
apply_003() {
  orig_apply_003 "$@"
  db_query "insert into users (email, display_name) values ('h@example.test', 'H')" > /dev/null
}
run_seq interactive
expect "H code 2" test "$RC" = 2
expect "H app laissée arrêtée, aucun démarrage" bash -c "grep -q '^left-stopped bash ' '$HOOKS' && ! grep -q start '$HOOKS'"
expect "H KO nominatif : users (1 ligne(s))" grep_file '^KO\|base vide au départ .*users \(1 ligne\(s\)\)' "$CASE_OUT/check-migration.txt"

# ─── I. volume neuf : db_ready exclut le serveur temporaire d'initialisation (étape 9B, incident 8C) ───
# Le conteneur des cas A–H est remplacé par un conteneur CRÉÉ puis démarré, dont l'entrypoint joue
# les scripts copiés dans docker-entrypoint-initdb.d comme en production (schéma, 001 à 004) ;
# 98-slow.sql (pg_sleep(6)) prolonge la fenêtre du serveur temporaire alors que la base est déjà
# complète : le pire cas pour une attente naïve. Rien n'est réinitialisé : la séquence part de
# l'état laissé par initdb, comme le premier deploy.sh de 8C.
begin_case I fresh
docker stop "$CONTAINER" > /dev/null 2>&1 || true
for i in $(seq 1 60); do [ -z "$(docker ps -a --filter "name=^/$CONTAINER$" --format '{{.Names}}')" ] && break; sleep 1; done
[ -z "$(docker ps -a --filter "name=^/$CONTAINER$" --format '{{.Names}}')" ] || die "le conteneur $CONTAINER des cas A–H n'a pas disparu" 2
printf 'select pg_sleep(6);\n' > "$CASE_OUT/98-slow.sql"
mkdir -p "$CASE_OUT/container-logs"
docker create --name "$CONTAINER" --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo \
  -p "127.0.0.1:$PORT:5432" postgres:17-alpine > /dev/null
for f in db/schema.sql:00-schema.sql db/migrations/001-deck-configuration.sql:01-deck-configuration.sql \
         db/migrations/002-profiles-and-conditions.sql:02-profiles-and-conditions.sql db/migrations/003-purge-legacy.sql:03-purge-legacy.sql \
         db/migrations/004-side-plans.sql:04-side-plans.sql; do
  docker cp "$(host_path "$ROOT_DIR/${f%%:*}")" "$CONTAINER:/docker-entrypoint-initdb.d/${f##*:}"
done
docker cp "$(host_path "$CASE_OUT/98-slow.sql")" "$CONTAINER:/docker-entrypoint-initdb.d/98-slow.sql"
docker start "$CONTAINER" > /dev/null
# Témoin : premier `select 1` réussi par le socket (ce que l'ancienne attente acceptait), journaux à cet instant.
( for i in $(seq 1 300); do
    if docker exec "$CONTAINER" psql -U ygo -d ygo -qAt -c 'select 1' > /dev/null 2>&1; then
      docker logs "$CONTAINER" > "$CASE_OUT/container-logs/at-first-select.txt" 2>&1; date -u -Is > "$CASE_OUT/witness-time.txt"; exit 0
    fi
    sleep 0.2
  done
  echo timeout > "$CASE_OUT/witness-time.txt" ) &
WITNESS=$!
T0_READY=$(date +%s)
if db_ready; then READY_RC=0; else READY_RC=$?; fi
T_READY=$(( $(date +%s) - T0_READY ))
docker logs "$CONTAINER" > "$CASE_OUT/container-logs/at-db-ready.txt" 2>&1
run_seq interactive
wait "$WITNESS" || true
docker logs "$CONTAINER" > "$CASE_OUT/container-logs/after-sequence.txt" 2>&1
definitive_announced() { awk '/init process complete/ { m = NR } /ready to accept connections/ { r = NR } END { exit (m && r > m) ? 0 : 1 }' "$1"; }
expect "I db_ready rendue en code 0 ($T_READY s)" test "$READY_RC" = 0
expect "I témoin : un select 1 par le socket a réussi pendant l'initialisation" test -s "$CASE_OUT/container-logs/at-first-select.txt"
expect "I témoin : « init process complete » absent à cet instant (fenêtre du serveur temporaire ouverte)" not grep_file 'init process complete' "$CASE_OUT/container-logs/at-first-select.txt"
expect "I témoin : le serveur temporaire annonçait déjà « ready to accept connections »" grep_file 'ready to accept connections' "$CASE_OUT/container-logs/at-first-select.txt"
expect "I à la sortie de db_ready : « init process complete » suivi du second « ready »" definitive_announced "$CASE_OUT/container-logs/at-db-ready.txt"
expect "I 98-slow.sql joué par l'entrypoint (fenêtre prolongée de 6 s)" grep_file 'running /docker-entrypoint-initdb.d/98-slow.sql' "$CASE_OUT/container-logs/at-db-ready.txt"
expect "I séquence lancée aussitôt : code 0" test "$RC" = 0
expect "I 003 déjà journalisée par initdb : aucune question" grep_file 'déjà journalisée' "$CASE_OUT/journal.txt"
expect "I 001 à 004 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans'
expect "I app démarrée (stop, start-new)" hooks_are "stop start-new"
expect "I aucun « shutting down » dans les sorties de la séquence" not bash -c "grep -rq 'shutting down' '$CASE_OUT' --exclude-dir=container-logs"
expect "I aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"

echo
if [ "$FAILS" -gt 0 ]; then echo "ÉCHEC : $FAILS garde(s) en échec — journaux dans $OUT"; exit 1; fi
echo "OK : toutes les gardes passent (cas A–I) — journaux dans $OUT"
