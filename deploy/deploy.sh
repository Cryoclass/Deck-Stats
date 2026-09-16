#!/usr/bin/env bash
# Déploiement (étape 8B, point 5) : git pull → build → db → séquence partagée de lib.sh → up.
#   bash ~/apps/ygo-proba/deploy/deploy.sh                       interactif : « OUI » demandé avant 003
#   bash ~/apps/ygo-proba/deploy/deploy.sh --expect <empreinte>  interactif, empreinte attendue comparée
#                                                                et affichée avant la question
#   bash ~/apps/ygo-proba/deploy/deploy.sh --accept <empreinte>  sans question : 003 appliquée seulement
#                                                                si la simulation donne exactement cette
#                                                                empreinte (répétition, tests)
# Séquence (run_migration_sequence, deploy/lib.sh — la même que rehearsal.sh) : arrêt de l'app →
# sauvegarde pré-migration vérifiée dans /var/backups/ygo-proba/keep/ (hors rétention) →
# inventaire (résumés d'avant purge capturés avant 001) → schéma → 001 → 002 → 003 en simulation
# (rapport en fichier ; marqueur « SIMULATION TERMINÉE » ET code 0 exigés, jamais le seul code) →
# acceptation → 003 réelle (marqueur « PURGE APPLIQUÉE ») → contrôles après migration → up.
# Codes : 0 déployé ; 1 échec avant 003 (ancienne app relancée, base intacte) ou 003 en échec
# (nouvelle app démarrée sans 003) ; 2 contrôle après migration en échec (app laissée ARRÊTÉE,
# commande de restauration affichée) ; 3 rapport refusé (nouvelle app démarrée sans 003, Q8).
# Rapports : deploy/out/deploy-<horodatage>/ (journal.txt, 003-simulation.txt, …), umask 077.
#
# Tout SQL est passé par STDIN, jamais par le fichier monté : `git pull` remplace db/schema.sql
# par un nouvel inode, le bind-mount du conteneur db reste attaché à l'ancien tant que le
# conteneur n'est pas recréé (constaté le 2026-08-31 : `catalog_version` absente après un
# déploiement pourtant vert).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only

cd deploy
. ./lib.sh
dc() { docker compose --env-file .env.prod -f docker-compose.prod.yml "$@"; }

ACCEPT=interactive
while [ $# -gt 0 ]; do
  case $1 in
    --accept) ACCEPT=${2:-}; [ -n "$ACCEPT" ] || die 'empreinte attendue après --accept' 2; shift ;;
    --expect) export EXPECTED_FINGERPRINT=${2:-}; [ -n "$EXPECTED_FINGERPRINT" ] || die 'empreinte attendue après --expect' 2; shift ;;
    *) die "option inconnue : $1 (attendu : --accept <empreinte> ou --expect <empreinte>)" 2 ;;
  esac
  shift
done
for v in "$ACCEPT" "${EXPECTED_FINGERPRINT:-}"; do
  if [ -n "$v" ] && [ "$v" != interactive ] && ! printf '%s' "$v" | grep -Eq '^[0-9a-f]{32}$'; then
    die "empreinte md5 attendue (32 caractères hexadécimaux) : $v" 2
  fi
done
umask 077
OUT="$LIB_DIR/out/deploy-$(stamp)"
mkdir -p "$OUT"

dc build
dc up -d db
# Étape 9B (incident 8C) : jamais `pg_isready` par le socket, qui accepte le serveur temporaire
# d'initialisation d'un volume neuf ; db_ready (lib.sh) attend `healthy`, le serveur définitif
# annoncé dans les journaux, puis un `select 1`.
echo '==> Attente de la DB (healthy, serveur définitif annoncé dans les journaux, select 1)...'
db_ready || die 'base injoignable après 120 s : docker compose --env-file .env.prod -f docker-compose.prod.yml ps / logs db'

hook_stop_app() { dc stop app admin; }       # aucune écriture de l'ancienne API ni du back-office pendant la transition
# Back-office (docs/backoffice.md T3) : LOGIN et mot de passe du rôle du site, posés hors migration
# depuis .env.prod (BACKOFFICE_DB_PASSWORD), AVANT le démarrage des conteneurs (le service admin se
# connecte dès sa première requête). Sans la clé, le rôle reste NOLOGIN et le service admin ne peut
# pas se connecter (avertissement, pas un échec : le back-office ne bloque jamais l'app de jeu).
backoffice_login_from_env() {
  local pw; pw=$(env_prod_value BACKOFFICE_DB_PASSWORD)
  if [ -z "$pw" ]; then warn "BACKOFFICE_DB_PASSWORD absent de .env.prod : rôle $BACKOFFICE_ROLE laissé NOLOGIN, le back-office ne pourra pas se connecter"; return 0; fi
  if backoffice_db_login "$pw"; then echo "==> rôle $BACKOFFICE_ROLE : LOGIN et mot de passe posés depuis .env.prod"
  else warn "rôle $BACKOFFICE_ROLE : LOGIN impossible (005 non appliquée ?) — le back-office ne pourra pas se connecter"; fi
}
hook_start_app() { backoffice_login_from_env; dc up -d; dc ps; }   # nouvelle image (avec ou sans 003 selon l'issue)
hook_start_old_app() { dc start app admin || true; dc ps; }   # conteneurs précédents, base intacte
hook_app_left_stopped() {
  echo "App laissée ARRÊTÉE : contrôle après migration en échec, détail dans $OUT/check-migration.txt"
  echo "Retour à l'état pré-migration (archive vérifiée, confirmation OUI demandée) : $1"
}
hook_backup() { backup_pre_migration "$1"; }

if run_migration_sequence "$OUT" "$ACCEPT"; then RC=0; else RC=$?; fi
echo "==> Rapports : $OUT"
case $RC in
  0) echo '==> Déployé. Santé : curl -s https://analysis.scratchrecode.com/api/health' ;;
  3) echo '==> Rapport de purge refusé : app démarrée SANS 003 (001 et 002 appliquées). Relancer deploy.sh pour rejouer la simulation.' ;;
  2) echo '==> Contrôle après migration en échec : app ARRÊTÉE, voir ci-dessus.' ;;
  *) echo "==> Échec (code $RC) : voir $OUT/journal.txt." ;;
esac
exit "$RC"
