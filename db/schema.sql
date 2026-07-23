-- Schéma de données — §A du document de référence. Normatif.
-- Exécuté automatiquement à l'init du conteneur Postgres (docker-entrypoint-initdb.d).

create extension if not exists pg_trgm;   -- recherche floue par nom (§6.1)
-- gen_random_uuid() est natif depuis Postgres 13, pas besoin de pgcrypto.

-- ─── Catalogue (copié depuis Supabase, lecture seule côté app) ───
create table if not exists cards (
  id                bigint primary key,   -- passcode YGOPRODeck
  name              text not null,
  type              text,                 -- Effect Monster, Spell Card, ...
  race              text,
  attribute         text,
  atk               int,
  def               int,
  level             int,
  description       text,
  image_url         text,
  image_url_small   text,
  image_url_cropped text
);
create index if not exists cards_name_trgm on cards using gin (lower(name) gin_trgm_ops);

-- NOTE (divergence assumée vs §A) : les colonnes `card_id` NE référencent PAS `cards`.
-- Le catalogue migré depuis Supabase est incomplet (certains passcodes récents manquent)
-- et, par conception, l'`id` EST le passcode : les images dérivent du CDN via l'id, le nom
-- n'est qu'un confort de recherche. Une FK catalogue bloquerait l'import d'un deck dès
-- qu'une carte manque au catalogue. Le catalogue est donc un LOOKUP, pas une contrainte.

-- ─── Decks ───
create table if not exists decks (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  summary     jsonb,                                   -- aperçu mis en cache (itération 4 C)
  notes       text,
  params      jsonb not null default '{}'::jsonb       -- paramètres de calcul locaux au deck
);
-- Idempotent pour les bases initialisées avant l'itération 4.
alter table decks add column if not exists summary jsonb;
alter table decks add column if not exists notes   text;
alter table decks add column if not exists params  jsonb not null default '{}'::jsonb;

create table if not exists deck_cards (
  deck_id  uuid not null references decks on delete cascade,
  card_id  bigint not null,   -- passcode (pas de FK catalogue, cf. note plus haut)
  zone     text not null check (zone in ('main','extra','side')),
  copies   smallint not null check (copies between 1 and 3),
  primary key (deck_id, card_id, zone)
);

-- ─── Bibliothèque globale (connaissance du jeu, transverse aux decks) ───
create table if not exists card_flags (
  card_id      bigint primary key,   -- passcode (pas de FK catalogue)
  is_hopt      boolean not null default false,
  dead_first   boolean not null default false,  -- Lot C : morte going first
  dead_second  boolean not null default false   -- Lot C : morte going second
);
-- Idempotent pour les bases déjà initialisées avant le Lot C.
alter table card_flags add column if not exists dead_first  boolean not null default false;
alter table card_flags add column if not exists dead_second boolean not null default false;

create table if not exists combo_pairs (
  id          uuid primary key default gen_random_uuid(),
  card_a_id   bigint not null,   -- passcode (pas de FK catalogue)
  card_b_id   bigint not null,
  note        text,
  check (card_a_id <= card_b_id),      -- canonicalisation
  unique (card_a_id, card_b_id)
);

create table if not exists nonengine_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,     -- 'Handtrap', 'Board breaker', ...
  relevance   text not null check (relevance in ('first','second','both')),
  is_builtin  boolean not null default false
);

create table if not exists card_categories (
  card_id      bigint not null,   -- passcode (pas de FK catalogue)
  category_id  uuid not null references nonengine_categories on delete cascade,
  primary key (card_id, category_id)
);

-- ─── Local au deck ───
create table if not exists deck_starters (              -- starters 1-carte
  deck_id  uuid not null references decks on delete cascade,
  card_id  bigint not null,   -- passcode (pas de FK catalogue)
  primary key (deck_id, card_id)
);

create table if not exists deck_pair_exclusions (       -- paires globales désactivées ici
  deck_id  uuid not null references decks on delete cascade,
  pair_id  uuid not null references combo_pairs on delete cascade,
  primary key (deck_id, pair_id)
);

-- ─── Retrait des FK catalogue pour les bases créées avant cette décision ───
alter table deck_cards      drop constraint if exists deck_cards_card_id_fkey;
alter table deck_starters   drop constraint if exists deck_starters_card_id_fkey;
alter table card_flags      drop constraint if exists card_flags_card_id_fkey;
alter table card_categories drop constraint if exists card_categories_card_id_fkey;
alter table combo_pairs     drop constraint if exists combo_pairs_card_a_id_fkey;
alter table combo_pairs     drop constraint if exists combo_pairs_card_b_id_fkey;

-- ─── Catégories fournies de base (§2.6) ───
insert into nonengine_categories (name, relevance, is_builtin) values
  ('Handtrap',      'both',   true),
  ('Board breaker', 'second', true)
on conflict (name) do nothing;
