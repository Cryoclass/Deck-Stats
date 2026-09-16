-- Back-office (hors numérotation, docs/backoffice.md) — rôle des comptes, tables du back-office et
-- rôle PostgreSQL restreint. Additive et transactionnelle : aucune table existante modifiée hors la
-- colonne `users.role`, aucun objet supprimé, aucune donnée migrée. Indépendante de 003 : elle
-- s'applique avant ou après la purge et se rejoue sans effet (les privilèges sont révoqués puis
-- réaccordés à chaque rejeu, pour qu'un privilège accordé à la main ne survive pas).
--
-- Ce que cette migration n'ajoute PAS, par décision : aucune colonne d'offre, d'abonnement ni de
-- suspension (elles viendront avec leurs règles). Le rôle `admin` ne s'attribue que par
-- deploy/backoffice-role.sh (ligne de commande, en tant que propriétaire) : le rôle PostgreSQL du
-- site n'a aucun droit d'écriture sur `users`.
--
-- Deux garanties tenues par la base, pas seulement par le code du site :
--   • l'admin ne lit jamais le contenu d'un deck : `testhand_backoffice` n'a de SELECT que sur les
--     colonnes qu'il affiche (decks : id, owner_id, dates ; jamais name / notes / params / summary)
--     et AUCUN privilège sur deck_cards, conditions, plans de side, bibliothèque, catalogue ;
--   • le journal est en ajout seul : INSERT + SELECT pour le rôle, et un déclencheur refuse
--     UPDATE / DELETE / TRUNCATE à tout le monde, propriétaire compris.
-- Le rôle est créé NOLOGIN : le déploiement pose LOGIN et le mot de passe (lib.sh,
-- backoffice_db_login) — une migration versionnée ne porte aucun secret. pg_dump émet les GRANT
-- vers ce rôle : un cluster neuf qui reçoit une archive doit le pré-créer (lib.sh,
-- ensure_backoffice_role).
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());

-- ─── Rôle applicatif du compte ───
alter table users add column if not exists role text not null default 'user';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table users add constraint users_role_check check (role in ('user', 'admin'));
  end if;
end $$;

-- ─── Second facteur (TOTP) des admins ───
-- `secret_enc` = secret TOTP chiffré (AES-256-GCM, clé BACKOFFICE_TOTP_KEY de l'environnement du
-- site) : un dump ne livre pas le second facteur. `confirmed_at` nul = enrôlement en cours (le QR
-- a été montré, aucun code juste encore reçu) ; `last_counter` = dernier pas de 30 s accepté, un
-- code ne sert qu'une fois (anti-rejeu).
create table if not exists backoffice_totp (
  user_id       uuid primary key references users on delete cascade,
  secret_enc    bytea not null,
  confirmed_at  timestamptz,
  last_counter  bigint not null default 0,
  created_at    timestamptz not null default now()
);

-- ─── Sessions du back-office ───
-- Aucun lien avec `sessions` (app de jeu, cookie ygo_session). Expiration ABSOLUE : expires_at est
-- écrite une fois (création + 8 h) et jamais prolongée. `totp_verified_at` nul = mot de passe
-- validé, second facteur en attente.
create table if not exists backoffice_sessions (
  token_hash        bytea primary key,             -- SHA-256 du jeton ; le clair ne touche jamais la base
  user_id           uuid not null references users on delete cascade,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  totp_verified_at  timestamptz,
  user_agent        text,
  ip                text
);
create index if not exists backoffice_sessions_user on backoffice_sessions (user_id);

-- ─── Journal, en ajout seul ───
-- Pas de clé étrangère sur l'acteur ni la cible : une ligne survit à la suppression du compte
-- (l'email est copié au moment des faits). `detail` porte le contexte (recherche, tri, page,
-- filtres, adresse, agent utilisateur, raison d'un refus).
create table if not exists backoffice_audit (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_user_id   uuid,
  actor_email     text,
  action          text not null check (length(action) between 1 and 64),
  target_user_id  uuid,
  detail          jsonb not null default '{}'::jsonb,
  source          text not null default 'web' check (source in ('web', 'cli'))
);
create index if not exists backoffice_audit_at     on backoffice_audit (at desc);
create index if not exists backoffice_audit_actor  on backoffice_audit (actor_user_id, at desc);
create index if not exists backoffice_audit_target on backoffice_audit (target_user_id, at desc);

create or replace function backoffice_audit_refuse() returns trigger language plpgsql as $$
begin
  raise exception 'backoffice_audit est en ajout seul : % refusé', tg_op using errcode = 'insufficient_privilege';
end $$;
drop trigger if exists backoffice_audit_append_only on backoffice_audit;
create trigger backoffice_audit_append_only
  before update or delete or truncate on backoffice_audit
  for each statement execute function backoffice_audit_refuse();
-- ENABLE ALWAYS : le déclencheur tient aussi en session_replication_role = replica (restauration
-- logique) ; seul un superutilisateur qui le DÉSACTIVE explicitement peut passer outre.
alter table backoffice_audit enable always trigger backoffice_audit_append_only;

-- ─── Rôle PostgreSQL du site : privilèges minimaux, par colonne ───
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'testhand_backoffice') then
    create role testhand_backoffice nologin;
  end if;
end $$;
-- Rejeu défensif : les privilèges d'objet du schéma public sont retirés avant de réaccorder la
-- liste ci-dessous (REVOKE sur une table retire aussi ses privilèges de colonne) ; les attributs
-- du rôle et les appartenances larges (pg_read_all_data, pg_write_all_data, ygo) sont retirés aussi,
-- pour qu'un droit posé à la main ne survive pas. Une appartenance à un autre rôle ou un GRANT à
-- PUBLIC posés ailleurs ne sont pas corrigés ici mais DÉTECTÉS par deploy/check-migration.sql.
alter role testhand_backoffice nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
do $$ begin
  -- REVOKE d'une appartenance absente n'est qu'un avertissement, mais ygo n'existe pas dans tous les clusters.
  if exists (select 1 from pg_roles where rolname = 'ygo') then execute 'revoke ygo from testhand_backoffice'; end if;
  execute 'revoke pg_read_all_data, pg_write_all_data, pg_read_all_settings, pg_read_all_stats from testhand_backoffice';
end $$;
revoke all privileges on all tables    in schema public from testhand_backoffice;
revoke all privileges on all sequences in schema public from testhand_backoffice;
revoke all privileges on all functions in schema public from testhand_backoffice;
grant usage on schema public to testhand_backoffice;
grant select (id, email, display_name, password_hash, created_at, role) on users           to testhand_backoffice;
grant select (user_id, created_at, expires_at, user_agent)              on sessions        to testhand_backoffice;
grant select (provider, user_id, created_at)                            on user_identities to testhand_backoffice;
grant select (id, owner_id, created_at, updated_at)                     on decks           to testhand_backoffice;
grant select                                                            on catalog_version to testhand_backoffice;
grant select, insert, update, delete on backoffice_sessions to testhand_backoffice;
grant select, insert, update         on backoffice_totp     to testhand_backoffice;
grant select, insert                 on backoffice_audit    to testhand_backoffice;
grant usage on sequence backoffice_audit_id_seq to testhand_backoffice;

insert into app_migrations (id) values ('005-backoffice') on conflict (id) do nothing;
commit;
