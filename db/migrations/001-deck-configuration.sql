-- Additive transition. Legacy global pairs are retained for the step-8 purge.
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());
alter table decks add column if not exists revision integer not null default 0;

create table if not exists deck_combo_pairs (
  deck_id uuid not null references decks on delete cascade,
  id uuid not null,
  card_a_id bigint not null check (card_a_id > 0),
  card_b_id bigint not null check (card_b_id > card_a_id),
  note text,
  disabled boolean not null default false,
  primary key (deck_id, id),
  unique (deck_id, card_a_id, card_b_id)
);
create table if not exists deck_requirements (
  deck_id uuid not null references decks on delete cascade,
  id uuid not null,
  source_card_id bigint check (source_card_id > 0),
  source_pair_id uuid,
  required_card_id bigint not null check (required_card_id > 0),
  min_in_deck smallint not null check (min_in_deck >= 1),
  primary key (deck_id, id),
  foreign key (deck_id, source_pair_id) references deck_combo_pairs (deck_id, id) on delete cascade,
  check ((source_card_id is not null) <> (source_pair_id is not null))
);
create table if not exists deck_flags (
  deck_id uuid not null references decks on delete cascade,
  card_id bigint not null check (card_id > 0),
  dead_first boolean not null default false,
  dead_second boolean not null default false,
  primary key (deck_id, card_id)
);

do $$ begin
  if not exists (select 1 from app_migrations where id = '001-deck-configuration') then
    if exists (select 1 from decks where owner_id is null) or exists (select 1 from card_flags where owner_id is null) then
      raise exception 'Adopt legacy ownerless data before migrating deck configuration';
    end if;
    -- Preserve card-source requirements; never copy legacy pair sources.
    if exists (select 1 from deck_start_requirements where source_card_id is not null and
      (source_card_id <= 0 or required_card_id <= 0 or min_in_deck < 1)) then
      raise exception 'Invalid legacy card requirement: inspect before migrating';
    end if;
    insert into deck_requirements (deck_id,id,source_card_id,required_card_id,min_in_deck)
      select deck_id,id,source_card_id,required_card_id,min_in_deck
      from deck_start_requirements where source_card_id is not null;
    insert into deck_flags (deck_id,card_id,dead_first,dead_second)
      select d.id,f.card_id,f.dead_first,f.dead_second from decks d
      join card_flags f on f.owner_id=d.owner_id where f.dead_first or f.dead_second;
    -- A derived historical summary cannot certify the corrected model.
    update decks set summary=null;
    insert into app_migrations (id) values ('001-deck-configuration');
  end if;
end $$;
commit;
