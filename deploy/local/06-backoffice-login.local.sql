-- Pile LOCALE seulement (deploy/docker-compose.local.yml) : mot de passe du rôle restreint du
-- back-office, posé par initdb sur le volume neuf. En production ce mot de passe vient de .env.prod
-- (deploy.sh, backoffice_db_login) et n'est jamais dans un fichier versionné.
alter role testhand_backoffice with login password 'backoffice-local';
