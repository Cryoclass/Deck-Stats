#!/usr/bin/env bash
# Rôle admin d'un compte (back-office, docs/backoffice.md §3 T9) — le SEUL chemin d'attribution :
#   bash deploy/backoffice-role.sh grant  <email> [--apply] [--actor <qui>]
#   bash deploy/backoffice-role.sh revoke <email> [--apply] [--actor <qui>]
#   bash deploy/backoffice-role.sh list
# Simulation par défaut (transaction annulée, rapport « SIMULATION TERMINÉE ») ; --apply écrit et
# journalise (backoffice_audit, source cli) dans la même transaction. Accès à la base par lib.sh :
# sur le VPS, `docker compose exec` du service db de la pile de production (depuis deploy/, avec
# .env.prod) ; ailleurs, TESTHAND_DB_CONTAINER=<conteneur> (dev : ygo-proba-db ; jamais une base
# réelle sans demande explicite). Codes : 0 rapport rendu (simulation, appliqué ou rien à faire) ;
# 1 refus nominatif de backoffice-role.sql (compte inconnu, 005 absente…) ; 2 usage.
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh

usage() { sed -n '2,10p' "$0" >&2; exit 2; }
[ $# -ge 1 ] || usage
ACTION=$1; shift
EMAIL=; APPLY=0; ACTOR="${USER:-$(id -un 2>/dev/null || echo inconnu)}@$(hostname 2>/dev/null || echo hote)"
case $ACTION in
  grant|revoke) [ $# -ge 1 ] || usage; EMAIL=$1; shift ;;
  list) ;;
  *) usage ;;
esac
while [ $# -gt 0 ]; do
  case $1 in
    --apply) APPLY=1 ;;
    --actor) ACTOR=${2:-}; [ -n "$ACTOR" ] || usage; shift ;;
    *) usage ;;
  esac
  shift
done
[ "$ACTION" = list ] || [ "$APPLY" = 1 ] || say "SIMULATION (rien ne sera écrit) : ajouter --apply pour écrire"

sql_literal() { printf "%s" "$1" | sed "s/'/''/g"; }
ARGS=(-c 'set client_min_messages = warning' -c "set testhand.role_action = '$(sql_literal "$ACTION")'" -c "set testhand.role_actor = '$(sql_literal "$ACTOR")'")
[ -z "$EMAIL" ] || ARGS+=(-c "set testhand.role_email = '$(sql_literal "$EMAIL")'")
[ "$APPLY" = 1 ] && ARGS+=(-c "set testhand.role_apply = '1'")
RC=0
db_exec psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -F ' | ' "${ARGS[@]}" -f - < "$LIB_DIR/backoffice-role.sql" || RC=$?
[ "$RC" = 0 ] || die "backoffice-role.sql refusé (code $RC) : voir le message ci-dessus" 1
