#!/usr/bin/env bash
# deploy/lib.sh — bibliothèque commune de deploy.sh, rehearsal.sh, backup.sh, restore.sh et des
# tests de l'étape 8B. À sourcer depuis deploy/ (`cd "$(dirname "$0")"` puis `. ./lib.sh`).
# Elle ne fait rien au chargement : elle définit des fonctions et quelques variables.
#
# Accès à la base — jamais par un port hôte, la base de dev (5433) est donc hors d'atteinte :
#   • par défaut, le service `db` de la pile Compose de production (--env-file .env.prod,
#     docker-compose.prod.yml), comme backup.sh l'a toujours fait ;
#   • TESTHAND_DB_CONTAINER=<nom> (répétition, tests) : un conteneur jetable, par `docker exec`.
#   TESTHAND_DB_USER / TESTHAND_DB_NAME (défaut ygo / ygo) ; BACKUP_VERIFY_DB (défaut ygo_verify) ;
#   RESTORE_PREVIOUS_DB (défaut ygo_previous).
#
# Séquence de migration partagée (point 5 validé) — run_migration_sequence <dossier> <acceptation> :
#   arrêt de l'app → empreinte initiale → sauvegarde pré-migration vérifiée (obligatoire, keep/) →
#   inventaire (effectifs, journal, résumés, modèle historique) → schéma → 001 → 002 → empreinte →
#   003 en simulation (marqueur « SIMULATION TERMINÉE » ET code 0 exigés, rapport en fichier) →
#   acceptation (« OUI » au terminal, ou l'empreinte fournie, ou `auto` en répétition) → 003 réelle
#   (marqueur « PURGE APPLIQUÉE ») → contrôles après migration (check-migration.sql + empreintes)
#   → app démarrée.
#   Codes : 0 ok ; 1 échec avant 003 (ancienne app relancée, base intacte) ou 003 en échec (app
#   relancée sans 003) ; 2 contrôle après migration en échec (app laissée ARRÊTÉE, commande de
#   restauration affichée) ; 3 rapport refusé (app relancée sans 003, Q8).
#   Crochets à définir par l'appelant : hook_stop_app, hook_start_app (nouvelle app),
#   hook_start_old_app (conteneur précédent), hook_app_left_stopped <commande de restauration>,
#   hook_backup <dossier> (lance backup.sh --pre-migration et pose PRE_MIGRATION_ARCHIVE ;
#   backup_pre_migration ci-dessous convient).

LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$LIB_DIR/.." && pwd)
DB_USER=${TESTHAND_DB_USER:-ygo}
DB_NAME=${TESTHAND_DB_NAME:-ygo}
VERIFY_DB=${BACKUP_VERIFY_DB:-ygo_verify}
STAGING_DB=${RESTORE_STAGING_DB:-ygo_restore}
PREVIOUS_DB=${RESTORE_PREVIOUS_DB:-ygo_previous}
# Tables qui doivent rester identiques de bout en bout (avant schéma → après 003) et objets
# que 003 est seule à modifier (comparaison après 002 → après 003).
KEPT_ACROSS_SEQUENCE='cards catalog_version users user_identities sessions deck_cards deck_starters card_categories'
TOUCHED_BY_003='app_migrations card_flags nonengine_categories combo_pairs deck_pair_exclusions deck_start_requirements deck_requirements'
# Git Bash (MSYS) réécrit les chemins absolus passés à Docker (« mount path must be absolute ») :
# conversion désactivée pour tout le script ; les chemins destinés à Node passent alors par
# host_path (cygpath), Node n'étant pas MSYS.
if [ -n "${MSYSTEM:-}" ]; then export MSYS_NO_PATHCONV=1; fi
host_path() { if [ -n "${MSYSTEM:-}" ]; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }

say() { printf '==> %s\n' "$*"; }
warn() { printf 'ATTENTION : %s\n' "$*" >&2; }
die() { printf 'ERREUR : %s\n' "$1" >&2; exit "${2:-1}"; }
stamp() { date -u +%Y%m%d-%H%M%S; }
# Journal de séquence : à l'écran, et dans $SEQ_JOURNAL quand une séquence est en cours.
seq_log() {
  local line; line="$(date -u -Is) $*"
  if [ -n "${SEQ_JOURNAL:-}" ]; then printf '%s\n' "$line" | tee -a "$SEQ_JOURNAL"; else printf '%s\n' "$line"; fi
}

# ─── Accès à la base ───
db_exec() {  # db_exec <commande…> : dans le conteneur db, stdin transmis, sortie UTF-8
  if [ -n "${TESTHAND_DB_CONTAINER:-}" ]; then
    docker exec -i -e PGCLIENTENCODING=UTF8 "$TESTHAND_DB_CONTAINER" "$@"
  else
    docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T -e PGCLIENTENCODING=UTF8 db "$@"
  fi
}
db_psql() { db_exec psql -U "$DB_USER" -d "${1:-$DB_NAME}" -v ON_ERROR_STOP=1 -q -c 'set client_min_messages = warning' -f -; }  # SQL sur stdin, sans les NOTICE « already exists »
db_query() { db_exec psql -U "$DB_USER" -d "${2:-$DB_NAME}" -v ON_ERROR_STOP=1 -qAt -c 'set client_min_messages = warning' -c "$1"; }   # db_query <sql> [base]
db_fingerprint() { db_exec psql -U "$DB_USER" -d "${1:-$DB_NAME}" -v ON_ERROR_STOP=1 -qAt -f - < "$LIB_DIR/fingerprint.sql"; }
db_ready() {  # deux `select 1` consécutifs : le serveur redémarre une fois pendant l'initialisation
  local i ok=0
  for i in $(seq 1 90); do
    if db_query 'select 1' >/dev/null 2>&1; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" -ge 2 ] && return 0
    sleep 1
  done
  return 1
}

# ─── Empreintes ───
fingerprint_global() { sed -n 's/^empreinte|//p' "${1:--}"; }  # fichier, ou stdin sans argument
# fingerprint_diff <avant> <après> [--only "t1 t2"] [--except "t1 t2"] : tables dont l'empreinte
# (effectif + md5) diffère, ou présentes d'un seul côté ; rien = identiques.
fingerprint_diff() {
  local a=$1 b=$2 mode=${3:-} list=${4:-}
  awk -F'|' -v mode="$mode" -v list="$list" '
    BEGIN { n = split(list, arr, " "); for (i = 1; i <= n; i++) if (arr[i] != "") sel[arr[i]] = 1 }
    $1 == "empreinte" { next }
    mode == "--only" && !($1 in sel) { next }
    mode == "--except" && ($1 in sel) { next }
    NR == FNR { before[$1] = $2 "|" $3; next }
    { if (!($1 in before)) print $1 " (absente avant)"; else { if (before[$1] != $2 "|" $3) print $1; delete before[$1] } }
    END { for (t in before) print t " (absente après)" }' "$a" "$b" | sort
}

# ─── Bases de travail (D3) : $VERIFY_DB pour vérifier une sauvegarde, $STAGING_DB pour préparer
#     une restauration, $PREVIOUS_DB pour l'état remplacé. Jamais la base servie ni une base
#     système ; toute commande de maintenance se connecte à `postgres`. ───
scratch_db_guard() {  # <nom> : refuse la base servie, la base précédente et les bases système
  case "$1" in
    ''|"$DB_NAME"|"$PREVIOUS_DB"|postgres|template0|template1) VERIFY_ERROR="base de travail invalide : « $1 »"; return 1;;
  esac
  case "$PREVIOUS_DB" in
    ''|"$DB_NAME"|postgres|template0|template1) VERIFY_ERROR="base précédente invalide : « $PREVIOUS_DB »"; return 1;;
  esac
  return 0
}
drop_scratch_db() { scratch_db_guard "$1" || return 0; db_exec dropdb -U "$DB_USER" --if-exists "$1" >/dev/null 2>&1 || true; }
drop_verify_db() { drop_scratch_db "$VERIFY_DB"; }
restore_into_scratch_db() {  # <archive> <base> : recrée la base de travail et y restaure l'archive (gunzip | psql)
  local archive=$1 db=$2 err
  VERIFY_ERROR=
  scratch_db_guard "$db" || return 1
  err=$(mktemp)
  if ! db_exec dropdb -U "$DB_USER" --if-exists "$db" >/dev/null 2> "$err"; then
    VERIFY_ERROR="suppression de $db impossible : $(tail -n 2 "$err" | tr '\n' ' ')"; rm -f "$err"; return 1
  fi
  if ! db_exec createdb -U "$DB_USER" -O "$DB_USER" "$db" >/dev/null 2> "$err"; then
    VERIFY_ERROR="création de $db impossible : $(tail -n 2 "$err" | tr '\n' ' ')"; rm -f "$err"; return 1
  fi
  if ! gunzip -c "$archive" | db_exec psql -U "$DB_USER" -d "$db" -v ON_ERROR_STOP=1 -q -f - >/dev/null 2> "$err"; then
    VERIFY_ERROR="restauration dans $db en échec : $(tail -n 2 "$err" | tr '\n' ' ')"; rm -f "$err"; return 1
  fi
  rm -f "$err"
  return 0
}
restore_into_verify_db() { restore_into_scratch_db "$1" "$VERIFY_DB"; }
# verify_backup <archive> <empreinte vivante avant l'export, ou ''> <daily|keep> : restaure dans
# $VERIFY_DB, écrit <archive>.fingerprint, compare à la base vivante. En cron (daily, app en
# marche) une table qui a bougé pendant l'export est listée « non vérifiable » (VERIFY_NOTE) ;
# en keep (pré-migration, app arrêtée) c'est un échec. Pose VERIFY_ERROR en cas d'échec et
# retire alors le .fingerprint : une archive non vérifiée n'en porte pas.
verify_backup() {
  local archive=$1 before=$2 mode=$3 after moved diff
  VERIFY_ERROR=; VERIFY_NOTE=
  if ! restore_into_verify_db "$archive"; then drop_verify_db; return 1; fi
  if ! db_fingerprint "$VERIFY_DB" > "$archive.fingerprint"; then
    VERIFY_ERROR="empreinte de $VERIFY_DB impossible"; rm -f "$archive.fingerprint"; drop_verify_db; return 1
  fi
  drop_verify_db
  [ -n "$before" ] || return 0
  after=$(mktemp)
  if ! db_fingerprint "$DB_NAME" > "$after"; then
    VERIFY_ERROR="empreinte de $DB_NAME après l'export impossible"; rm -f "$after" "$archive.fingerprint"; return 1
  fi
  moved=$(fingerprint_diff "$before" "$after" | tr '\n' ' '); moved=${moved% }
  rm -f "$after"
  if [ -n "$moved" ] && [ "$mode" = keep ]; then
    VERIFY_ERROR="la base a bougé pendant la sauvegarde (app arrêtée attendue) : $moved"; rm -f "$archive.fingerprint"; return 1
  fi
  diff=$(fingerprint_diff "$before" "$archive.fingerprint" --except "$moved" | tr '\n' ' '); diff=${diff% }
  if [ -n "$diff" ]; then
    VERIFY_ERROR="empreinte de l'archive différente de la base pour : $diff"; rm -f "$archive.fingerprint"; return 1
  fi
  [ -n "$moved" ] && VERIFY_NOTE=" (tables modifiées pendant la sauvegarde, non vérifiables : $moved)"
  return 0
}
# check_archive_files <archive> : .sha256 présent et exact ; empreinte enregistrée présente sauf
# --without-fingerprint (variable WITHOUT_FINGERPRINT=1). Pose CHECK_ERROR.
check_archive_files() {
  local archive=$1 dir base
  CHECK_ERROR=
  [ -s "$archive" ] || { CHECK_ERROR="archive introuvable : $archive"; return 1; }
  [ -s "$archive.sha256" ] || { CHECK_ERROR="refus : « $archive.sha256 » absent (archive antérieure à 8B ou incomplète) — aucune restauration sans somme de contrôle"; return 1; }
  dir=$(cd "$(dirname "$archive")" && pwd); base=$(basename "$archive")
  if ! (cd "$dir" && sha256sum -c --status "$base.sha256"); then CHECK_ERROR="refus : somme SHA-256 différente de « $base.sha256 » (archive altérée ou tronquée)"; return 1; fi
  if [ ! -s "$archive.fingerprint" ] && [ "${WITHOUT_FINGERPRINT:-0}" != 1 ]; then
    CHECK_ERROR="refus : « $archive.fingerprint » absent — archive jamais vérifiée (antérieure à 8B ou vérification en échec) ; --without-fingerprint pour passer outre en connaissance de cause"; return 1
  fi
  return 0
}

# ─── Inventaire et migrations ───
db_inventory() {  # <préfixe> → <préfixe>-counts.txt, -journal.txt, -summaries.json, -legacy.json
  local prefix=$1 tmp k v
  tmp=$(mktemp)
  if ! db_exec psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -F "$(printf '\037')" -f - < "$LIB_DIR/inventory.sql" > "$tmp"; then rm -f "$tmp"; return 1; fi
  : > "$prefix-counts.txt"; : > "$prefix-journal.txt"; printf '[]\n' > "$prefix-summaries.json"; printf '{"pairs": [], "exclusions": [], "pair_requirements": []}\n' > "$prefix-legacy.json"
  while IFS=$'\037' read -r k v; do
    case $k in
      count:*) printf '%s %s\n' "${k#count:}" "$v" >> "$prefix-counts.txt";;
      journal) printf '%s\n' "$v" > "$prefix-journal.txt";;
      summaries) printf '%s\n' "$v" > "$prefix-summaries.json";;
      legacy) printf '%s\n' "$v" > "$prefix-legacy.json";;
    esac
  done < "$tmp"
  rm -f "$tmp"
  seq_log "inventaire : $(wc -l < "$prefix-counts.txt" | tr -d ' ') table(s), journal « $(cat "$prefix-journal.txt") », $(grep -o '"summary": {' "$prefix-summaries.json" | wc -l | tr -d ' ') résumé(s) non nul(s), modèle historique : $(grep -o '"card_a_id"' "$prefix-legacy.json" | wc -l | tr -d ' ') paire(s) globale(s), $(grep -o '"pair_id"' "$prefix-legacy.json" | wc -l | tr -d ' ') exclusion(s) ou prérequis source paire"
  return 0
}

run_003() {  # <rapport> <GUC de session…> : joue 003 (stdin), rapport « section | ligne », erreurs dans <rapport>.err
  local report=$1; shift
  local args=(-c 'set client_min_messages = warning') g
  for g in "$@"; do args+=(-c "$g"); done
  db_exec psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -F ' | ' "${args[@]}" -f - \
    < "$ROOT_DIR/db/migrations/003-purge-legacy.sql" > "$report" 2> "$report.err"
}
# simulate_003 <rapport> : pose SIM_STATUS (simulated | already | failed), SIM_FP, SIM_PURGE,
# SIM_SUMMARY, SIM_MESSAGE. Succès = code 0 ET ligne « statut | SIMULATION TERMINÉE » (D2) ;
# un code 0 sans ce marqueur est un échec.
simulate_003() {
  local report=$1 rc=0
  SIM_STATUS=failed; SIM_FP=; SIM_PURGE=; SIM_SUMMARY=; SIM_MESSAGE=
  run_003 "$report" "set testhand.purge_mode = 'simulate'" || rc=$?
  if [ "$rc" -ne 0 ]; then SIM_MESSAGE="psql code $rc : $(tail -n 3 "$report.err" | tr '\n' ' ')"; return 0; fi
  if grep -q '^statut | SIMULATION TERMINÉE' "$report"; then
    SIM_FP=$(sed -n 's/^empreinte | empreinte du rapport : \([0-9a-f]\{32\}\)$/\1/p' "$report" | head -n 1)
    SIM_SUMMARY=$(sed -n 's/^résumé | //p' "$report" | head -n 1)
    SIM_PURGE=$(printf '%s' "$SIM_SUMMARY" | sed -n 's/^à purger : \([0-9][0-9]*\) ligne.*/\1/p')
    if [ -z "$SIM_FP" ] || [ -z "$SIM_PURGE" ]; then SIM_MESSAGE="rapport de simulation incomplet (empreinte ou résumé absent) : $report"; return 0; fi
    SIM_STATUS=simulated
  elif grep -q '^statut | 003-purge-legacy déjà appliquée' "$report"; then
    SIM_STATUS=already
  else
    SIM_MESSAGE="marqueur « SIMULATION TERMINÉE » absent malgré le code 0 (rapport : $report)"
  fi
  return 0
}
# apply_003 <empreinte acceptée, vide si rien à purger> <rapport> : pose APPLY_STATUS
# (applied | already | failed) et APPLY_MESSAGE. Succès = code 0 ET « statut | PURGE APPLIQUÉE ».
apply_003() {
  local fp=$1 report=$2 rc=0
  APPLY_STATUS=failed; APPLY_MESSAGE=
  if [ -n "$fp" ]; then run_003 "$report" "set testhand.purge_accept = '$fp'" || rc=$?; else run_003 "$report" || rc=$?; fi
  if [ "$rc" -ne 0 ]; then APPLY_MESSAGE="psql code $rc : $(tail -n 3 "$report.err" | tr '\n' ' ')"; return 0; fi
  if grep -q '^statut | PURGE APPLIQUÉE' "$report"; then
    APPLY_STATUS=applied; APPLY_MESSAGE=$(sed -n 's/^statut | //p' "$report" | head -n 1)
  elif grep -q '^statut | 003-purge-legacy déjà appliquée' "$report"; then
    APPLY_STATUS=already
  else
    APPLY_MESSAGE="marqueur « PURGE APPLIQUÉE » absent malgré le code 0 (rapport : $report)"
  fi
  return 0
}

show_report_summary() {  # <rapport> : extrait lisible (le fichier complet reste la référence)
  local r=$1 s n
  echo "──── Rapport de simulation de 003 — extrait ; fichier complet : $r ────"
  grep -E '^(compte|résumé|empreinte|statut) \| ' "$r" || true
  for s in P1 P2 P3 P4 P5 P6; do
    n=$(grep -c "^$s | " "$r" || true)
    if [ "${n:-0}" -gt 0 ]; then echo "$s : $n ligne(s) — premières lignes :"; grep "^$s | " "$r" | head -n 3; fi
  done
  echo "──────────────────────────────────────────────────────────────────────"
}
# accept_report <interactive | auto | empreinte> <rapport> : 0 = accepté. En interactif, « OUI »
# lu sur /dev/tty ; EXPECTED_FINGERPRINT (facultatif) est comparée et affichée avant la question.
accept_report() {
  local mode=$1 report=$2 answer
  case $mode in
    auto) seq_log "acceptation automatique (répétition) de l'empreinte $SIM_FP"; return 0;;
    interactive)
      show_report_summary "$report"
      if [ -n "${EXPECTED_FINGERPRINT:-}" ]; then
        if [ "$EXPECTED_FINGERPRINT" = "$SIM_FP" ]; then echo "Empreinte attendue $EXPECTED_FINGERPRINT : IDENTIQUE au rapport."
        else echo "Empreinte attendue $EXPECTED_FINGERPRINT : DIFFÉRENTE du rapport ($SIM_FP) — la base a bougé depuis le dump : relire le rapport complet avant d'accepter."; fi
      fi
      echo "POINT DE NON-RETOUR : $SIM_PURGE ligne(s) seront supprimées. Relire le rapport complet, puis taper OUI (en majuscules) pour appliquer ; toute autre réponse démarre l'app sans 003."
      if [ ! -r /dev/tty ]; then seq_log "aucun terminal : rapport considéré refusé (utiliser --accept <empreinte>)"; return 1; fi
      printf 'Appliquer la purge %s ? ' "$SIM_FP"
      read -r answer < /dev/tty || answer=
      if [ "$answer" = OUI ]; then seq_log "rapport accepté au terminal (OUI), empreinte $SIM_FP"; return 0; fi
      seq_log "réponse « $answer » : rapport refusé"; return 1;;
    *)
      if [ "$mode" = "$SIM_FP" ]; then seq_log "empreinte fournie identique au rapport : accepté ($SIM_FP)"; return 0; fi
      seq_log "empreinte fournie ($mode) différente du rapport ($SIM_FP) : refusé"; return 1;;
  esac
}

# check_after_migration <dossier> → <dossier>/check-migration.txt (lignes OK| / KO|) ; 0 si tout OK.
check_after_migration() {
  local out=$1 ko=0 d
  if ! db_exec psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -f - < "$LIB_DIR/check-migration.sql" > "$out/check-migration.txt" 2> "$out/check-migration.err"; then
    echo "KO|check-migration.sql en échec : $(tail -n 2 "$out/check-migration.err" | tr '\n' ' ')" >> "$out/check-migration.txt"
  fi
  if ! db_fingerprint "$DB_NAME" > "$out/fingerprint-3.txt"; then
    echo 'KO|empreinte après migration impossible' >> "$out/check-migration.txt"
  else
    d=$(fingerprint_diff "$out/fingerprint-0.txt" "$out/fingerprint-3.txt" --only "$KEPT_ACROSS_SEQUENCE" | tr '\n' ' '); d=${d% }
    if [ -n "$d" ]; then echo "KO|tables qui devaient rester intactes de bout en bout et qui ont changé : $d" >> "$out/check-migration.txt"
    else echo "OK|tables intactes de bout en bout (effectif et contenu) : $KEPT_ACROSS_SEQUENCE" >> "$out/check-migration.txt"; fi
    if [ -s "$out/fingerprint-2.txt" ]; then
      d=$(fingerprint_diff "$out/fingerprint-2.txt" "$out/fingerprint-3.txt" --except "$TOUCHED_BY_003" | tr '\n' ' '); d=${d% }
      if [ -n "$d" ]; then echo "KO|003 a modifié des tables hors de son périmètre : $d" >> "$out/check-migration.txt"
      else echo "OK|003 n'a touché que ses propres objets (décks, cartes, starters, paires, conditions, drapeaux par deck, profils intacts)" >> "$out/check-migration.txt"; fi
    fi
  fi
  if grep -q '^KO|' "$out/check-migration.txt"; then ko=1; fi
  sed 's/^/    /' "$out/check-migration.txt"
  return $ko
}

# backup_pre_migration <dossier> : backup.sh --pre-migration, journal dans <dossier>/backup.log,
# pose PRE_MIGRATION_ARCHIVE (chemin absolu). Convient comme hook_backup.
backup_pre_migration() {
  local out=$1 dir=${BACKUP_DIR:-/var/backups/ygo-proba} name
  PRE_MIGRATION_ARCHIVE=
  if ! bash "$LIB_DIR/backup.sh" --pre-migration > "$out/backup.log" 2>&1; then sed 's/^/    /' "$out/backup.log"; return 1; fi
  sed 's/^/    /' "$out/backup.log"
  name=$(sed -n 's/.* sauvegarde vérifiée: \([^ ]*\) .*/\1/p' "$out/backup.log" | tail -n 1)
  [ -n "$name" ] || return 1
  PRE_MIGRATION_ARCHIVE="$dir/$name"
  return 0
}

seq_abort_before() {  # <message> : échec avant toute modification irréversible → ancienne app relancée
  seq_log "ÉCHEC : $1"
  seq_log "rien de la migration 003 n'est appliqué ; ancienne app relancée"
  hook_start_old_app || true
}

run_migration_sequence() {  # <dossier de sortie> <interactive | auto | empreinte>
  local out=$1 accept=$2 f d
  mkdir -p "$out"
  SEQ_JOURNAL="$out/journal.txt"
  seq_log "séquence de migration — dossier : $out — acceptation : $([ "$accept" = interactive ] && echo 'OUI au terminal' || echo "$accept")"

  seq_log "arrêt de l'app (aucune écriture pendant la transition)"
  if ! hook_stop_app; then seq_abort_before "arrêt de l'app impossible"; return 1; fi

  seq_log "empreinte de la base avant toute modification (fingerprint-0.txt)"
  if ! db_fingerprint "$DB_NAME" > "$out/fingerprint-0.txt"; then seq_abort_before "empreinte initiale impossible"; return 1; fi

  seq_log "sauvegarde pré-migration vérifiée (obligatoire, hors rétention)"
  PRE_MIGRATION_ARCHIVE=
  if ! hook_backup "$out"; then seq_abort_before "sauvegarde pré-migration en échec : rien n'a été modifié"; return 1; fi
  if [ -z "$PRE_MIGRATION_ARCHIVE" ] || [ ! -s "$PRE_MIGRATION_ARCHIVE" ] || [ ! -s "$PRE_MIGRATION_ARCHIVE.sha256" ] || [ ! -s "$PRE_MIGRATION_ARCHIVE.fingerprint" ]; then
    seq_abort_before "archive pré-migration absente ou sans .sha256 / .fingerprint : ${PRE_MIGRATION_ARCHIVE:-?}"; return 1
  fi
  d=$(fingerprint_diff "$out/fingerprint-0.txt" "$PRE_MIGRATION_ARCHIVE.fingerprint" | tr '\n' ' '); d=${d% }
  if [ -n "$d" ]; then seq_abort_before "l'archive pré-migration ne porte pas l'empreinte de la base : $d"; return 1; fi
  seq_log "archive pré-migration : $PRE_MIGRATION_ARCHIVE — sha256 $(cut -d' ' -f1 "$PRE_MIGRATION_ARCHIVE.sha256") — empreinte $(fingerprint_global "$PRE_MIGRATION_ARCHIVE.fingerprint")"

  seq_log "inventaire avant migration (inventory-before-*)"
  if ! db_inventory "$out/inventory-before"; then seq_abort_before "inventaire impossible"; return 1; fi

  # 001 et 002 ne se rejouent que tant que 003 n'est pas journalisée : 001 recrée sans condition
  # `deck_requirements` (intermédiaire v2 que 003 supprime), et 003 refuse alors tout rejeu
  # (« objet historique réapparu »). Après 003, leurs objets sont définitifs ; seul le schéma
  # (bloc historique conditionnel, D1) se rejoue à chaque déploiement.
  local files='db/schema.sql db/migrations/001-deck-configuration.sql db/migrations/002-profiles-and-conditions.sql'
  if grep -q '003-purge-legacy' "$out/inventory-before-journal.txt"; then
    seq_log "003 déjà journalisée : 001 et 002 ne se rejouent plus (001 recréerait deck_requirements), schéma seulement"
    files='db/schema.sql'
  fi
  for f in $files; do
    seq_log "rejeu par stdin : $f"
    if ! db_psql < "$ROOT_DIR/$f" 2> "$out/psql.err"; then
      seq_abort_before "$f en échec (transaction annulée) : $(tail -n 3 "$out/psql.err" | tr '\n' ' ')"; return 1
    fi
  done
  if ! db_fingerprint "$DB_NAME" > "$out/fingerprint-2.txt"; then seq_abort_before "empreinte après 002 impossible"; return 1; fi

  seq_log "003 en simulation (rapport : $out/003-simulation.txt)"
  simulate_003 "$out/003-simulation.txt"
  case $SIM_STATUS in
    failed)
      seq_log "ÉCHEC : 003 refusée ou en erreur en simulation — $SIM_MESSAGE"
      seq_log "001 et 002 sont appliquées ; app démarrée sans 003 ; corriger la donnée nommée dans $out/003-simulation.err puis relancer"
      hook_start_app || true; return 1;;
    already) seq_log "003 déjà journalisée : aucun effet, contrôles seulement";;
    simulated) seq_log "simulation terminée, code 0, marqueur présent — $SIM_SUMMARY"; seq_log "empreinte du rapport : $SIM_FP";;
  esac
  if [ "$SIM_STATUS" = simulated ]; then
    if [ "$SIM_PURGE" = 0 ]; then
      seq_log "rien à purger : aucune acceptation requise"; SIM_FP=
    elif ! accept_report "$accept" "$out/003-simulation.txt"; then
      seq_log "rapport refusé : 001 et 002 restent appliquées, 003 non jouée, app démarrée sans 003 (Q8)"
      hook_start_app || true; return 3
    fi
    seq_log "003 réelle (rapport : $out/003-apply.txt)"
    apply_003 "$SIM_FP" "$out/003-apply.txt"
    case $APPLY_STATUS in
      applied) seq_log "purge appliquée — $APPLY_MESSAGE";;
      already) seq_log "003 déjà journalisée à l'application : aucun effet";;
      *)
        seq_log "ÉCHEC : 003 en échec à l'application — $APPLY_MESSAGE"
        seq_log "transaction annulée : base à 001 / 002, app démarrée sans 003"
        hook_start_app || true; return 1;;
    esac
  fi

  seq_log "contrôles après migration (check-migration.txt, fingerprint-3.txt)"
  if ! check_after_migration "$out"; then
    seq_log "ÉCHEC : contrôle après migration en échec — app laissée ARRÊTÉE"
    hook_app_left_stopped "bash $LIB_DIR/restore.sh $PRE_MIGRATION_ARCHIVE"
    return 2
  fi
  seq_log "démarrage de l'app"
  if ! hook_start_app; then seq_log "ÉCHEC : démarrage de l'app"; return 1; fi
  seq_log "séquence terminée : ok"
  return 0
}
