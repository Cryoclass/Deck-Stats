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

-- ─── Comptes & sessions (itération 8, Lot A) ───
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  display_name   text not null,
  password_hash  text,                                  -- null = compte OAuth seul (Lot D)
  created_at     timestamptz not null default now()
);
-- Unicité insensible à la casse : l'email est identifiant de connexion.
create unique index if not exists users_email_unique on users (lower(email));

create table if not exists sessions (
  token_hash  bytea primary key,   -- SHA-256 du token opaque ; le clair ne touche JAMAIS la base
  user_id     uuid not null references users on delete cascade,
  expires_at  timestamptz not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user on sessions (user_id);

-- Identités OAuth (Lot D — Discord). Jamais de rattachement automatique par email.
create table if not exists user_identities (
  provider          text not null,      -- 'discord'
  provider_user_id  text not null,
  user_id           uuid not null references users on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (provider, provider_user_id)
);

-- ─── Decks ───
-- owner_id (itération 8, Lot B) : nullable sur une base legacy jusqu'à
-- `npm run adopt`, qui attribue l'existant puis pose le NOT NULL.
create table if not exists decks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users on delete cascade,
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
-- Idempotent pour les bases initialisées avant l'itération 8 (Lot B).
alter table decks add column if not exists owner_id uuid references users on delete cascade;
create index if not exists decks_owner on decks (owner_id);

create table if not exists deck_cards (
  deck_id  uuid not null references decks on delete cascade,
  card_id  bigint not null,   -- passcode (pas de FK catalogue, cf. note plus haut)
  zone     text not null check (zone in ('main','extra','side')),
  copies   smallint not null check (copies between 1 and 3),
  primary key (deck_id, card_id, zone)
);

-- ─── Bibliothèque (connaissance du jeu, transverse aux decks) ───
-- PAR COMPTE depuis l'itération 8 (Lot B) : chaque utilisateur a la sienne, le
-- partage passe par l'export/import JSON. Les clés d'unicité incluent owner_id ;
-- sur une base legacy, `npm run adopt` fait basculer les anciennes clés.
create table if not exists card_flags (
  owner_id     uuid not null references users on delete cascade,
  card_id      bigint not null,   -- passcode (pas de FK catalogue)
  is_hopt      boolean not null default false,
  dead_first   boolean not null default false,  -- Lot C : morte going first
  dead_second  boolean not null default false,  -- Lot C : morte going second
  primary key (owner_id, card_id)
);
-- Idempotent pour les bases déjà initialisées avant le Lot C.
alter table card_flags add column if not exists dead_first  boolean not null default false;
alter table card_flags add column if not exists dead_second boolean not null default false;
alter table card_flags add column if not exists owner_id uuid references users on delete cascade;

create table if not exists combo_pairs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users on delete cascade,
  card_a_id   bigint not null,   -- passcode (pas de FK catalogue)
  card_b_id   bigint not null,
  note        text,
  check (card_a_id <= card_b_id),      -- canonicalisation
  constraint combo_pairs_owner_pair unique (owner_id, card_a_id, card_b_id)
);
alter table combo_pairs add column if not exists owner_id uuid references users on delete cascade;

create table if not exists nonengine_categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users on delete cascade,
  name        text not null,     -- 'Handtrap', 'Board breaker', ...
  relevance   text not null check (relevance in ('first','second','both')),
  is_builtin  boolean not null default false,
  constraint nonengine_categories_owner_name unique (owner_id, name)
);
alter table nonengine_categories add column if not exists owner_id uuid references users on delete cascade;

-- Bascule idempotente des unicités legacy → par compte, jouable AVANT `npm run adopt` :
-- NULL est distinct dans un index unique, les lignes legacy (owner_id null) ne gênent
-- pas. Sans cette bascule, un register sur base legacy percuterait l'ancienne
-- unicité globale (ex. seed de 'Handtrap' vs la ligne legacy). Le PK de card_flags,
-- lui, exige NOT NULL et ne peut basculer que dans `adopt`.
alter table combo_pairs drop constraint if exists combo_pairs_card_a_id_card_b_id_key;
alter table nonengine_categories drop constraint if exists nonengine_categories_name_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'combo_pairs_owner_pair') then
    alter table combo_pairs
      add constraint combo_pairs_owner_pair unique (owner_id, card_a_id, card_b_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'nonengine_categories_owner_name') then
    alter table nonengine_categories
      add constraint nonengine_categories_owner_name unique (owner_id, name);
  end if;
end $$;

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

-- Prérequis en deck (itération 5) — LOCAUX au deck. Une source de start (starter
-- 1-carte OU paire de combo) exige ≥ min_in_deck copies d'une carte DANS LE DECK.
create table if not exists deck_start_requirements (
  id                uuid primary key default gen_random_uuid(),
  deck_id           uuid   not null references decks on delete cascade,
  source_card_id    bigint,                                        -- starter concerné (pas de FK catalogue)
  source_pair_id    uuid   references combo_pairs on delete cascade, -- ou paire concernée
  required_card_id  bigint not null,                               -- carte requise en deck
  min_in_deck       smallint not null default 1,
  check ((source_card_id is not null) <> (source_pair_id is not null)) -- exactement une source
);
create index if not exists dsr_deck on deck_start_requirements (deck_id);

-- ─── Retrait des FK catalogue pour les bases créées avant cette décision ───
alter table deck_cards      drop constraint if exists deck_cards_card_id_fkey;
alter table deck_starters   drop constraint if exists deck_starters_card_id_fkey;
alter table card_flags      drop constraint if exists card_flags_card_id_fkey;
alter table card_categories drop constraint if exists card_categories_card_id_fkey;
alter table combo_pairs     drop constraint if exists combo_pairs_card_a_id_fkey;
alter table combo_pairs     drop constraint if exists combo_pairs_card_b_id_fkey;

-- ─── Catégories fournies de base (§2.6) ───
-- Depuis l'itération 8 (Lot B), la bibliothèque est par compte : les deux
-- catégories de base ('Handtrap', 'Board breaker') ne sont plus seedées ici mais
-- créées pour CHAQUE compte à l'inscription (server/src/auth/account.ts).
