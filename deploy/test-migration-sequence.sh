#!/usr/bin/env bash
# Cas négatifs de la séquence partagée de lib.sh (étape 8B, point 5) sur un conteneur jetable :
#   bash deploy/test-migration-sequence.sh        Docker en marche, port 55440 libre
# deploy.sh ne peut pas tourner hors VPS (git pull, Compose de production) : sa séquence vit dans
# lib.sh (run_migration_sequence) et se joue ici sur le jeu représentatif, avec des crochets qui
# enregistrent l'app relancée / laissée arrêtée. Chaque cas repart d'une base réinitialisée :
#   A. sauvegarde pré-migration en échec → code 1, ancienne app relancée, base intacte ;
#   B. 003 refusée (prérequis historique jamais converti, injecté après 002) → code 1, app
#      démarrée sans 003, 001, 002, 004, 005 et 006 journalisées, 003 absente ;
#   C. marqueur « SIMULATION TERMINÉE » retiré de la sortie de psql (code 0 conservé) → code 1,
#      003 non appliquée : le code de sortie seul n'est jamais un succès ;
#   D. --accept avec une empreinte différente → code 3, app démarrée sans 003 ;
#   E. contrôle après migration en échec (table combo_pairs recréée juste après l'application de
#      003) → code 2, app laissée ARRÊTÉE, commande de restauration nommant l'archive pré-migration ;
#   F. --accept avec l'empreinte de la simulation → code 0, 003 journalisée, contrôles OK ; rejeu →
#      code 0, « déjà appliquée », aucune nouvelle acceptation ; puis base à 003 SANS 004 (état de
#      la production avant l'étape 10) → 004 appliquée par la branche post-003, sans question ;
#      puis base à 004 SANS 005 ni rôle PostgreSQL (état de la production avant le back-office) →
#      005 appliquée par la branche post-003, rôle créé, `users` reformée à effectif identique et
#      rôles « user », contrôles OK ; puis base à 005 SANS 006 (tout ce que 006 apporte défait,
#      donnée représentative posée AVANT) → 006 appliquée par la branche post-003, profil
#      « reactive » et rôle « referent » refusés avant et acceptés après, `is_hopt = false` passé
#      à NULL, `nonengine_choice` posé sur les seules lignes à profil, carte seulement étiquetée
#      non matérialisée, groupe « Mulcharmy » fourni de base créé, aperçus à NULL, journal des
#      références en ajout seul, contrôle nominatif OK ; rejeu → un choix « false » et un aperçu
#      posés APRÈS 006 survivent (second marqueur de journal « 006-annotation-defaults/c ») ;
#   G. base vide (« départ à vide », 8C) en mode interactif sans terminal → code 0 sans question
#      (une question aurait rendu 3), 001 à 006 journalisées, 0 ligne purgée, contrôle
#      « base vide au départ » OK ; rejeu → code 0, « déjà journalisée », base identique ;
#   H. base vide mais une table conservée remplie après 003 (users) → code 2, app laissée
#      ARRÊTÉE, KO nominatif du contrôle « base vide au départ » ;
#   I. (étape 9B, incident 8C) volume neuf : conteneur créé par `docker create`, scripts
#      d'initialisation copiés par `docker cp` (schéma, 001 à 006 comme en production, plus
#      98-slow.sql à pg_sleep(6) qui prolonge la fenêtre du serveur temporaire une fois la base
#      complète), démarré ; un témoin en arrière-plan enregistre le premier `select 1` réussi par le
#      socket et les journaux à cet instant (« init process complete » absent = fenêtre ouverte,
#      l'ancienne attente aurait accepté) ; db_ready ne rend la main qu'avec le serveur définitif
#      annoncé ; la séquence lancée aussitôt finit en code 0 (003 journalisée par initdb, aucune
#      question), aucun « shutting down » dans ses sorties ;
#   J. (back-office) ligne de commande backoffice-role.sh sur la base de I : simulation sans
#      écriture, --apply journalisé (backoffice_audit, source cli), rien à appliquer au rejeu,
#      retrait, liste, compte inconnu refusé (code 1), `--role referent` et cible inconnue ; le
#      journal refuse toute suppression ; le rôle testhand_backoffice n'a aucun privilège sur
#      deck_cards, ne lit pas decks.name, et ne lit card_references qu'en lecture seule.
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
expect "B journal 001, 002, 004, 005 et 006 seulement" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
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
expect "C 003 non journalisée" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
expect "C app démarrée sans 003" hooks_are "stop start-new"
expect "C la table combo_pairs existe encore" test "$(db_query "select to_regclass('public.combo_pairs') is not null")" = t

# ─── D. empreinte fournie différente ───
begin_case D
run_seq 00000000000000000000000000000000
expect "D code 3" test "$RC" = 3
expect "D app démarrée sans 003" hooks_are "stop start-new"
expect "D journal : « différente du rapport »" grep_file 'différente du rapport' "$CASE_OUT/journal.txt"
expect "D 003 non journalisée, combo_pairs conservée" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c' -a "$(db_query 'select count(*) from combo_pairs')" = 4
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
expect "F 001 à 006 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
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
expect "F sans 004 : 001 à 006 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
expect "F sans 004 : les trois tables des plans de side existent" test "$(db_query "select count(*) from pg_tables where schemaname = 'public' and tablename in ('deck_matchups', 'deck_side_plans', 'deck_side_plan_cards')")" = 3
expect "F sans 004 : aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"
# F, base à 004 SANS 005 ni rôle PostgreSQL : l'état de la production avant le back-office. Seule
# preuve que la branche « 003 déjà journalisée » rejoue 005, crée le rôle, et que le contrôle de
# bout en bout accepte `users` reformée (colonne role ajoutée) à effectif identique.
db_query "drop owned by testhand_backoffice; drop role testhand_backoffice; drop table backoffice_audit, backoffice_sessions, backoffice_totp; drop function backoffice_audit_refuse; alter table users drop column role; delete from app_migrations where id = '005-backoffice'" > /dev/null
USERS_F=$(db_query 'select count(*) from users')
CASE_OUT="$OUT/case-F-sans-005"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F sans 005 : code 0 sans question" test "$RC" = 0
expect "F sans 005 : 005 rejouée par la branche post-003" grep_file 'rejeu par stdin : db/migrations/005-backoffice.sql' "$CASE_OUT/journal.txt"
expect "F sans 005 : 001 à 006 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
expect "F sans 005 : rôle testhand_backoffice créé, NOLOGIN" test "$(db_query "select rolcanlogin from pg_roles where rolname = 'testhand_backoffice'")" = f
expect "F sans 005 : users reformée à effectif identique ($USERS_F), rôles « user » (contrôle OK nominatif)" grep_file "^OK\|005 appliquée par cette séquence : users reformée \(colonne role ajoutée\), effectif $USERS_F identique, tous les rôles « user »" "$CASE_OUT/check-migration.txt"
expect "F sans 005 : users hors de la liste stricte, les autres tables intactes" grep_file '^OK\|tables intactes de bout en bout \(effectif et contenu\) : cards catalog_version user_identities sessions deck_cards deck_starters card_categories' "$CASE_OUT/check-migration.txt"
expect "F sans 005 : aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"
FP_F5=$(db_fingerprint | fingerprint_global)
CASE_OUT="$OUT/case-F-rejeu-005"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F rejeu après 005 : code 0, base identique, users strictement intacte" test "$RC" = 0 -a "$(db_fingerprint | fingerprint_global)" = "$FP_F5"
expect "F rejeu après 005 : liste stricte complète (users comprise)" grep_file '^OK\|tables intactes de bout en bout \(effectif et contenu\) : cards catalog_version users user_identities' "$CASE_OUT/check-migration.txt"

# F, base à 005 SANS 006 : l'état de la production avant le chantier « annotations par défaut ».
# Tout ce que 006 apporte est défait (contrainte de 002 à quatre profils, users_role_check à deux
# valeurs, colonnes nonengine_choice / is_builtin, is_hopt « not null », référence et son journal,
# groupes « Mulcharmy », les DEUX marqueurs de journal), puis une donnée représentative est posée
# AVANT la séquence. Seule preuve que la branche « 003 déjà journalisée » rejoue 006, que le
# cinquième profil et le rôle « referent » n'arrivent qu'après, et que la partie C migre les
# données une seule fois et correctement (contrôle nominatif de check_006_data).
db_query "
  alter table card_flags drop constraint card_flags_availability_check;
  alter table card_flags add constraint card_flags_availability_check check (availability in ('early', 'flexible', 'prepared', 'breaker'));
  alter table users drop constraint users_role_check;
  alter table users add constraint users_role_check check (role in ('user', 'admin'));
  alter table card_flags drop column nonengine_choice;
  update card_flags set is_hopt = false where is_hopt is null;
  alter table card_flags alter column is_hopt set not null;
  alter table nonengine_groups drop column is_builtin;
  delete from nonengine_groups where name = 'Mulcharmy';
  drop table card_reference_log, card_references;
  drop function card_reference_log_refuse();
  delete from app_migrations where id = '006-annotation-defaults';
  delete from app_migrations where id = '006-annotation-defaults/c';
" > /dev/null
# avail_ok <profil> : 0 si card_flags accepte ce profil (ligne d'essai retirée aussitôt).
avail_ok() {
  db_query "insert into card_flags (owner_id, card_id, availability) values ((select id from users order by id limit 1), 999000001, '$1')" > /dev/null 2>&1 || return 1
  db_query 'delete from card_flags where card_id = 999000001' > /dev/null
}
# role_ok <rôle> : 0 si users.role accepte cette valeur (compte d'essai retiré aussitôt).
role_ok() {
  db_query "insert into users (email, display_name, role) values ('role-essai@example.invalid', 'Essai', '$1')" > /dev/null 2>&1 || return 1
  db_query "delete from users where email = 'role-essai@example.invalid'" > /dev/null
}
expect "F sans 006 : profil « reactive » refusé avant (contrainte de 002)" not avail_ok reactive
expect "F sans 006 : profil « flexible » accepté avant" avail_ok flexible
expect "F sans 006 : rôle « referent » refusé avant (contrainte de 005)" not role_ok referent
expect "F sans 006 : rôle « admin » accepté avant" role_ok admin
# Donnée représentative posée AVANT la séquence : un compte, quatre drapeaux (un « false »
# indiscernable d'avant le chantier, un « true » voulu, un à profil, un seulement étiqueté), une
# carte étiquetée SANS ligne de drapeaux, et un deck dont l'aperçu est en cache.
F6_OWNER=$(db_query "insert into users (email, display_name, password_hash) values ('annot-f6@example.invalid', 'Compte F6', 'scrypt:131072:8:1:c2VsCg==:a2V5Cg==') returning id")
F6_CAT=$(db_query "insert into nonengine_categories (owner_id, name) values ('$F6_OWNER', 'Handtrap') returning id")
db_query "
  insert into card_flags (owner_id, card_id, is_hopt) values ('$F6_OWNER', 990000001, false);
  insert into card_flags (owner_id, card_id, is_hopt) values ('$F6_OWNER', 990000002, true);
  insert into card_flags (owner_id, card_id, is_hopt, availability) values ('$F6_OWNER', 990000003, false, 'flexible');
  insert into card_flags (owner_id, card_id, is_hopt) values ('$F6_OWNER', 990000005, false);
  insert into card_categories (card_id, category_id) values (990000004, '$F6_CAT');
  insert into card_categories (card_id, category_id) values (990000005, '$F6_CAT');
  insert into decks (owner_id, name, summary) values ('$F6_OWNER', 'Deck F6', '{\"mainSize\": 40, \"engineVersion\": \"f6\"}'::jsonb);
" > /dev/null
CARD_FLAGS_F6=$(db_query 'select count(*) from card_flags')
FALSE_F6=$(db_query 'select count(*) from card_flags where is_hopt = false')
USERS_F6=$(db_query 'select count(*) from users')
DECKS_F6=$(db_query 'select count(*) from decks')
expect "F sans 006 : fixture posée ($CARD_FLAGS_F6 drapeaux dont $FALSE_F6 à « false », $USERS_F6 compte(s), $DECKS_F6 deck(s), 1 aperçu en cache)" test "$FALSE_F6" -ge 3 -a "$(db_query 'select count(*) from decks where summary is not null')" = 1
CASE_OUT="$OUT/case-F-sans-006"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F sans 006 : code 0 sans question" test "$RC" = 0
expect "F sans 006 : 006 rejouée par la branche post-003" grep_file 'rejeu par stdin : db/migrations/006-annotation-defaults.sql' "$CASE_OUT/journal.txt"
expect "F sans 006 : relevé avant migration des données dans le journal de séquence" grep_file 'relevé avant migration des données' "$CASE_OUT/journal.txt"
expect "F sans 006 : 001 à 006 journalisées, marqueur de données « /c » compris" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
expect "F sans 006 : profil « reactive » accepté après" avail_ok reactive
expect "F sans 006 : profil inconnu toujours refusé" not avail_ok bogus
expect "F sans 006 : rôle « referent » accepté après" role_ok referent
expect "F sans 006 : rôle inconnu toujours refusé" not role_ok bogus
expect "F sans 006 : une seule contrainte CHECK sur la seule colonne availability" test "$(db_query "select count(*) from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_attribute att on att.attrelid = rel.oid and att.attname = 'availability' where rel.relname = 'card_flags' and con.contype = 'c' and con.conkey::smallint[] = array[att.attnum]")" = 1
expect "F sans 006 : contrainte de deux colonnes de 002 conservée" test "$(db_query "select count(*) from pg_constraint where conname = 'card_flags_group_requires_profile'")" = 1
expect "F sans 006 : card_flags à effectif identique ($CARD_FLAGS_F6 ligne(s)), 006 n'en crée aucune" test "$(db_query 'select count(*) from card_flags')" = "$CARD_FLAGS_F6"
expect "F sans 006 : les $FALSE_F6 « is_hopt = false » sont passés à NULL (Q2)" test "$(db_query 'select count(*) from card_flags where is_hopt = false')" = 0 -a "$(db_query 'select count(*) from card_flags where is_hopt is null')" = "$FALSE_F6"
expect "F sans 006 : le choix « is_hopt = true » est conservé" test "$(db_query "select is_hopt from card_flags where owner_id = '$F6_OWNER' and card_id = 990000002")" = t
expect "F sans 006 : nonengine_choice posé sur la ligne à profil" test "$(db_query "select nonengine_choice from card_flags where owner_id = '$F6_OWNER' and card_id = 990000003")" = t
expect "F sans 006 : carte seulement étiquetée non matérialisée (nonengine_choice faux)" test "$(db_query "select nonengine_choice from card_flags where owner_id = '$F6_OWNER' and card_id = 990000005")" = f
expect "F sans 006 : carte étiquetée sans drapeaux : aucune ligne card_flags créée" test "$(db_query 'select count(*) from card_flags where card_id = 990000004')" = 0
expect "F sans 006 : les deux affectations card_categories conservées" test "$(db_query "select count(*) from card_categories where category_id = '$F6_CAT'")" = 2
expect "F sans 006 : nonengine_choice posé exactement sur les lignes à profil" test "$(db_query 'select count(*) from card_flags where (availability is not null) <> nonengine_choice')" = 0
expect "F sans 006 : un groupe « Mulcharmy » (2 par tour, is_builtin) par compte" test "$(db_query "select count(*) from nonengine_groups where name = 'Mulcharmy' and is_builtin and cap_per_turn = 2")" = "$USERS_F6" -a "$(db_query "select count(*) from users u where not exists (select 1 from nonengine_groups g where g.owner_id = u.id and g.name = 'Mulcharmy' and g.is_builtin)")" = 0
expect "F sans 006 : tous les aperçus decks.summary à NULL, aucun deck perdu" test "$(db_query 'select count(*) from decks where summary is not null')" = 0 -a "$(db_query 'select count(*) from decks')" = "$DECKS_F6"
expect "F sans 006 : card_references et son journal présents" test "$(db_query "select count(*) from pg_tables where schemaname = 'public' and tablename in ('card_references', 'card_reference_log')")" = 2
f6log() { ! db_query 'delete from card_reference_log' > /dev/null 2>&1; }
expect "F sans 006 : le journal des références est en ajout seul (delete refusé même au propriétaire)" f6log
expect "F sans 006 : contrôle nominatif de 006 dans check-migration.txt" grep_file '^OK\|006 appliquée par cette séquence : plus aucune ligne card_flags' "$CASE_OUT/check-migration.txt"
expect "F sans 006 : contrôle nominatif du groupe fourni de base dans check-migration.txt" grep_file '^OK\|006 appliquée par cette séquence : chacun des .* a son groupe « Mulcharmy » marqué is_builtin' "$CASE_OUT/check-migration.txt"
expect "F sans 006 : aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"
# Rejeu : le second marqueur « /c » garde la migration des données. Preuve forte : un CHOIX
# explicite « is_hopt = false » et un aperçu recalculés APRÈS 006 doivent survivre au rejeu — sans
# ce marqueur, `update card_flags set is_hopt = null` et `update decks set summary = null` les
# effaceraient à chaque déploiement.
db_query "
  update card_flags set is_hopt = false where owner_id = '$F6_OWNER' and card_id = 990000002;
  update decks set summary = '{\"mainSize\": 40, \"engineVersion\": \"apres-006\"}'::jsonb where owner_id = '$F6_OWNER';
" > /dev/null
FP_F6=$(db_fingerprint | fingerprint_global)
CASE_OUT="$OUT/case-F-rejeu-006"; mkdir -p "$CASE_OUT"; HOOKS="$CASE_OUT/hooks.txt"; : > "$HOOKS"
run_seq interactive
expect "F rejeu après 006 : code 0, base identique" test "$RC" = 0 -a "$(db_fingerprint | fingerprint_global)" = "$FP_F6"
expect "F rejeu après 006 : le choix explicite « is_hopt = false » a survécu" test "$(db_query 'select count(*) from card_flags where is_hopt = false')" = 1
expect "F rejeu après 006 : l'aperçu recalculé après 006 a survécu" test "$(db_query 'select count(*) from decks where summary is not null')" = 1
expect "F rejeu après 006 : aucun groupe « Mulcharmy » en double" test "$(db_query "select count(*) from nonengine_groups where name = 'Mulcharmy'")" = "$USERS_F6"
expect "F rejeu après 006 : journal de séquence — aucun relevé, contrôle strict" grep_file 'données déjà migrées \(marqueur « /c » journalisé\)' "$CASE_OUT/journal.txt"
expect "F rejeu après 006 : contrôle strict nominatif dans check-migration.txt" grep_file '^OK\|006 : marqueur de données « /c » déjà journalisé, aucun rejeu ne retouche' "$CASE_OUT/check-migration.txt"
expect "F rejeu après 006 : profil « reactive » toujours accepté" avail_ok reactive
expect "F rejeu après 006 : aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"

# ─── G. base vide (« départ à vide », 8C) : aucune question, 003 journalisée, contrôles OK ───
begin_case G empty
expect "G base vide au départ (aucune table dans public)" test "$(db_query "select count(*) from pg_tables where schemaname = 'public'")" = 0
run_seq interactive
expect "G code 0 sans question (aucun terminal : une question aurait rendu 3)" test "$RC" = 0
expect "G 001 à 006 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
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
# les scripts copiés dans docker-entrypoint-initdb.d comme en production (schéma, 001 à 006) ;
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
         db/migrations/004-side-plans.sql:04-side-plans.sql db/migrations/005-backoffice.sql:05-backoffice.sql \
         db/migrations/006-annotation-defaults.sql:06-annotation-defaults.sql; do
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
expect "I 001 à 006 journalisées" test "$(journal_now)" = '001-deck-configuration,002-profiles-and-conditions,003-purge-legacy,004-side-plans,005-backoffice,006-annotation-defaults,006-annotation-defaults/c'
expect "I app démarrée (stop, start-new)" hooks_are "stop start-new"
expect "I aucun « shutting down » dans les sorties de la séquence" not bash -c "grep -rq 'shutting down' '$CASE_OUT' --exclude-dir=container-logs"
expect "I aucun KO dans check-migration.txt" not grep_file '^KO\|' "$CASE_OUT/check-migration.txt"

# ─── J. ligne de commande du rôle admin (back-office, docs/backoffice.md T9) sur la base de I ───
CASE_OUT="$OUT/case-J"; mkdir -p "$CASE_OUT"
db_query "insert into users (email, display_name, password_hash) values ('admin-j@example.invalid', 'Compte J', 'scrypt:131072:8:1:c2VsCg==:a2V5Cg==')" > /dev/null
role_of() { db_query "select role from users where email = 'admin-j@example.invalid'"; }
audit_n() { db_query 'select count(*) from backoffice_audit'; }
run_role() { local n; n=$(printf '%s' "${2:-}" | tr 'A-Z' 'a-z' | tr -cd 'a-z'); RC=0; bash ./backoffice-role.sh "$@" > "$CASE_OUT/role-$1${n:+-}$n.log" 2>&1 || RC=$?; }
AUDIT_J0=$(audit_n)
run_role grant admin-j@example.invalid
j1() { [ "$RC" = 0 ] && grep -q 'SIMULATION TERMINÉE' "$CASE_OUT/role-grant-adminjexampleinvalid.log" && [ "$(role_of)" = user ] && [ "$(audit_n)" = "$AUDIT_J0" ]; }
expect "J simulation : code 0, « SIMULATION TERMINÉE », rôle inchangé, journal inchangé" j1
run_role grant ADMIN-J@example.invalid --apply --actor test-j
j2() { [ "$RC" = 0 ] && grep -q 'APPLIQUÉ : admin-j@example.invalid est désormais « admin »' "$CASE_OUT/role-grant-adminjexampleinvalid.log" && [ "$(role_of)" = admin ]; }
expect "J --apply : code 0, « APPLIQUÉ », rôle admin (email insensible à la casse)" j2
expect "J --apply : une ligne de journal role.grant, source cli, acteur test-j" test "$(db_query "select count(*) from backoffice_audit where action = 'role.grant' and source = 'cli' and actor_email = 'test-j' and detail->>'email' = 'admin-j@example.invalid' and detail->>'to' = 'admin'")" = 1
run_role grant admin-j@example.invalid --apply
j3() { [ "$RC" = 0 ] && grep -q 'RIEN À APPLIQUER' "$CASE_OUT/role-grant-adminjexampleinvalid.log" && [ "$(audit_n)" = "$((AUDIT_J0 + 1))" ]; }
expect "J rejeu --apply : « RIEN À APPLIQUER », journal inchangé" j3
run_role list
j4() { [ "$RC" = 0 ] && grep -q '^admin | admin-j@example.invalid' "$CASE_OUT/role-list.log" && grep -q '^compte | 1 compte(s) admin' "$CASE_OUT/role-list.log"; }
expect "J list : le compte apparaît, 1 admin" j4
run_role revoke admin-j@example.invalid --apply
j5() { [ "$RC" = 0 ] && [ "$(role_of)" = user ] && [ "$(db_query "select count(*) from backoffice_audit where action = 'role.revoke' and source = 'cli'")" = 1 ]; }
expect "J revoke --apply : rôle user, ligne role.revoke" j5
run_role grant inconnu@example.invalid --apply
j6() { [ "$RC" = 1 ] && grep -q 'aucun compte pour « inconnu@example.invalid »' "$CASE_OUT/role-grant-inconnuexampleinvalid.log" && [ "$(audit_n)" = "$((AUDIT_J0 + 2))" ]; }
expect "J compte inconnu : code 1, refus nominatif, journal inchangé" j6
j7() { ! db_query 'delete from backoffice_audit' > /dev/null 2>&1; }
expect "J le journal refuse la suppression, même au propriétaire" j7
# Rôle « referent » (006, hiérarchie admin > referent > user) : même chemin, même journal.
run_role grant admin-j@example.invalid --role referent --apply --actor test-j
j8() { [ "$RC" = 0 ] && grep -q 'APPLIQUÉ : admin-j@example.invalid est désormais « referent »' "$CASE_OUT/role-grant-adminjexampleinvalid.log" && [ "$(role_of)" = referent ]; }
expect "J --role referent --apply : code 0, « APPLIQUÉ », rôle referent" j8
expect "J --role referent : une ligne de journal role.grant vers « referent »" test "$(db_query "select count(*) from backoffice_audit where action = 'role.grant' and source = 'cli' and detail->>'to' = 'referent'")" = 1
run_role list
j9() { [ "$RC" = 0 ] && grep -q '^referent | admin-j@example.invalid' "$CASE_OUT/role-list.log" && grep -q '^compte | 0 compte(s) admin et 1 référent(s)' "$CASE_OUT/role-list.log"; }
expect "J list : le compte apparaît en référent, 0 admin et 1 référent" j9
run_role grant admin-j@example.invalid --role bogus --apply
expect "J --role inconnue : code 2 (usage), rien écrit" test "$RC" = 2 -a "$(role_of)" = referent
run_role revoke admin-j@example.invalid --apply
expect "J revoke après referent : rôle user" test "$RC" = 0 -a "$(role_of)" = user
expect "J rôle testhand_backoffice : card_references lisible, non modifiable" test "$(db_query "select has_table_privilege('testhand_backoffice', 'card_references', 'select') and has_table_privilege('testhand_backoffice', 'card_reference_log', 'select') and not has_table_privilege('testhand_backoffice', 'card_references', 'insert, update, delete')")" = t
expect "J rôle testhand_backoffice : aucun privilège sur deck_cards, decks.name illisible, users non modifiable" test "$(db_query "select has_table_privilege('testhand_backoffice', 'deck_cards', 'select') or has_column_privilege('testhand_backoffice', 'decks', 'name', 'select') or has_table_privilege('testhand_backoffice', 'users', 'update')")" = f

echo
if [ "$FAILS" -gt 0 ]; then echo "ÉCHEC : $FAILS garde(s) en échec — journaux dans $OUT"; exit 1; fi
echo "OK : toutes les gardes passent (cas A–J) — journaux dans $OUT"
