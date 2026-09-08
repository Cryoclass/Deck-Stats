#!/usr/bin/env bash
# Répétition complète du déploiement 8C sur une copie jetable (étape 8B, point 4).
#   bash deploy/rehearsal.sh <archive.sql.gz> [--accept <empreinte>] [--keep] [--skip-e2e] [--skip-rollback]
#   bash deploy/rehearsal.sh --fixture [mêmes options]
# Enchaîne EXACTEMENT ce que deploy.sh jouera (lib.sh, run_migration_sequence) sur un conteneur
# postgres:17-alpine jetable (testhand-rehearsal-db, 127.0.0.1:55436, purpose=testhand-step8) :
#   1. restauration de l'archive (dump réel de production hors dépôt, ou jeu représentatif) ;
#   2. séquence partagée : sauvegarde pré-migration vérifiée (dans le dossier de sortie),
#      inventaire (effectifs, journal, résumés d'avant purge, modèle historique), schéma, 001,
#      002, 003 en simulation puis réelle — --accept <empreinte> : empreinte ATTENDUE, la
#      répétition échoue si la simulation en donne une autre ; sans --accept, l'empreinte de la
#      simulation est acceptée automatiquement — puis contrôles après migration ;
#   3. contrôle de recalcul (scripts/recompute-check.ts) : l'archive pré-migration est restaurée
#      dans ygo_old, l'ancien moteur e890078 (matérialisé depuis git dans le dossier de sortie)
#      y calcule la référence de chaque deck, comparée au nouveau moteur avec paires réinjectées
#      (identique attendu) puis après purge (écart chiffré) ; résumé stocké informatif seulement ;
#   4. gardes e2e complètes sur la pile migrée (web/e2e/run.mjs --db : serveur 8790, Vite 5174,
#      Chrome ; cartes synthétiques ajoutées à la copie) ;
#   5. retour arrière prouvé : restore.sh sur l'archive pré-migration, empreinte initiale retrouvée ;
#   6. démontage (sauf --keep). Rapport : deploy/out/rehearsal-<horodatage>/rapport.md, plus les
#      fichiers de la séquence. Le rapport ne cite ni email ni nom de compte ; le dossier contient
#      en revanche des archives complètes de la base (backups/) : ne pas le partager.
# --fixture : le jeu représentatif (schéma + server/tests/fixtures/legacy-representative.sql,
# résumés d'avant purge fabriqués par le moteur, --fabricate) est archivé par pg_dump puis rejoué
# comme une archive réelle. Jamais la base de dev (5433), jamais le VPS.
set -euo pipefail
START_DIR=$PWD
cd "$(dirname "$0")"
. ./lib.sh

CONTAINER=${REHEARSAL_DB_CONTAINER:-testhand-rehearsal-db}
PORT=${REHEARSAL_DB_PORT:-55436}
OLD_DB=ygo_old   # base pré-migration (archive pré-migration restaurée) pour la référence de l'ancien moteur
ARCHIVE=; FIXTURE=0; ACCEPT=auto; KEEP=0; SKIP_E2E=0; SKIP_ROLLBACK=0
while [ $# -gt 0 ]; do
  case $1 in
    --fixture) FIXTURE=1 ;;
    --accept) ACCEPT=${2:-}; [ -n "$ACCEPT" ] || die 'empreinte attendue après --accept' 2; shift ;;
    --keep) KEEP=1 ;;
    --skip-e2e) SKIP_E2E=1 ;;
    --skip-rollback) SKIP_ROLLBACK=1 ;;
    -*) die "option inconnue : $1" 2 ;;
    *) [ -z "$ARCHIVE" ] || die 'une seule archive attendue' 2; ARCHIVE=$1 ;;
  esac
  shift
done
if [ "$FIXTURE" = 1 ]; then [ -z "$ARCHIVE" ] || die "--fixture ne prend pas d'archive" 2
else
  [ -n "$ARCHIVE" ] || die 'usage : bash rehearsal.sh <archive.sql.gz> [--accept <empreinte>] [--keep] [--skip-e2e] [--skip-rollback] | --fixture' 2
  case $ARCHIVE in /*) ;; *) ARCHIVE="$START_DIR/$ARCHIVE" ;; esac
  [ -s "$ARCHIVE" ] || die "archive introuvable : $ARCHIVE" 2
fi
if [ "$ACCEPT" != auto ] && ! printf '%s' "$ACCEPT" | grep -Eq '^[0-9a-f]{32}$'; then die "--accept : empreinte md5 (32 hexadécimaux) attendue" 2; fi
[ "$PORT" != 5433 ] || die 'port 5433 interdit (base de dev)' 2

OUT="$LIB_DIR/out/rehearsal-$(stamp)"
mkdir -p "$OUT"
REPORT="$OUT/rapport.md"
URL="postgres://ygo:ygo-disposable@127.0.0.1:$PORT/ygo"
export BACKUP_DIR="$OUT/backups"
export TESTHAND_DB_CONTAINER=$CONTAINER
T0=$(date +%s)
STEPS=()
FAILED=0
report() { printf '%s\n' "$*" >> "$REPORT"; }
step_result() {  # <étape> <ok|KO|ignorée> <détail>
  STEPS+=("| $1 | $2 | $3 |")
  [ "$2" = ok ] || [ "$2" = ignorée ] || FAILED=1
  say "$1 : $2 — $3"
}
elapsed() { echo "$(( $(date +%s) - T0 )) s"; }

if [ -n "$(docker ps -a --filter "name=^/$CONTAINER$" --format '{{.Names}}')" ]; then die "le conteneur $CONTAINER existe déjà : docker stop $CONTAINER" 2; fi
cleanup() {
  if [ "$KEEP" = 1 ]; then say "conteneur $CONTAINER conservé (--keep) : docker stop $CONTAINER pour le supprimer"; return; fi
  docker stop "$CONTAINER" > /dev/null 2>&1 || true
}
trap cleanup EXIT

say "conteneur jetable $CONTAINER (127.0.0.1:$PORT), sortie : $OUT"
docker run --name "$CONTAINER" --label purpose=testhand-step8 --rm --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=ygo -e POSTGRES_PASSWORD=ygo-disposable -e POSTGRES_DB=ygo \
  -p "127.0.0.1:$PORT:5432" -d postgres:17-alpine > /dev/null
db_ready || die "conteneur $CONTAINER injoignable"

report "# Répétition 8B — $(date -u '+%Y-%m-%d %H:%M UTC')"
report ""
if [ "$FIXTURE" = 1 ]; then
  say "jeu représentatif : schéma, fixture pré-001, résumés d'avant purge fabriqués par le moteur, archive pg_dump"
  db_psql < "$ROOT_DIR/db/schema.sql"
  db_psql < "$ROOT_DIR/server/tests/fixtures/legacy-representative.sql"
  (cd "$ROOT_DIR" && node --import tsx scripts/recompute-check.ts --db "$URL" --fabricate) | tee "$OUT/fabricate.txt"
  ARCHIVE="$OUT/fixture-legacy.sql.gz"
  db_exec pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" | gzip > "$ARCHIVE"
  db_query 'drop schema public cascade; create schema public;' > /dev/null
  report "- Source : jeu représentatif \`server/tests/fixtures/legacy-representative.sql\` (base pré-001), résumés d'avant purge fabriqués par le moteur (\`recompute-check.ts --fabricate\`), archivé par pg_dump puis rejoué comme une archive réelle."
else
  report "- Source : archive \`$(basename "$ARCHIVE")\` ($(du -h "$ARCHIVE" | cut -f1)), hors dépôt."
fi
ARCHIVE_SHA=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
report "- SHA-256 de l'archive : \`$ARCHIVE_SHA\`"
report "- Conteneur : \`$CONTAINER\` (127.0.0.1:$PORT, postgres:17-alpine, --tmpfs, --rm) ; acceptation : $([ "$ACCEPT" = auto ] && echo 'empreinte de la simulation (auto)' || echo "empreinte attendue \`$ACCEPT\`")."
report "- Dossier : \`$OUT\`"
report ""

# ─── 1. Restauration ───
say "1. restauration de l'archive dans $CONTAINER"
if gunzip -c "$ARCHIVE" | db_exec psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f - > "$OUT/restore.log" 2>&1; then
  step_result "1. Restauration de l'archive" ok "$(db_query "select count(*) from pg_tables where schemaname = 'public'") table(s), $(db_query 'select count(*) from decks') deck(s), $(db_query 'select count(*) from cards') carte(s) ($(elapsed))"
else
  step_result "1. Restauration de l'archive" KO "voir $OUT/restore.log"
fi

# ─── 2. Séquence partagée ───
SEQ_RC=
if [ "$FAILED" = 0 ]; then
  hook_stop_app() { :; }
  hook_start_app() { :; }
  hook_start_old_app() { :; }
  hook_app_left_stopped() { say "app laissée arrêtée (répétition) — restauration : $1"; }
  hook_backup() { backup_pre_migration "$1"; }
  if run_migration_sequence "$OUT" "$ACCEPT"; then SEQ_RC=0; else SEQ_RC=$?; fi
  case $SEQ_RC in
    0) step_result "2. Séquence partagée (sauvegarde, inventaire, schéma, 001, 002, 003 simulée et appliquée, contrôles)" ok "code 0 ; $SIM_SUMMARY ; empreinte \`${SIM_FP:-aucune}\` ($(elapsed))" ;;
    *) step_result "2. Séquence partagée" KO "code $SEQ_RC — voir $OUT/journal.txt" ;;
  esac
fi

# ─── 3. Recalcul ───
if [ "$FAILED" = 0 ]; then
  say "3. contrôle de recalcul (scripts/recompute-check.ts) : archive pré-migration restaurée dans $OLD_DB, référence = ancien moteur e890078"
  OLD_URL="postgres://ygo:ygo-disposable@127.0.0.1:$PORT/$OLD_DB"
  if ! restore_into_scratch_db "$PRE_MIGRATION_ARCHIVE" "$OLD_DB"; then
    step_result "3. Recalcul" KO "restauration de l'archive pré-migration dans $OLD_DB : $VERIFY_ERROR"
  elif (cd "$ROOT_DIR" && node --import tsx scripts/recompute-check.ts --db "$URL" --old-db "$OLD_URL" --reference-engine "$(host_path "$OUT/reference-engine-e890078")" --out "$(host_path "$OUT/recompute.txt")" > "$OUT/recompute.log" 2>&1); then
    step_result "3. Recalcul : ancien moteur (référence) contre nouveau moteur, paires réinjectées puis purgées" ok "$(grep '^Bilan' "$OUT/recompute.txt") ($(elapsed))"
  else
    step_result "3. Recalcul : ancien moteur (référence) contre nouveau moteur" KO "$(grep '^Bilan' "$OUT/recompute.txt" 2>/dev/null || tail -n 3 "$OUT/recompute.log" | tr '\n' ' ')"
  fi
  drop_scratch_db "$OLD_DB"
else
  step_result "3. Recalcul" ignorée "étape précédente en échec"
fi

# ─── 4. Gardes e2e sur la pile migrée ───
if [ "$SKIP_E2E" = 1 ]; then
  step_result "4. Gardes e2e sur la pile migrée" ignorée "--skip-e2e"
elif [ "$FAILED" = 0 ]; then
  say "4. gardes e2e sur la pile migrée (web/e2e/run.mjs --db)"
  if (cd "$ROOT_DIR/web" && node e2e/run.mjs --db "$URL" --db-container "$CONTAINER" > "$OUT/e2e.log" 2>&1); then
    step_result "4. Gardes e2e sur la pile migrée (setup, guards, compare, mobile)" ok "$(grep -o 'scénario [a-z]* : OK ([0-9.]* s)' "$OUT/e2e.log" | tr '\n' ';' | sed 's/;$//; s/;/ ; /g') ($(elapsed))"
  else
    step_result "4. Gardes e2e sur la pile migrée" KO "voir $OUT/e2e.log"
  fi
else
  step_result "4. Gardes e2e" ignorée "étape précédente en échec"
fi

# ─── 5. Retour arrière ───
if [ "$SKIP_ROLLBACK" = 1 ]; then
  step_result "5. Retour arrière par restore.sh" ignorée "--skip-rollback"
elif [ -n "${PRE_MIGRATION_ARCHIVE:-}" ] && [ -s "$PRE_MIGRATION_ARCHIVE" ] && [ -s "$OUT/fingerprint-0.txt" ]; then
  say "5. retour arrière : restore.sh sur l'archive pré-migration"
  if bash ${REHEARSAL_TRACE:+-x} ./restore.sh "$PRE_MIGRATION_ARCHIVE" --yes > "$OUT/rollback.log" 2>&1 && db_fingerprint "$DB_NAME" > "$OUT/fingerprint-rollback.txt" && cmp -s "$OUT/fingerprint-0.txt" "$OUT/fingerprint-rollback.txt"; then
    step_result "5. Retour arrière par restore.sh sur l'archive pré-migration" ok "empreinte initiale retrouvée ligne à ligne (\`$(fingerprint_global "$OUT/fingerprint-0.txt")\`) ($(elapsed))"
  else
    step_result "5. Retour arrière par restore.sh" KO "voir $OUT/rollback.log"
  fi
else
  step_result "5. Retour arrière" ignorée "archive pré-migration ou empreinte initiale absente"
fi

# ─── Rapport ───
report "## Étapes"
report ""
report "| Étape | Résultat | Détail |"
report "| --- | --- | --- |"
for s in "${STEPS[@]}"; do report "$s"; done
report ""
if [ -s "$OUT/inventory-before-counts.txt" ]; then
  report "## Inventaire avant migration"
  report ""
  report "Journal : \`$(cat "$OUT/inventory-before-journal.txt")\` (vide = base pré-001). Empreinte initiale : \`$(fingerprint_global "$OUT/fingerprint-0.txt")\`."
  report ""
  report "| Table | Effectif |"
  report "| --- | --- |"
  while read -r t n; do report "| $t | $n |"; done < "$OUT/inventory-before-counts.txt"
  report ""
  report "Archive pré-migration : \`$(basename "${PRE_MIGRATION_ARCHIVE:-?}")\` — sha256 \`$(cut -d' ' -f1 "${PRE_MIGRATION_ARCHIVE:-/dev/null}.sha256" 2>/dev/null)\` — empreinte \`$(fingerprint_global "${PRE_MIGRATION_ARCHIVE:-/dev/null}.fingerprint" 2>/dev/null)\`."
  report ""
fi
if [ -s "$OUT/003-simulation.txt" ]; then
  report "## 003 — simulation"
  report ""
  report '```text'
  grep -E '^(compte|résumé|empreinte|statut) \| ' "$OUT/003-simulation.txt" >> "$REPORT" || true
  for s in P1 P2 P3 P4 P5 P6; do n=$(grep -c "^$s | " "$OUT/003-simulation.txt" || true); [ "${n:-0}" -gt 0 ] && report "$s : $n ligne(s)"; done
  report '```'
  report ""
fi
if [ -s "$OUT/003-apply.txt" ]; then
  report "## 003 — application"
  report ""
  report '```text'
  grep -E '^(statut|après) \| ' "$OUT/003-apply.txt" >> "$REPORT" || true
  report '```'
  report ""
fi
if [ -s "$OUT/check-migration.txt" ]; then
  report "## Contrôles après migration"
  report ""
  report '```text'
  cat "$OUT/check-migration.txt" >> "$REPORT"
  report '```'
  report ""
fi
if [ -s "$OUT/recompute.txt" ]; then
  report "## Recalcul"
  report ""
  report '```text'
  cat "$OUT/recompute.txt" >> "$REPORT"
  report '```'
  report ""
fi
if [ -s "$OUT/e2e.log" ]; then
  report "## Gardes e2e"
  report ""
  report '```text'
  grep -E '^\[e2e\]' "$OUT/e2e.log" >> "$REPORT" || true
  report '```'
  report ""
fi
report "## Durée totale : $(elapsed)"
report ""
report "$([ "$FAILED" = 0 ] && echo 'RÉPÉTITION CONFORME' || echo 'RÉPÉTITION EN ÉCHEC')"

echo
cat "$REPORT"
echo
if [ "$FAILED" = 0 ]; then say "répétition conforme — rapport : $REPORT"; exit 0; fi
say "répétition en échec — rapport : $REPORT"; exit 1
