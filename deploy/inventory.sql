-- Inventaire avant migration (étape 8B) : effectifs par table, journal des migrations,
-- résumés des decks (que 001 met à NULL) et modèle historique (paires globales,
-- exclusions, prérequis source paire, que 003 purge) pour le contrôle de recalcul.
-- Sortie pour `psql -At -F <séparateur>`, une ligne par clé :
--   count:<table><sép><effectif>
--   journal<sép><ids journalisés séparés par des virgules, vide sinon>
--   summaries<sép><jsonb [{id, name, summary}] des decks>
--   legacy<sép><jsonb {pairs, exclusions, pair_requirements}>
-- Les jsonb tiennent sur une ligne ; aucun email ni nom de compte n'y figure. Une table
-- absente (base déjà purgée, base vide) donne une valeur vide, jamais une erreur.
-- Aucune écriture.
create temporary table inventory_rows (n serial primary key, k text not null, v text not null);
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('insert into inventory_rows (k, v) select %L, count(*)::text from %I', 'count:' || r.tablename, r.tablename);
  end loop;

  if to_regclass('public.app_migrations') is not null then
    execute $q$ insert into inventory_rows (k, v)
      select 'journal', coalesce((select string_agg(id, ',' order by id) from app_migrations), '') $q$;
  else
    insert into inventory_rows (k, v) values ('journal', '');
  end if;

  if to_regclass('public.decks') is not null then
    execute $q$ insert into inventory_rows (k, v)
      select 'summaries', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'summary', summary) order by id) from decks), '[]'::jsonb)::text $q$;
  else
    insert into inventory_rows (k, v) values ('summaries', '[]');
  end if;

  if to_regclass('public.combo_pairs') is not null and to_regclass('public.deck_pair_exclusions') is not null
     and to_regclass('public.deck_start_requirements') is not null then
    execute $q$ insert into inventory_rows (k, v)
      select 'legacy', jsonb_build_object(
        'pairs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'owner_id', owner_id, 'card_a_id', card_a_id, 'card_b_id', card_b_id) order by id)
                           from combo_pairs), '[]'::jsonb),
        'exclusions', coalesce((select jsonb_agg(jsonb_build_object('deck_id', deck_id, 'pair_id', pair_id) order by deck_id, pair_id)
                                from deck_pair_exclusions), '[]'::jsonb),
        'pair_requirements', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'deck_id', deck_id, 'pair_id', source_pair_id,
                                                                            'required_card_id', required_card_id, 'min_in_deck', min_in_deck) order by id)
                                       from deck_start_requirements where source_pair_id is not null), '[]'::jsonb))::text $q$;
  else
    insert into inventory_rows (k, v) values ('legacy', '{"pairs": [], "exclusions": [], "pair_requirements": []}');
  end if;
end $$;
select k, v from inventory_rows order by n;
drop table inventory_rows;
