-- Contrôles après migration (étape 8B, point 5) : une ligne par contrôle, « OK|… » ou
-- « KO|… », pour `psql -At`. Aucune écriture. lib.sh (check_after_migration) y ajoute la
-- comparaison des empreintes avant / après ; une seule ligne KO arrête deploy.sh, app
-- laissée arrêtée, commande de restauration affichée. Toute référence à une table
-- potentiellement absente passe par du SQL dynamique : jamais d'erreur, seulement un KO.
create temporary table check_rows (n serial primary key, line text not null);
do $$
declare
  ok boolean;
  n bigint;
  t text;
  names text[];
begin
  -- Journal : 001, 002 et 003 journalisées.
  foreach t in array array['001-deck-configuration', '002-profiles-and-conditions', '003-purge-legacy'] loop
    if to_regclass('public.app_migrations') is null then ok := false;
    else execute 'select exists (select 1 from app_migrations where id = $1)' into ok using t; end if;
    insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|journal ' || t || (case when ok then ' : journalisée' else ' : ABSENTE du journal' end));
  end loop;

  -- Objets historiques : les quatre tables et les trois colonnes ont disparu.
  foreach t in array array['combo_pairs', 'deck_pair_exclusions', 'deck_start_requirements', 'deck_requirements'] loop
    ok := to_regclass('public.' || t) is null;
    insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|table historique ' || t || (case when ok then ' : absente' else ' : ENCORE PRÉSENTE' end));
  end loop;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and ((table_name = 'nonengine_categories' and column_name = 'relevance')
      or (table_name = 'card_flags' and column_name in ('dead_first', 'dead_second')));
  insert into check_rows (line) values ((case when n = 0 then 'OK' else 'KO' end) || '|colonnes historiques (relevance, dead_first, dead_second) : ' || n || ' présente(s), 0 attendue');

  -- Objets v2 : tables et colonnes que la nouvelle app lit.
  foreach t in array array['deck_combo_pairs', 'deck_conditions', 'deck_flags', 'nonengine_groups', 'deck_cards', 'deck_starters', 'card_flags', 'nonengine_categories', 'card_categories'] loop
    ok := to_regclass('public.' || t) is not null;
    insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|table v2 ' || t || (case when ok then ' : présente' else ' : ABSENTE' end));
  end loop;
  foreach t in array array['decks.revision', 'card_flags.availability', 'card_flags.group_id', 'decks.params', 'decks.summary'] loop
    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = split_part(t, '.', 1) and column_name = split_part(t, '.', 2);
    insert into check_rows (line) values ((case when n = 1 then 'OK' else 'KO' end) || '|colonne v2 ' || t || (case when n = 1 then ' : présente' else ' : ABSENTE' end));
  end loop;

  -- Données : plus aucun horizon dans decks.params ; chaque condition a exactement une source.
  if to_regclass('public.decks') is not null then
    execute $q$ select count(*) from decks where params ? 'horizonFirst' or params ? 'horizonSecond' $q$ into n;
    insert into check_rows (line) values ((case when n = 0 then 'OK' else 'KO' end) || '|decks portant encore un horizon dans params : ' || n || ', 0 attendu');
    execute $q$ select count(*) from decks where summary is not null $q$ into n;
    insert into check_rows (line) values ('OK|résumés non nuls (cache invalidé par 001 / 002, recalcul à l''étape 9) : ' || n);
    execute $q$ select count(*) from decks $q$ into n;
    insert into check_rows (line) values ('OK|decks : ' || n);
  else
    insert into check_rows (line) values ('KO|table decks absente');
  end if;
  if to_regclass('public.deck_conditions') is not null then
    execute $q$ select count(*) from deck_conditions where (source_card_id is null) = (source_pair_id is null) $q$ into n;
    insert into check_rows (line) values ((case when n = 0 then 'OK' else 'KO' end) || '|conditions sans source unique : ' || n || ', 0 attendu');
    execute $q$ select count(*) from deck_conditions $q$ into n;
    insert into check_rows (line) values ('OK|conditions ET/OU : ' || n);
  end if;
  if to_regclass('public.deck_combo_pairs') is not null then
    execute $q$ select count(*) from deck_combo_pairs $q$ into n;
    insert into check_rows (line) values ('OK|paires locales : ' || n);
  end if;

  -- Un rejeu du schéma ne doit plus rien recréer : le bloc historique de schema.sql est
  -- conditionné à « 003 journalisée » ; la présence de la journalisation le garantit (contrôle
  -- ci-dessus), et 003 refuse à chaque rejeu tout objet réapparu.
  select array_agg(tablename order by tablename) into names from pg_tables where schemaname = 'public';
  insert into check_rows (line) values ('OK|tables du schéma public : ' || array_to_string(names, ', '));
end $$;
select line from check_rows order by n;
drop table check_rows;
