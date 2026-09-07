-- Étape 5B — profils de disponibilité, plafonds partagés (compte) et conditions ET/OU
-- (deck). Additive et transactionnelle : aucune table historique supprimée.
-- `deck_requirements` (prérequis ET plats de la v2) est conservée mais n'est plus lue
-- ni écrite par l'API après cette migration ; sa purge relève de l'étape 8.
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());

-- Plafonds partagés par tour, communs aux decks du compte (contrat §1 et §3).
create table if not exists nonengine_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users on delete cascade,
  name text not null check (length(name) between 1 and 200),
  cap_per_turn smallint not null check (cap_per_turn >= 1),
  constraint nonengine_groups_owner_name unique (owner_id, name)
);

-- Profil de disponibilité et groupe de plafond : annotations manuelles du compte, sur
-- la ligne de drapeaux existante (owner_id, card_id). Aucun profil n'est déduit des
-- anciens labels (Q4 : redéfinition manuelle) ; un groupe exige un profil (Q2).
alter table card_flags add column if not exists availability text
  check (availability in ('early', 'flexible', 'prepared', 'breaker'));
alter table card_flags add column if not exists group_id uuid references nonengine_groups on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'card_flags_group_requires_profile') then
    alter table card_flags add constraint card_flags_group_requires_profile
      check (group_id is null or availability is not null);
  end if;
end $$;
create index if not exists card_flags_group on card_flags (group_id);

-- Une condition ET/OU par source de start, locale au deck (contrat §4, Q3).
-- `condition` : arbre JSON { kind: 'remaining', card_id, at_least } | { kind: 'and', all }
-- | { kind: 'or', any }, validé par le contrat de domaine avant toute écriture.
create table if not exists deck_conditions (
  deck_id uuid not null references decks on delete cascade,
  id uuid not null,
  source_card_id bigint check (source_card_id > 0),
  source_pair_id uuid,
  condition jsonb not null,
  primary key (deck_id, id),
  foreign key (deck_id, source_pair_id) references deck_combo_pairs (deck_id, id) on delete cascade,
  check ((source_card_id is not null) <> (source_pair_id is not null)),
  unique (deck_id, source_card_id),
  unique (deck_id, source_pair_id)
);

do $$ begin
  if not exists (select 1 from app_migrations where id = '002-profiles-and-conditions') then
    if not exists (select 1 from app_migrations where id = '001-deck-configuration') then
      raise exception 'Apply 001-deck-configuration before 002-profiles-and-conditions';
    end if;
    if exists (select 1 from deck_requirements where required_card_id <= 0 or min_in_deck < 1) then
      raise exception 'Invalid v2 requirement: inspect before migrating';
    end if;
    -- Q3 : chaque ancien prérequis devient une feuille d'un groupe ET par source, dans
    -- l'ordre des identifiants ; l'identifiant de la première feuille nomme la condition.
    insert into deck_conditions (deck_id, id, source_card_id, source_pair_id, condition)
      select deck_id,
             (array_agg(id order by id))[1],
             source_card_id,
             source_pair_id,
             jsonb_build_object('kind', 'and', 'all',
               jsonb_agg(jsonb_build_object('kind', 'remaining', 'card_id', required_card_id, 'at_least', min_in_deck) order by id))
      from deck_requirements
      group by deck_id, source_card_id, source_pair_id;
    -- Les horizons 1–3 ne définissent plus la chronologie (contrat §3) : retirés des paramètres.
    update decks set params = params - 'horizonFirst' - 'horizonSecond'
      where params ? 'horizonFirst' or params ? 'horizonSecond';
    -- Les statistiques dérivées ne certifient pas le nouveau modèle (Q5 : cartes
    -- étiquetées sans profil non comptées) : invalidées pour tous les decks.
    update decks set summary = null;
    insert into app_migrations (id) values ('002-profiles-and-conditions');
  end if;
end $$;
commit;
