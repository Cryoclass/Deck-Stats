-- Plans d'exécution des requêtes chaudes, copiées des routes (base jetable, 1 000 comptes).
\set ON_ERROR_STOP 1
\pset pager off
select u.id as uid from users u where email = 'u500@audit05.test' \gset
select d.id as did from decks d where owner_id = :'uid' order by name limit 1 \gset
select card_id as cid from deck_cards where deck_id = :'did' and zone = 'main' limit 1 \gset
select c.id as catid from nonengine_categories c where owner_id = :'uid' and name = 'Perso 1' \gset

\echo '=== [A] resolveSession (session.ts:64-69)'
explain (analyze, buffers, costs off, timing on)
select u.id, u.email, u.display_name, s.expires_at from sessions s join users u on u.id = s.user_id where s.token_hash = sha256(convert_to('tok500-1', 'UTF8'));

\echo '=== [B] GET /api/decks (decks.ts:85-89)'
explain (analyze, buffers, costs off, timing on)
select d.id,d.name,d.created_at,d.updated_at,d.revision,d.summary,
       coalesce(sum(dc.copies) filter (where dc.zone='main'),0)::int as main_count,
       coalesce((select array_agg(card_id) from (select card_id from deck_cards where deck_id=d.id and zone='main' order by card_id limit 8) t),'{}') as sample_cards
from decks d left join deck_cards dc on dc.deck_id=d.id where d.owner_id=:'uid' group by d.id order by d.updated_at desc;

\echo '=== [C] GET /api/library — affectations (library.ts:39)'
explain (analyze, buffers, costs off, timing on)
select cc.card_id,cc.category_id from card_categories cc join nonengine_categories c on c.id=cc.category_id where c.owner_id=:'uid';

\echo '=== [D] invalidateOwnerSummaries avec carte (library.ts:17)'
begin;
explain (analyze, buffers, costs off, timing on)
update decks set summary=null where owner_id=:'uid' and summary is not null and id in (select deck_id from deck_cards where card_id=:cid);
rollback;

\echo '=== [E] PUT /library/flags — étiquette présente ? (library.ts:76)'
explain (analyze, buffers, costs off, timing on)
select 1 from card_categories cc join nonengine_categories n on n.id=cc.category_id where n.owner_id=:'uid' and cc.card_id=:cid limit 1;

\echo '=== [F] DELETE /library/categories/:id — cascade vers card_categories (library.ts:116)'
begin;
explain (analyze, buffers, costs off, timing on)
delete from nonengine_categories where id=:'catid' and owner_id=:'uid' and not is_builtin returning id;
rollback;

\echo '=== [G] recherche catalogue, 2 caractères (cards.ts:36-41)'
explain (analyze, buffers, costs off, timing on)
select id, name, type, race, attribute, atk, def, level, description, image_url, image_url_small, image_url_cropped from cards
where lower(name) like '%' || lower('ab') || '%' order by (lower(name) = lower('ab')) desc, length(name) asc, name asc limit 30;

\echo '=== [H] recherche catalogue, 5 caractères'
explain (analyze, buffers, costs off, timing on)
select id, name, type, race, attribute, atk, def, level, description, image_url, image_url_small, image_url_cropped from cards
where lower(name) like '%' || lower('card a') || '%' order by (lower(name) = lower('card a')) desc, length(name) asc, name asc limit 30;

\echo '=== [I] suppression d’un compte (cascade complète, route future RGPD)'
begin;
explain (analyze, buffers, costs off, timing on)
delete from users where id=:'uid';
rollback;

\echo '=== [J] sessions expirées : purge éventuelle (aucun index sur expires_at)'
explain (analyze, buffers, costs off, timing on)
select count(*) from sessions where expires_at < now();

\echo '=== tailles'
select relname, pg_size_pretty(pg_total_relation_size(relid)) as total, pg_size_pretty(pg_indexes_size(relid)) as index from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8;
select indexrelname, idx_scan from pg_stat_user_indexes order by relname, indexrelname;
