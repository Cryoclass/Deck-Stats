-- Jeu représentatif d'une base de PRODUCTION antérieure à la migration 001 (étape 8, 8A) :
-- schéma historique seul (db/schema.sql), aucune table de journal. Il s'applique sur une
-- base neuve après schema.sql, puis 001 → 002 → 003 sont jouées dessus par la suite
-- `purge.integration.ts` et par la répétition de 8B. Identifiants fixes (aucun
-- gen_random_uuid) pour des rapports et des empreintes reproductibles.
--
-- Deux comptes. Compte A : trois decks, trois paires globales (dont une exclue dans A2 et
-- une avec un prérequis source paire), prérequis source carte (deux sur la même source :
-- 002 en fait un groupe ET de deux feuilles), drapeaux dead_* et HOPT, trois catégories aux
-- trois pertinences. Compte B : un deck, une paire globale avec prérequis source paire.
-- Deck A3 ne contient les deux cartes d'aucune paire globale : son taux de départ ne doit
-- pas bouger après la purge (contrôle de recalcul de 8B).
-- `decks.summary` : seul `mainSize` est renseigné ici ; `startRateFirst` / `brickRate`
-- d'avant purge seront fabriqués en 8B par le moteur sur le modèle équivalent à l'ancien.

insert into cards (id, name, type, race, description) values
  (90000001, 'Starter Alpha', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000002, 'Starter Beta', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000003, 'Combo Gamma', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000004, 'Combo Delta', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000005, 'Handtrap Epsilon', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000006, 'Handtrap Zeta', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000007, 'Mulcharmy Eta', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000008, 'Mulcharmy Theta', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000009, 'Quick-Play Iota', 'Spell Card', 'Synthetic', 'Carte synthétique'),
  (90000010, 'Breaker Kappa', 'Spell Card', 'Synthetic', 'Carte synthétique'),
  (90000011, 'Filler Lambda', 'Normal Monster', 'Synthetic', 'Carte synthétique'),
  (90000012, 'Filler Mu', 'Normal Monster', 'Synthetic', 'Carte synthétique'),
  (90000013, 'Filler Nu', 'Normal Monster', 'Synthetic', 'Carte synthétique'),
  (90000014, 'Target Xi', 'Effect Monster', 'Synthetic', 'Carte synthétique'),
  (90000015, 'Filler Omicron', 'Normal Monster', 'Synthetic', 'Carte synthétique'),
  (90000016, 'Extra Pi', 'Fusion Monster', 'Synthetic', 'Carte synthétique'),
  (90000017, 'Side Rho', 'Trap Card', 'Synthetic', 'Carte synthétique'),
  (90000018, 'Filler Sigma', 'Normal Monster', 'Synthetic', 'Carte synthétique'),
  (90000019, 'Filler Tau', 'Normal Monster', 'Synthetic', 'Carte synthétique');
insert into catalog_version (only_row, version, copied_cards_count, local_cards_count, migrated_at)
  values (true, 'fixture-legacy', 19, 19, '2026-09-01T00:00:00Z');

insert into users (id, email, display_name, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@example.invalid', 'Compte A', '2026-08-01T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@example.invalid', 'Compte B', '2026-08-02T10:00:00Z');

insert into decks (id, owner_id, name, params, summary, notes, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'Deck A1',
   '{"horizonFirst":1,"horizonSecond":2,"importance":0.5}', '{"mainSize":40}', 'Deck de référence du compte A', '2026-08-03T10:00:00Z', '2026-08-20T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1', 'Deck A2',
   '{"horizonFirst":2}', '{"mainSize":40}', null, '2026-08-04T10:00:00Z', '2026-08-21T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a1', 'Deck A3',
   '{}', '{"mainSize":40}', null, '2026-08-05T10:00:00Z', '2026-08-22T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000b1', 'Deck B1',
   '{"horizonSecond":3,"savedQueries":[]}', '{"mainSize":40}', null, '2026-08-06T10:00:00Z', '2026-08-23T10:00:00Z');

-- Deck A1 et Deck B1 : même main de 40 cartes ; A2 = A1 avec une copie d'Alpha remplacée par Omicron.
insert into deck_cards (deck_id, card_id, zone, copies)
  select d, c, 'main', n from (values
    (90000001, 3), (90000002, 3), (90000003, 3), (90000004, 3), (90000005, 3), (90000006, 3), (90000007, 3),
    (90000008, 3), (90000009, 2), (90000010, 2), (90000011, 3), (90000012, 3), (90000013, 3), (90000014, 2), (90000015, 1)) as m (c, n)
  cross join (values ('00000000-0000-4000-8000-0000000000d1'::uuid), ('00000000-0000-4000-8000-0000000000d4'::uuid)) as k (d);
insert into deck_cards (deck_id, card_id, zone, copies) values
  ('00000000-0000-4000-8000-0000000000d1', 90000016, 'extra', 1),
  ('00000000-0000-4000-8000-0000000000d1', 90000017, 'side', 1);
insert into deck_cards (deck_id, card_id, zone, copies)
  select '00000000-0000-4000-8000-0000000000d2', c, 'main', n from (values
    (90000001, 2), (90000002, 3), (90000003, 3), (90000004, 3), (90000005, 3), (90000006, 3), (90000007, 3),
    (90000008, 3), (90000009, 2), (90000010, 2), (90000011, 3), (90000012, 3), (90000013, 3), (90000014, 2), (90000015, 2)) as m (c, n);
-- Deck A3 : aucune paire globale du compte n'y est active (ni Beta, ni Delta, ni Xi).
insert into deck_cards (deck_id, card_id, zone, copies)
  select '00000000-0000-4000-8000-0000000000d3', c, 'main', n from (values
    (90000001, 3), (90000003, 3), (90000005, 3), (90000006, 3), (90000007, 3), (90000008, 3), (90000009, 3),
    (90000010, 3), (90000011, 3), (90000012, 3), (90000013, 3), (90000015, 3), (90000018, 2), (90000019, 2)) as m (c, n);

insert into deck_starters (deck_id, card_id) values
  ('00000000-0000-4000-8000-0000000000d1', 90000001), ('00000000-0000-4000-8000-0000000000d1', 90000002),
  ('00000000-0000-4000-8000-0000000000d2', 90000001),
  ('00000000-0000-4000-8000-0000000000d3', 90000001), ('00000000-0000-4000-8000-0000000000d3', 90000003),
  ('00000000-0000-4000-8000-0000000000d4', 90000001);

-- Paires GLOBALES (modèle historique, par compte), notes comprises.
insert into combo_pairs (id, owner_id, card_a_id, card_b_id, note) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 90000001, 90000002, 'Alpha + Beta : ouverture principale'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 90000003, 90000004, null),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 90000001, 90000014, 'Alpha cherche Xi'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000b1', 90000001, 90000002, 'Paire B');
insert into deck_pair_exclusions (deck_id, pair_id) values
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001');

-- Prérequis historiques : source carte (convertis par 001 puis 002), source paire (purgés).
insert into deck_start_requirements (id, deck_id, source_card_id, source_pair_id, required_card_id, min_in_deck) values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000000d1', 90000001, null, 90000014, 1),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000000d1', 90000001, null, 90000003, 2),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000000d2', 90000002, null, 90000005, 1),
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-0000000000d1', null, '00000000-0000-4000-8000-000000000001', 90000014, 1),
  ('00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-0000000000d4', null, '00000000-0000-4000-8000-000000000004', 90000003, 1);

-- Bibliothèque du compte : HOPT, drapeaux dead_* (copiés par deck par 001), catégories
-- aux trois pertinences (dont les deux fournies de base), affectations.
insert into card_flags (owner_id, card_id, is_hopt, dead_first, dead_second) values
  ('00000000-0000-4000-8000-0000000000a1', 90000005, true, false, false),
  ('00000000-0000-4000-8000-0000000000a1', 90000006, true, false, false),
  ('00000000-0000-4000-8000-0000000000a1', 90000010, false, true, false),
  ('00000000-0000-4000-8000-0000000000a1', 90000009, false, false, true),
  ('00000000-0000-4000-8000-0000000000b1', 90000005, true, false, false);
insert into nonengine_categories (id, owner_id, name, relevance, is_builtin) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000a1', 'Handtrap', 'both', true),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000a1', 'Board breaker', 'second', true),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-0000000000a1', 'Quick', 'first', false),
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-0000000000b1', 'Handtrap', 'both', true),
  ('00000000-0000-4000-8000-00000000c005', '00000000-0000-4000-8000-0000000000b1', 'Board breaker', 'second', true);
insert into card_categories (card_id, category_id) values
  (90000005, '00000000-0000-4000-8000-00000000c001'), (90000006, '00000000-0000-4000-8000-00000000c001'),
  (90000007, '00000000-0000-4000-8000-00000000c001'), (90000008, '00000000-0000-4000-8000-00000000c001'),
  (90000010, '00000000-0000-4000-8000-00000000c002'), (90000009, '00000000-0000-4000-8000-00000000c003'),
  (90000005, '00000000-0000-4000-8000-00000000c004');
