-- Étape 8 — purge exacte des restes du modèle historique : paires globales
-- (`combo_pairs`, notes comprises), `deck_pair_exclusions`, `deck_start_requirements`
-- (source carte convertie par 001, source paire jamais copiée), `deck_requirements`
-- (v2 intermédiaire convertie par 002), `nonengine_categories.relevance` (sans effet
-- depuis 5B) et `card_flags.dead_first` / `dead_second` (copiés par deck par 001).
-- Une transaction, verrou consultatif, journal `app_migrations`, aucun psql-isme :
-- le fichier s'exécute aussi bien par psql (stdin) que par le pilote pg des tests.
--
-- Modes, par GUC de session posée AVANT le fichier :
--   set testhand.purge_mode = 'simulate'  → tout est joué (contrôles, rapport, suppressions,
--       contrôles après) dans une sous-transaction annulée VOLONTAIREMENT ; la migration se
--       termine normalement (code 0) sur la ligne « SIMULATION TERMINÉE ». Rien ne change.
--   set testhand.purge_accept = '<empreinte>' → mode réel : exigée dès qu'une ligne est
--       purgée, égale à l'empreinte du rapport de simulation (purge exacte annoncée :
--       une donnée apparue depuis change l'empreinte et bloque). Rien à purger = aucune
--       acceptation requise (base neuve).
-- Refus, par exception (transaction annulée, rien ne change) : 001 ou 002 non journalisée ;
-- prérequis historique source carte absent de deck_requirements ; prérequis v2 sans
-- condition pour sa source ; horizon encore présent dans decks.params ; empreinte absente
-- ou différente ; après journalisation, objet historique réapparu.
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());
create temporary table purge_report (n serial primary key, section text not null, line text not null) on commit drop;

create or replace function pg_temp.card_label(bigint) returns text language sql stable as $f$
  select $1::text || ' « ' || coalesce((select name from cards where id = $1), 'hors catalogue') || ' »'
$f$;
create or replace function pg_temp.deck_label(uuid) returns text language sql stable as $f$
  select 'deck ' || $1::text || ' « ' || coalesce((select name from decks where id = $1), '?') || ' »'
$f$;
-- Effectifs des tables CONSERVÉES : identiques avant et après, sinon refus.
create or replace function pg_temp.kept_counts() returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'users', (select count(*) from users), 'sessions', (select count(*) from sessions),
    'user_identities', (select count(*) from user_identities), 'cards', (select count(*) from cards),
    'catalog_version', (select count(*) from catalog_version), 'decks', (select count(*) from decks),
    'deck_cards', (select count(*) from deck_cards), 'deck_starters', (select count(*) from deck_starters),
    'deck_combo_pairs', (select count(*) from deck_combo_pairs), 'deck_conditions', (select count(*) from deck_conditions),
    'deck_flags', (select count(*) from deck_flags), 'card_flags', (select count(*) from card_flags),
    'nonengine_categories', (select count(*) from nonengine_categories), 'card_categories', (select count(*) from card_categories),
    'nonengine_groups', (select count(*) from nonengine_groups))
$f$;
-- Objets historiques encore présents (NULL = purge effective).
create or replace function pg_temp.legacy_objects() returns text language sql stable as $f$
  select string_agg(obj, ', ' order by obj) from (
    select 'table ' || t as obj from unnest(array['combo_pairs','deck_pair_exclusions','deck_start_requirements','deck_requirements']) as t
     where to_regclass('public.' || t) is not null
    union all
    select 'colonne ' || table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public' and ((table_name = 'nonengine_categories' and column_name = 'relevance')
        or (table_name = 'card_flags' and column_name in ('dead_first', 'dead_second')))) x
$f$;

do $$
declare
  mode text := coalesce(nullif(current_setting('testhand.purge_mode', true), ''), 'apply');
  accept text := nullif(current_setting('testhand.purge_accept', true), '');
  bad text;
  n_bad int;
  fp text;
  n_purge int;
  before_counts jsonb;
  after_counts jsonb;
  simulated boolean := false;
  rep record;
begin
  -- ── Rejeu : la purge est définitive, aucun objet ne doit être réapparu ──
  if exists (select 1 from app_migrations where id = '003-purge-legacy') then
    bad := pg_temp.legacy_objects();
    if bad is not null then
      raise exception '003-purge-legacy est journalisée mais un objet historique est réapparu (rejeu d''un ancien schema.sql ?) : %', bad;
    end if;
    insert into purge_report (section, line) values ('statut', '003-purge-legacy déjà appliquée : aucun effet.');
    raise notice '[003 statut] 003-purge-legacy déjà appliquée : aucun effet.';
    return;
  end if;

  -- ── Préalables ──
  if mode not in ('apply', 'simulate') then
    raise exception 'testhand.purge_mode invalide : « % » (attendu : apply ou simulate)', mode;
  end if;
  if not exists (select 1 from app_migrations where id = '001-deck-configuration')
     or not exists (select 1 from app_migrations where id = '002-profiles-and-conditions') then
    raise exception 'Apply 001-deck-configuration and 002-profiles-and-conditions before 003-purge-legacy';
  end if;
  select string_agg(t, ', ') into bad
    from unnest(array['combo_pairs','deck_pair_exclusions','deck_start_requirements','deck_requirements',
                      'deck_combo_pairs','deck_conditions','deck_flags','nonengine_groups']) as t
   where to_regclass('public.' || t) is null;
  if bad is not null then
    raise exception 'Tables attendues absentes : % — rejouer db/schema.sql puis 001 et 002 avant 003', bad;
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
        and ((table_name = 'nonengine_categories' and column_name = 'relevance')
          or (table_name = 'card_flags' and column_name in ('dead_first', 'dead_second')))) <> 3 then
    raise exception 'Colonnes historiques attendues absentes (relevance, dead_first, dead_second) — rejouer db/schema.sql avant 003';
  end if;

  -- ── Refus : donnée non convertie (jamais de perte silencieuse, lignes nommées) ──
  select count(*), string_agg(format('  %s : prérequis historique %s, source carte %s exige %s × %s',
           pg_temp.deck_label(r.deck_id), r.id, pg_temp.card_label(r.source_card_id), pg_temp.card_label(r.required_card_id), r.min_in_deck),
           E'\n' order by r.deck_id, r.id)
    into n_bad, bad
    from deck_start_requirements r
   where r.source_card_id is not null
     and not exists (select 1 from deck_requirements q where q.deck_id = r.deck_id and q.id = r.id);
  if n_bad > 0 then
    raise exception E'003 refusée : % prérequis historique(s) source carte jamais converti(s) par 001 (id absent de deck_requirements). Rien n''est supprimé :\n%', n_bad, bad;
  end if;

  select count(*), string_agg(format('  %s : prérequis v2 %s, source %s exige %s × %s',
           pg_temp.deck_label(q.deck_id), q.id,
           coalesce('carte ' || pg_temp.card_label(q.source_card_id), 'paire locale ' || q.source_pair_id::text),
           pg_temp.card_label(q.required_card_id), q.min_in_deck),
           E'\n' order by q.deck_id, q.id)
    into n_bad, bad
    from deck_requirements q
   where not exists (select 1 from deck_conditions c where c.deck_id = q.deck_id
                        and c.source_card_id is not distinct from q.source_card_id
                        and c.source_pair_id is not distinct from q.source_pair_id);
  if n_bad > 0 then
    raise exception E'003 refusée : % prérequis v2 sans condition ET/OU pour sa source (non converti par 002, ou condition retirée depuis). Rien n''est supprimé :\n%', n_bad, bad;
  end if;

  select count(*), string_agg(format('  %s : params = %s', pg_temp.deck_label(d.id), d.params::text), E'\n' order by d.id)
    into n_bad, bad
    from decks d where d.params ? 'horizonFirst' or d.params ? 'horizonSecond';
  if n_bad > 0 then
    raise exception E'003 refusée : % deck(s) portent encore un horizon dans params (002 aurait dû le retirer). Rien n''est supprimé :\n%', n_bad, bad;
  end if;

  -- ── Rapport : ce qui sera purgé, ligne par ligne ──
  insert into purge_report (section, line)
    select 'compte', format('compte %s : %s paire(s) globale(s), %s exclusion(s), %s prérequis source paire, %s deck(s)',
             u.id, p.n, e.n, r.n, (select count(*) from decks d where d.owner_id = u.id))
      from users u
      cross join lateral (select count(*) as n from combo_pairs p where p.owner_id = u.id) p
      cross join lateral (select count(*) as n from deck_pair_exclusions e join decks d on d.id = e.deck_id where d.owner_id = u.id) e
      cross join lateral (select count(*) as n from deck_start_requirements r join decks d on d.id = r.deck_id where d.owner_id = u.id and r.source_pair_id is not null) r
     where p.n > 0 or e.n > 0 or r.n > 0
     order by u.id;
  insert into purge_report (section, line)
    select 'P1', format('compte %s · paire %s : %s + %s · %s · exclue dans %s deck(s) · %s prérequis source paire',
             p.owner_id, p.id, pg_temp.card_label(p.card_a_id), pg_temp.card_label(p.card_b_id),
             coalesce('note : « ' || regexp_replace(p.note, E'[\\r\\n]+', ' ', 'g') || ' »', 'sans note'),
             (select count(*) from deck_pair_exclusions e where e.pair_id = p.id),
             (select count(*) from deck_start_requirements r where r.source_pair_id = p.id))
      from combo_pairs p order by p.owner_id, p.card_a_id, p.card_b_id, p.id;
  insert into purge_report (section, line)
    select 'P2', format('%s (compte %s) : exclut la paire %s', pg_temp.deck_label(e.deck_id), d.owner_id, e.pair_id)
      from deck_pair_exclusions e join decks d on d.id = e.deck_id order by d.owner_id, e.deck_id, e.pair_id;
  insert into purge_report (section, line)
    select 'P3', format('%s : prérequis historique %s, source paire %s exige %s × %s · supprimé avec la paire',
             pg_temp.deck_label(r.deck_id), r.id, r.source_pair_id, pg_temp.card_label(r.required_card_id), r.min_in_deck)
      from deck_start_requirements r where r.source_pair_id is not null order by r.deck_id, r.id;
  insert into purge_report (section, line)
    select 'P4', format('%s : prérequis v2 %s (%s), source %s exige %s × %s → condition %s · table supprimée, condition conservée',
             pg_temp.deck_label(q.deck_id), q.id,
             case when exists (select 1 from deck_start_requirements r where r.id = q.id) then 'origine : prérequis historique converti par 001' else 'origine : API v2' end,
             coalesce('carte ' || pg_temp.card_label(q.source_card_id), 'paire locale ' || q.source_pair_id::text),
             pg_temp.card_label(q.required_card_id), q.min_in_deck,
             (select c.id from deck_conditions c where c.deck_id = q.deck_id
                and c.source_card_id is not distinct from q.source_card_id and c.source_pair_id is not distinct from q.source_pair_id))
      from deck_requirements q order by q.deck_id, q.id;
  insert into purge_report (section, line)
    select 'P5', format('catégorie %s « %s » (compte %s) : relevance = %s · colonne supprimée', c.id, c.name, c.owner_id, c.relevance)
      from nonengine_categories c order by c.owner_id, c.name, c.id;
  insert into purge_report (section, line)
    select 'P6', format('compte %s · carte %s : dead_first = %s, dead_second = %s · copiés par deck par 001, colonnes supprimées',
             f.owner_id, pg_temp.card_label(f.card_id), f.dead_first::text, f.dead_second::text)
      from card_flags f where f.dead_first or f.dead_second order by f.owner_id, f.card_id;

  before_counts := pg_temp.kept_counts();
  insert into purge_report (section, line) values
    ('avant', format('combo_pairs : %s', (select count(*) from combo_pairs))),
    ('avant', format('deck_pair_exclusions : %s', (select count(*) from deck_pair_exclusions))),
    ('avant', format('deck_start_requirements : %s (source carte %s, source paire %s)', (select count(*) from deck_start_requirements),
       (select count(*) from deck_start_requirements where source_card_id is not null), (select count(*) from deck_start_requirements where source_pair_id is not null))),
    ('avant', format('deck_requirements : %s', (select count(*) from deck_requirements))),
    ('avant', format('nonengine_categories.relevance : first %s, second %s, both %s',
       (select count(*) from nonengine_categories where relevance = 'first'), (select count(*) from nonengine_categories where relevance = 'second'),
       (select count(*) from nonengine_categories where relevance = 'both'))),
    ('avant', format('card_flags.dead_first / dead_second vrais : %s', (select count(*) from card_flags where dead_first or dead_second)));
  insert into purge_report (section, line)
    select 'avant', key || ' : ' || value from jsonb_each_text(before_counts) order by key;

  select count(*) into n_purge from purge_report where section in ('P1', 'P2', 'P3', 'P5', 'P6');
  select md5(coalesce(string_agg(line, E'\n' order by n), '')) into fp
    from purge_report where section in ('P1', 'P2', 'P3', 'P4', 'P5', 'P6');
  insert into purge_report (section, line) values
    ('résumé', format('à purger : %s ligne(s) — P1 paires %s, P2 exclusions %s, P3 prérequis source paire %s, P5 pertinences %s, P6 drapeaux %s ; P4 prérequis v2 convertis retirés avec leur table : %s',
       n_purge,
       (select count(*) from purge_report where section = 'P1'), (select count(*) from purge_report where section = 'P2'),
       (select count(*) from purge_report where section = 'P3'), (select count(*) from purge_report where section = 'P5'),
       (select count(*) from purge_report where section = 'P6'), (select count(*) from purge_report where section = 'P4'))),
    ('empreinte', 'empreinte du rapport : ' || fp);

  -- ── Point de non-retour : acceptation explicite du rapport ──
  if mode = 'apply' and n_purge > 0 and accept is distinct from fp then
    for rep in select section, line from purge_report order by n loop
      raise notice '[003 %] %', rep.section, rep.line;
    end loop;
    raise exception 'Purge non acceptée : % ligne(s) seraient supprimées (rapport ci-dessus). Rejouer en simulation (set testhand.purge_mode = ''simulate''), relire le rapport, puis appliquer avec set testhand.purge_accept = ''<empreinte du rapport>'' (fournie : %).',
      n_purge, coalesce(accept, 'aucune');
  end if;

  -- ── Purge, dans une sous-transaction annulée volontairement en simulation ──
  begin
    delete from deck_start_requirements where source_pair_id is not null;
    delete from deck_pair_exclusions;
    delete from combo_pairs;
    drop table deck_pair_exclusions;
    drop table deck_start_requirements;
    drop table deck_requirements;
    drop table combo_pairs;
    alter table card_flags drop column dead_first, drop column dead_second;
    alter table nonengine_categories drop column relevance;

    after_counts := pg_temp.kept_counts();
    if after_counts <> before_counts then
      raise exception 'Contrôle après purge : effectif d''une table conservée modifié — avant %, après %', before_counts, after_counts;
    end if;
    bad := pg_temp.legacy_objects();
    if bad is not null then
      raise exception 'Contrôle après purge : objet historique encore présent : %', bad;
    end if;
    insert into app_migrations (id) values ('003-purge-legacy');
    if mode = 'simulate' then
      raise exception using errcode = 'TH003', message = 'simulation : annulation volontaire de la sous-transaction';
    end if;
  exception when sqlstate 'TH003' then
    simulated := true;
  end;

  insert into purge_report (section, line)
    select 'après', key || ' : ' || value from jsonb_each_text(after_counts) order by key;
  insert into purge_report (section, line) values
    ('après', 'combo_pairs, deck_pair_exclusions, deck_start_requirements, deck_requirements : ' || case when simulated then 'seraient supprimées' else 'supprimées' end),
    ('après', 'nonengine_categories.relevance, card_flags.dead_first, card_flags.dead_second : ' || case when simulated then 'seraient supprimées' else 'supprimées' end),
    ('statut', case when simulated
       then 'SIMULATION TERMINÉE : purge jouée puis annulée volontairement, aucune modification. Pour appliquer : set testhand.purge_accept = ''' || fp || ''' puis rejouer ce fichier sans testhand.purge_mode.'
       else 'PURGE APPLIQUÉE : 003-purge-legacy journalisée, ' || n_purge || ' ligne(s) supprimée(s), empreinte ' || fp || '.' end);
  for rep in select section, line from purge_report order by n loop
    raise notice '[003 %] %', rep.section, rep.line;
  end loop;
end $$;

select section, line from purge_report order by n;
commit;
