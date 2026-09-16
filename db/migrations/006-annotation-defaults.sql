-- Annotations par défaut (docs/annotations-par-defaut.md §11) — cinquième profil de disponibilité
-- « réactive » (Q4 : tour adverse seul, type Droll). Additive et transactionnelle : aucune table
-- créée ni supprimée ici, aucune donnée migrée — seule la contrainte de valeurs de
-- `card_flags.availability` s'élargit. Indépendante de 003 : elle s'applique avant ou après la
-- purge et se rejoue sans effet.
--
-- CE FICHIER SERA ÉTENDU PAR LA PARTIE C du chantier (rôle `referent`, `card_references` et son
-- journal, `is_hopt` nullable, choix non-engine, groupe fourni de base « Mulcharmy », résumés à
-- NULL) AVANT TOUT DÉPLOIEMENT : ce qui est ici n'est que le socle de la partie B. C'est pourquoi
-- tout le DDL vit HORS du bloc qui journalise `006-annotation-defaults` et reste idempotent — un
-- rejeu sur une base ayant DÉJÀ journalisé 006 doit appliquer les ajouts de la partie C sans que
-- le journal l'en empêche (le journal note que la migration est passée, il ne garde pas ce
-- qu'elle contenait ce jour-là).
--
-- Aucun psql-isme : ce fichier s'exécute par psql (séquence de déploiement, initdb) comme par le
-- pilote pg.
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());

-- ─── Profil de disponibilité : cinquième valeur « reactive » ───
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
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'card_flags' and column_name = 'availability') then
    return;  -- 002 non appliquée : le bloc de journalisation ci-dessous refuse nominativement.
  end if;
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

do $$ begin
  if not exists (select 1 from app_migrations where id = '002-profiles-and-conditions') then
    raise exception 'Apply 002-profiles-and-conditions before 006-annotation-defaults';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_flags_availability_check') then
    raise exception '006-annotation-defaults : card_flags_availability_check absente après le DDL (card_flags.availability manquante ?)';
  end if;
  if not exists (select 1 from app_migrations where id = '006-annotation-defaults') then
    insert into app_migrations (id) values ('006-annotation-defaults');
  end if;
end $$;
commit;
