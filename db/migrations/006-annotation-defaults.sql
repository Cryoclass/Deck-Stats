-- Annotations par défaut (docs/annotations-par-defaut.md §11 « Réponses » et §13 « Modèle révisé
-- pour la partie C ») — cinquième profil de disponibilité « réactive » (partie B), puis rôle
-- `referent`, choix du compte par aspect, référence commune et son journal, groupe fourni de base
-- « Mulcharmy », résumés invalidés (partie C, lot C1), puis avis fermés par compte `user_notices`
-- (partie D, lot D1).
--
-- Deux zones, volontairement séparées :
--   • le DDL vit HORS de tout marqueur de journal et reste idempotent, parce que ce fichier a été
--     étendu après avoir déjà été journalisé sur des bases d'essai : un rejeu sur une base portant
--     déjà « 006-annotation-defaults » doit appliquer les ajouts (le journal note qu'une migration
--     est passée, il ne garde pas ce qu'elle contenait ce jour-là) ;
--   • les DONNÉES sont migrées UNE SEULE FOIS, sous un SECOND marqueur de journal
--     « 006-annotation-defaults/c ». Un `update … where` idempotent ne suffirait pas et serait même
--     faux : après la partie C, `card_flags.is_hopt = false` est un CHOIX explicite du compte
--     (« cette carte n'est pas HOPT », §13 « Sémantique des choix ») — le rejouer effacerait ce
--     choix ; et `update decks set summary = null` remettrait à zéro, à chaque déploiement, les
--     aperçus que les clients viennent de recalculer. Le marqueur est donc la seule garde correcte.
--
-- Prérequis : 002 (colonne `card_flags.availability`) ET 005 (colonne `users.role` et sa contrainte
-- `users_role_check`, que ce fichier élargit). Refus nominatifs avant tout DDL.
--
-- Ordre de rejeu : 006 passe APRÈS 005. 005 est défensive — elle révoque tous les privilèges
-- d'objet du schéma public au rôle `testhand_backoffice` avant de réaccorder sa propre liste — donc
-- un rejeu de 005 emporte les deux `grant select` posés ici. C'est sans conséquence tant que 006
-- suit 005 : c'est le cas dans la séquence partagée (`deploy/lib.sh`, `run_migration_sequence`),
-- dans les montages `docker-entrypoint-initdb.d` (05 puis 06, docker-compose.yml et
-- deploy/docker-compose.prod.yml) et dans `web/e2e/run.mjs`. Ne jamais intercaler 005 après 006.
--
-- Aucun psql-isme : ce fichier s'exécute par psql (séquence de déploiement, initdb) comme par le
-- pilote pg.
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());

-- ─── Prérequis (refus nominatifs, avant tout DDL) ───
do $$ begin
  if not exists (select 1 from app_migrations where id = '002-profiles-and-conditions') then
    raise exception 'Apply 002-profiles-and-conditions before 006-annotation-defaults';
  end if;
  if not exists (select 1 from app_migrations where id = '005-backoffice') then
    raise exception 'Apply 005-backoffice before 006-annotation-defaults';
  end if;
end $$;

-- ─── Profil de disponibilité : cinquième valeur « reactive » (partie B) ───
-- 002 a créé la colonne avec un CHECK *inline*, donc au nom automatique
-- `card_flags_availability_check` ; une base restaurée depuis une archive peut en porter un autre
-- (renommage, `pg_dump` d'un cluster plus ancien). On retrouve donc par le catalogue TOUTE
-- contrainte CHECK portant sur la seule colonne `availability` (jamais
-- `card_flags_group_requires_profile`, qui porte sur deux colonnes), on la supprime, puis on
-- recrée la contrainte sous un nom explicite. Rejouable : le rejeu supprime la contrainte que ce
-- fichier vient de poser et la repose à l'identique, si bien qu'une valeur ajoutée par une version
-- ultérieure de ce fichier s'applique sans condition.
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att on att.attrelid = rel.oid and att.attname = 'availability'
     where ns.nspname = 'public' and rel.relname = 'card_flags' and con.contype = 'c'
       and con.conkey::smallint[] = array[att.attnum]
  loop
    execute format('alter table public.card_flags drop constraint %I', c);
  end loop;
  alter table public.card_flags add constraint card_flags_availability_check
    check (availability in ('early', 'flexible', 'prepared', 'breaker', 'reactive'));
end $$;

-- ─── Rôles applicatifs : hiérarchie admin > referent > user (Q1, D5′) ───
-- 005 avait posé `check (role in ('user', 'admin'))` sous ce nom fixe. Supprimer puis recréer est
-- idempotent et fait foi, quel que soit le contenu précédent. Un admin EST référent (la hiérarchie
-- se lit dans le code : `role in ('referent','admin')`), aucune ligne n'est réécrite ici.
-- L'attribution reste hors des routes : `deploy/backoffice-role.sh grant <email> --role referent`.
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('user', 'referent', 'admin'));

-- ─── Choix du compte, copie sur écriture par aspect (D6, §13 « Sémantique des choix ») ───
-- `is_hopt` devient nullable : NULL (ou aucune ligne) = « hérite du défaut » (référence, sinon
-- détection) ; true / false = choix explicite du compte. `drop not null` sur une colonne déjà
-- nullable est un no-op silencieux : la ligne est rejouable telle quelle.
-- `nonengine_choice` = l'aspect non-engine (profil, plafond, étiquettes) est matérialisé pour ce
-- compte ; false = hérité. La valeur par défaut `false` de `is_hopt` (db/schema.sql) est laissée en
-- place : les routes de la partie C2 écrivent toujours `is_hopt` explicitement.
alter table card_flags alter column is_hopt drop not null;
alter table card_flags add column if not exists nonengine_choice boolean not null default false;

-- ─── Plafond fourni de base (D7′) ───
-- `is_builtin` : groupe créé par l'application (« Mulcharmy », 2 par tour), non supprimable par le
-- compte (400 comme une étiquette fournie de base), limite modifiable.
alter table nonengine_groups add column if not exists is_builtin boolean not null default false;

-- ─── Référence commune, posée par un référent (D4′) ───
-- Commune à TOUS les comptes (aucun `owner_id`), donc sans cache par compte : c'est la couche
-- intermédiaire entre la détection (jamais stockée) et le choix du compte.
-- `card_id` = passcode, sans clé étrangère vers `cards` (lookup sans FK, comme partout).
-- `is_hopt` NULL = laisser la détection décider ; `nonengine_set` true = `availability` et
-- `group_name` font foi, même à NULL (« cette carte n'est PAS non-engine, contrairement à ce que
-- la détection croit »). `group_name` est un NOM, résolu par le client vers le groupe fourni de
-- base du compte : la référence ne connaît pas les identifiants des groupes d'un compte.
create table if not exists card_references (
  card_id       bigint primary key check (card_id > 0),
  is_hopt       boolean,
  nonengine_set boolean not null default false,
  availability  text check (availability in ('early', 'flexible', 'prepared', 'breaker', 'reactive')),
  group_name    text check (group_name is null or length(group_name) between 1 and 200),
  note          text check (note is null or length(note) <= 2000),
  updated_by    uuid references users on delete set null,
  updated_at    timestamptz not null default now(),
  constraint card_references_nonengine_coherent check (nonengine_set or (availability is null and group_name is null)),
  constraint card_references_group_requires_profile check (group_name is null or availability is not null)
);
create index if not exists card_references_updated on card_references (updated_at desc);

-- ─── Journal des références, en ajout seul (comme backoffice_audit dans 005) ───
-- `before` / `after` = la ligne de référence avant et après le geste (NULL d'un côté à la création
-- ou au retrait). `actor` est un uuid SANS clé étrangère, exactement comme `backoffice_audit` :
-- une ligne survit à la suppression du compte, et surtout un `references users on delete set null`
-- serait INCOMPATIBLE avec l'ajout seul — l'action référentielle émet un `update` sur cette table,
-- que le déclencheur ci-dessous refuse (il est `for each statement`, donc il se déclenche même
-- quand aucune ligne ne correspond) : la suppression de n'importe quel compte deviendrait
-- impossible. Constaté par le cas « F sans 006 » de deploy/test-migration-sequence.sh.
-- §13 du plan écrivait « actor uuid references users on delete set null » : cette clé est écartée
-- pour cette raison. `card_references.updated_by` garde la sienne (table modifiable, sans
-- déclencheur d'ajout seul).
create table if not exists card_reference_log (
  id      bigserial primary key,
  card_id bigint not null,
  action  text not null check (action in ('set', 'clear')),
  before  jsonb,
  after   jsonb,
  actor   uuid,
  at      timestamptz not null default now()
);
-- Défensif : une base d'essai créée par une version intermédiaire de ce fichier porte la clé
-- étrangère décrite ci-dessus ; elle est retirée au rejeu. Sans effet sur une base saine.
do $$
declare c text;
begin
  if to_regclass('public.card_reference_log') is null then return; end if;
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public' and rel.relname = 'card_reference_log' and con.contype = 'f'
  loop
    execute format('alter table public.card_reference_log drop constraint %I', c);
  end loop;
end $$;
create index if not exists card_reference_log_at   on card_reference_log (at desc);
create index if not exists card_reference_log_card on card_reference_log (card_id, at desc);

create or replace function card_reference_log_refuse() returns trigger language plpgsql as $$
begin
  raise exception 'card_reference_log est en ajout seul : % refusé', tg_op using errcode = 'insufficient_privilege';
end $$;
drop trigger if exists card_reference_log_append_only on card_reference_log;
create trigger card_reference_log_append_only
  before update or delete or truncate on card_reference_log
  for each statement execute function card_reference_log_refuse();
-- ENABLE ALWAYS : le déclencheur tient aussi en session_replication_role = replica (restauration
-- logique) ; seul un superutilisateur qui le DÉSACTIVE explicitement peut passer outre.
alter table card_reference_log enable always trigger card_reference_log_append_only;

-- ─── Privilèges du rôle du site : lecture seule sur la référence et son journal, rien d'autre ───
-- Le rôle est créé par 005 ; il peut être absent (base montée sans 005 hors séquence, cluster
-- d'essai), auquel cas il n'y a rien à accorder.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'testhand_backoffice') then
    execute 'grant select on card_references to testhand_backoffice';
    execute 'grant select on card_reference_log to testhand_backoffice';
  end if;
end $$;

-- ─── Avis d'interface fermés par compte (partie D, lot D1 ; §11 Q8, D9) ───
-- Une ligne = « ce compte a fermé cet avis » ; la fermeture est retenue côté serveur, donc sur
-- tous les appareils du compte. Table MODIFIABLE (pas d'ajout seul : c'est un état, pas un
-- journal) ; la suppression du compte emporte ses lignes. `notice` est une liste fermée, tenue aussi par
-- `server/src/auth/notices.ts`. Le CHECK est anonyme dans un `create table if not exists` : modifier la
-- liste ICI n'aurait aucun effet sur une base où la table existe ; une clé nouvelle exigera une migration
-- qui retrouve la contrainte par `pg_constraint`, la supprime et la recrée (méthode de
-- `card_flags_availability_check` plus haut).
-- Règle d'affichage (server/src/routes/auth.ts, `/api/auth/me`) : l'avis « annotation-defaults »
-- est dû à un compte créé AVANT l'application du marqueur « 006-annotation-defaults/c » et sans
-- ligne ici ; un compte créé après n'a jamais eu d'anciens chiffres.
-- Aucun privilège pour `testhand_backoffice` (contenu du compte ; check-migration.sql met un KO).
create table if not exists user_notices (
  user_id      uuid not null references users on delete cascade,
  notice       text not null check (notice in ('annotation-defaults')),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, notice)
);

-- ─── Données, UNE SEULE FOIS (second marqueur « 006-annotation-defaults/c ») ───
-- Q2 : une ligne `is_hopt = false` d'avant le chantier était indiscernable d'un clic « retirer » et
-- d'un profil posé — elle repasse donc à « hérite ». Un compte qui avait posé un profil avait, lui,
-- une intention claire : son aspect non-engine est matérialisé (`nonengine_choice`). Les cartes
-- seulement ÉTIQUETÉES ne sont PAS matérialisées : une étiquette sans profil était une annotation
-- inachevée (l'éditeur l'avertissait « étiquetée sans profil, non comptée ») et on veut que le
-- défaut la complète. Enfin tous les aperçus tombent : le modèle moteur change pour tout le monde.
do $$ begin
  if exists (select 1 from app_migrations where id = '006-annotation-defaults/c') then return; end if;

  update card_flags set is_hopt = null where is_hopt = false;
  update card_flags set nonengine_choice = true where availability is not null;

  insert into nonengine_groups (owner_id, name, cap_per_turn, is_builtin)
    select u.id, 'Mulcharmy', 2, true from users u
     where not exists (select 1 from nonengine_groups g where g.owner_id = u.id and g.name = 'Mulcharmy');
  update nonengine_groups set is_builtin = true where name = 'Mulcharmy' and not is_builtin;

  update decks set summary = null;

  insert into app_migrations (id) values ('006-annotation-defaults/c');
end $$;

-- ─── Journalisation, après assertions nominatives sur le DDL ───
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_flags_availability_check') then
    raise exception '006-annotation-defaults : card_flags_availability_check absente après le DDL (card_flags.availability manquante ?)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_role_check' and pg_get_constraintdef(oid) like '%referent%') then
    raise exception '006-annotation-defaults : users_role_check n''accepte pas « referent » après le DDL';
  end if;
  if to_regclass('public.card_references') is null or to_regclass('public.card_reference_log') is null then
    raise exception '006-annotation-defaults : card_references ou card_reference_log absente après le DDL';
  end if;
  if to_regclass('public.user_notices') is null then
    raise exception '006-annotation-defaults : user_notices absente après le DDL';
  end if;
  if not exists (select 1 from app_migrations where id = '006-annotation-defaults/c') then
    raise exception '006-annotation-defaults : marqueur de données « /c » absent après le bloc de données';
  end if;
  if not exists (select 1 from app_migrations where id = '006-annotation-defaults') then
    insert into app_migrations (id) values ('006-annotation-defaults');
  end if;
end $$;
commit;
