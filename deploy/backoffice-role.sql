-- Attribution ou retrait du rôle admin d'un compte (back-office, docs/backoffice.md §3 T9), en
-- tant que propriétaire de la base : le rôle PostgreSQL du site (testhand_backoffice) n'a aucun
-- droit d'écriture sur users, c'est ici le SEUL chemin. Piloté par GUC de session, comme 003 :
--   testhand.role_action = 'grant' | 'revoke' | 'list'
--   testhand.role_email  = email du compte (insensible à la casse), sauf pour list
--   testhand.role_apply  = '1' pour écrire ; absent ou autre = SIMULATION (transaction annulée)
--   testhand.role_actor  = qui agit (journalisé ; deploy/backoffice-role.sh y met utilisateur@hôte)
-- Rapport par `select` (lignes « section | ligne »), pour `psql -qAt -F ' | '`. Sans psql-isme :
-- exécutable par psql et par un pilote. Refus nominatifs (code non nul) : action inconnue, email
-- absent ou inconnu, migration 005 non journalisée. L'écriture et la ligne de journal
-- (backoffice_audit, source 'cli') sont dans la même transaction ; en simulation elles sont
-- annulées et le rapport se termine par « SIMULATION TERMINÉE ».
create temporary table role_report (n serial primary key, section text not null, line text not null);
do $$
declare
  action  text := coalesce(nullif(current_setting('testhand.role_action', true), ''), '');
  email_  text := coalesce(nullif(current_setting('testhand.role_email', true), ''), '');
  apply   boolean := coalesce(current_setting('testhand.role_apply', true), '') = '1';
  actor   text := coalesce(nullif(current_setting('testhand.role_actor', true), ''), 'inconnu');
  u       record;
  target  text;
  n       int;
  audit_id bigint;
begin
  if to_regclass('public.app_migrations') is null or not exists (select 1 from app_migrations where id = '005-backoffice') then
    raise exception 'refus : migration 005-backoffice non journalisée (users.role et backoffice_audit absents)';
  end if;

  if action = 'list' then
    n := 0;
    for u in select id, email, display_name, created_at from users where role = 'admin' order by email loop
      n := n + 1;
      insert into role_report (section, line) values ('admin', format('%s · %s · %s · créé le %s', u.email, u.display_name, u.id, to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'));
    end loop;
    insert into role_report (section, line) values ('compte', format('%s compte(s) admin sur %s', n, (select count(*) from users)));
    insert into role_report (section, line) values ('statut', 'LISTE TERMINÉE (aucune écriture)');
    return;
  end if;

  if action not in ('grant', 'revoke') then
    raise exception 'refus : action « % » inconnue (attendu : grant, revoke ou list)', action;
  end if;
  if email_ = '' then
    raise exception 'refus : testhand.role_email absent';
  end if;
  select id, email, display_name, role, password_hash is not null as has_password into u from users where lower(email) = lower(email_);
  if u.id is null then
    raise exception 'refus : aucun compte pour « % »', email_;
  end if;
  target := case action when 'grant' then 'admin' else 'user' end;
  insert into role_report (section, line) values ('compte', format('%s · %s · %s · rôle actuel : %s · mot de passe : %s', u.email, u.display_name, u.id, u.role, case when u.has_password then 'oui' else 'NON (compte OAuth seul : connexion au back-office impossible)' end));
  insert into role_report (section, line) values ('action', format('%s → rôle %s, par %s', action, target, actor));

  if u.role = target then
    insert into role_report (section, line) values ('effet', format('aucun : le compte est déjà « %s »', target));
    insert into role_report (section, line) values ('statut', case when apply then 'RIEN À APPLIQUER (rôle déjà en place, aucune écriture)' else 'SIMULATION TERMINÉE (rien écrit, rien à changer)' end);
    return;
  end if;

  begin
    update users set role = target where id = u.id;
    insert into backoffice_audit (actor_user_id, actor_email, action, target_user_id, detail, source)
      values (null, actor, 'role.' || action, u.id, jsonb_build_object('email', u.email, 'from', u.role, 'to', target), 'cli')
      returning id into audit_id;
    if not apply then
      raise exception using errcode = 'P0777';  -- simulation : sous-transaction annulée volontairement
    end if;
    insert into role_report (section, line) values ('effet', format('rôle « %s » → « %s », journal backoffice_audit #%s (role.%s, source cli)', u.role, target, audit_id, action));
    insert into role_report (section, line) values ('statut', format('APPLIQUÉ : %s est désormais « %s »', u.email, target));
  exception when sqlstate 'P0777' then
    insert into role_report (section, line) values ('effet', format('rôle « %s » → « %s » et une ligne de journal (role.%s, source cli) — annulés', u.role, target, action));
    insert into role_report (section, line) values ('statut', 'SIMULATION TERMINÉE (rien écrit) — relancer avec --apply pour écrire');
  end;
end $$;
select section || ' | ' || line from role_report order by n;
drop table role_report;
