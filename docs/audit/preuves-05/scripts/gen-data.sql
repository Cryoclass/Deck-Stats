-- Jeu synthétique pour l'audit 05 (base jetable testhand-audit05-db uniquement).
-- 1 000 comptes, 20 decks chacun, volumes par deck calqués sur un deck compétitif annoté.
\set ON_ERROR_STOP 1
select setseed(0.42);

-- Catalogue : 14 529 cartes (effectif du catalogue réel, audit 03), noms pseudo-aléatoires.
insert into cards (id, name, type, description)
select 10000000 + g, 'Card ' || substr(md5(g::text), 1, 12) || ' ' || substr(md5((g * 7)::text), 1, 8), 'Effect Monster', repeat('effet ', 40)
from generate_series(1, 14529) g;
insert into catalog_version (version, copied_cards_count, local_cards_count) values ('audit05', 14529, 14529);

insert into users (id, email, display_name, password_hash)
select gen_random_uuid(), 'u' || g || '@audit05.test', 'u' || g, null from generate_series(1, 1000) g;

-- Sessions : jeton clair 'tok<n>' (le serveur hache le cookie en SHA-256), 2 par compte.
insert into sessions (token_hash, user_id, expires_at, user_agent)
select sha256(convert_to('tok' || row_number() over (order by u.email) || '-' || s, 'UTF8')), u.id, now() + interval '20 days', 'audit05'
from users u, generate_series(1, 2) s;

-- Bibliothèque par compte.
insert into nonengine_categories (owner_id, name, is_builtin)
select u.id, c.name, c.builtin from users u, (values ('Handtrap', true), ('Board breaker', true), ('Perso 1', false), ('Perso 2', false), ('Perso 3', false)) c(name, builtin);
insert into nonengine_groups (owner_id, name, cap_per_turn)
select u.id, 'Plafond ' || g, 2 from users u, generate_series(1, 2) g;
insert into card_categories (card_id, category_id)
select distinct on (cid, c.id) cid, c.id
from nonengine_categories c, lateral (select 10000000 + 1 + floor(random() * 14529)::int as cid from generate_series(1, 8)) x;
insert into card_flags (owner_id, card_id, is_hopt, availability)
select u.id, 10000000 + 1 + floor(random() * 14529)::int, random() < 0.7, null
from users u, generate_series(1, 60) on conflict do nothing;

-- Decks : 20 par compte.
insert into decks (id, owner_id, name, revision, params, summary)
select gen_random_uuid(), u.id, 'Deck ' || d, 1, '{"importance":0.5}', null from users u, generate_series(1, 20) d;

-- Composition : 20 cartes distinctes au main (2 copies = 40), 15 en extra, 10 en side.
insert into deck_cards (deck_id, card_id, zone, copies)
select d.id, 10000000 + 1 + floor(random() * 14529)::int, z.zone, z.copies
from decks d, (select 'main' as zone, 2 as copies, generate_series(1, 20) union all select 'extra', 1, generate_series(1, 15) union all select 'side', 1, generate_series(1, 10)) z
on conflict do nothing;
insert into deck_starters (deck_id, card_id)
select deck_id, card_id from (select deck_id, card_id, row_number() over (partition by deck_id order by card_id) rn from deck_cards where zone = 'main') t where rn <= 8;
insert into deck_combo_pairs (deck_id, id, card_a_id, card_b_id, note, disabled)
select a.deck_id, gen_random_uuid(), a.card_id, b.card_id, null, false
from (select deck_id, card_id, row_number() over (partition by deck_id order by card_id) rn from deck_cards where zone = 'main') a
join (select deck_id, card_id, row_number() over (partition by deck_id order by card_id) rn from deck_cards where zone = 'main') b
  on a.deck_id = b.deck_id and b.rn = a.rn + 1 and a.rn between 9 and 18;
insert into deck_conditions (deck_id, id, source_card_id, source_pair_id, condition)
select deck_id, gen_random_uuid(), card_id, null, jsonb_build_object('kind', 'and', 'all', jsonb_build_array(jsonb_build_object('kind', 'remaining', 'card_id', card_id + 1, 'at_least', 1)))
from (select deck_id, card_id, row_number() over (partition by deck_id order by card_id) rn from deck_starters) t where rn <= 4;
insert into deck_flags (deck_id, card_id, dead_first, dead_second)
select deck_id, card_id, true, false from (select deck_id, card_id, row_number() over (partition by deck_id order by card_id desc) rn from deck_cards where zone = 'main') t where rn <= 3;
insert into deck_matchups (deck_id, id, name, sort_index)
select d.id, gen_random_uuid(), 'Adversaire ' || m, m from decks d, generate_series(1, 5) m;
insert into deck_side_plans (deck_id, matchup_id, position, note, summary)
select m.deck_id, m.id, p.position, null, null from deck_matchups m, (values ('first'), ('second')) p(position);
insert into deck_side_plan_cards (deck_id, matchup_id, position, card_id, direction, copies)
select p.deck_id, p.matchup_id, p.position, 10000000 + 1 + floor(random() * 14529)::int, dir, 1
from deck_side_plans p, (values ('out'), ('in')) dd(dir), generate_series(1, 3)
on conflict do nothing;

analyze;
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc;
select pg_size_pretty(pg_database_size('ygo')) as taille_base;
