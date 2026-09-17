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
  -- Journal : 001 à 006 journalisées, y compris le second marqueur de 006 (« /c ») qui garde la
  -- migration de données de la partie C (elle ne doit jouer qu'une fois).
  foreach t in array array['001-deck-configuration', '002-profiles-and-conditions', '003-purge-legacy', '004-side-plans', '005-backoffice', '006-annotation-defaults', '006-annotation-defaults/c'] loop
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
  foreach t in array array['deck_combo_pairs', 'deck_conditions', 'deck_flags', 'nonengine_groups', 'deck_cards', 'deck_starters', 'card_flags', 'nonengine_categories', 'card_categories', 'deck_matchups', 'deck_side_plans', 'deck_side_plan_cards', 'backoffice_totp', 'backoffice_sessions', 'backoffice_audit', 'card_references', 'card_reference_log', 'user_notices'] loop
    ok := to_regclass('public.' || t) is not null;
    insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|table v2 ' || t || (case when ok then ' : présente' else ' : ABSENTE' end));
  end loop;
  foreach t in array array['decks.revision', 'card_flags.availability', 'card_flags.group_id', 'card_flags.nonengine_choice', 'nonengine_groups.is_builtin', 'decks.params', 'decks.summary', 'users.role'] loop
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

  -- Annotations par défaut (006, docs/annotations-par-defaut.md §13) : hiérarchie de rôles à trois
  -- valeurs, `is_hopt` nullable (NULL = hérite du défaut), référence commune et son journal en
  -- ajout seul, un groupe fourni de base « Mulcharmy » par compte.
  ok := exists (select 1 from pg_constraint where conname = 'users_role_check' and pg_get_constraintdef(oid) like '%referent%');
  insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|users_role_check' || (case when ok then ' : trois valeurs (user, referent, admin)' else ' : « referent » ABSENT (006 non appliquée ou contrainte écrasée)' end));
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'card_flags' and column_name = 'is_hopt' and is_nullable = 'YES';
  insert into check_rows (line) values ((case when n = 1 then 'OK' else 'KO' end) || '|card_flags.is_hopt ' || (case when n = 1 then 'nullable (NULL = hérite du défaut)' else 'ENCORE « not null » : un choix « hérite » est impossible' end));
  if to_regclass('public.card_flags') is not null and n = 1 then
    -- Informatif, jamais KO : après la partie C, `false` est un CHOIX explicite du compte
    -- (« cette carte n'est pas HOPT »). La première application de 006 doit en revanche n'en
    -- laisser aucun — c'est le contrôle nominatif de lib.sh (check_006_data) qui l'exige, ce jour-là.
    execute $q$ select count(*) from card_flags where is_hopt = false $q$ into n;
    insert into check_rows (line) values ('OK|card_flags à « is_hopt = false » (choix explicite du compte depuis la partie C) : ' || n);
  end if;
  if to_regclass('public.card_references') is not null then
    execute $q$ select count(*) from card_references $q$ into n;
    insert into check_rows (line) values ('OK|références communes (card_references) : ' || n);
  end if;
  if to_regclass('public.card_reference_log') is not null then
    ok := exists (select 1 from pg_trigger where tgname = 'card_reference_log_append_only'
                   and tgrelid = 'public.card_reference_log'::regclass and not tgisinternal);
    insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|journal des références en ajout seul (déclencheur card_reference_log_append_only)' || (case when ok then '' else ' — ABSENT, GARANTIE ROMPUE' end));
    execute $q$ select count(*) from card_reference_log $q$ into n;
    insert into check_rows (line) values ('OK|lignes du journal des références : ' || n);
  end if;
  -- Avis d'interface fermés par compte (006, partie D) : informatif ; la table est vide le jour de
  -- la première application et se remplit à mesure que les comptes ferment le bandeau.
  if to_regclass('public.user_notices') is not null then
    execute $q$ select count(*) from user_notices $q$ into n;
    insert into check_rows (line) values ('OK|avis fermés par compte (user_notices) : ' || n);
  end if;
  if to_regclass('public.nonengine_groups') is not null and to_regclass('public.users') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'nonengine_groups' and column_name = 'is_builtin') then
    execute $q$ select count(*) from users u where not exists
      (select 1 from nonengine_groups g where g.owner_id = u.id and g.name = 'Mulcharmy' and g.is_builtin) $q$ into n;
    -- KO volontaire : D7′ veut ce groupe pour TOUT compte, et il n'est pas supprimable. 006 le
    -- rétro-crée pour les comptes existants ; les comptes créés ENSUITE dépendent de
    -- `server/src/auth/account.ts` (inscription). Un compte sans groupe = l'inscription ne le crée
    -- pas : c'est un défaut à corriger, pas un contrôle à assouplir.
    insert into check_rows (line) values ((case when n = 0 then 'OK' else 'KO' end) || '|comptes sans groupe fourni de base « Mulcharmy » (is_builtin) : ' || n || ', 0 attendu');
  end if;

  -- Back-office (docs/backoffice.md §4) : le rôle PostgreSQL du site existe, ne lit du deck que
  -- ses métadonnées, n'a aucun privilège sur les tables de contenu, ne peut ni modifier `users`
  -- ni effacer le journal ; le déclencheur d'ajout seul est en place. Ces lignes sont la
  -- vérification, à chaque déploiement, des deux garanties du back-office.
  ok := exists (select 1 from pg_roles where rolname = 'testhand_backoffice');
  insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|rôle testhand_backoffice' || (case when ok then ' : présent' else ' : ABSENT' end));
  if ok then
    n := 0;
    foreach t in array array['deck_cards', 'deck_starters', 'deck_combo_pairs', 'deck_conditions', 'deck_flags', 'deck_matchups', 'deck_side_plans', 'deck_side_plan_cards', 'card_flags', 'nonengine_categories', 'nonengine_groups', 'card_categories', 'cards', 'app_migrations', 'user_notices'] loop
      if to_regclass('public.' || t) is not null and (
           has_table_privilege('testhand_backoffice', 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
           or exists (select 1 from information_schema.column_privileges where grantee = 'testhand_backoffice' and table_schema = 'public' and table_name = t)) then
        n := n + 1;
        insert into check_rows (line) values ('KO|rôle testhand_backoffice : privilège INTERDIT sur la table de contenu ' || t);
      end if;
    end loop;
    if n = 0 then insert into check_rows (line) values ('OK|rôle testhand_backoffice : aucun privilège sur les tables de contenu (deck_cards, conditions, plans de side, bibliothèque, catalogue, journal des migrations, avis fermés)'); end if;
    if to_regclass('public.decks') is not null then
      ok := not has_column_privilege('testhand_backoffice', 'public.decks', 'name', 'select')
        and not has_column_privilege('testhand_backoffice', 'public.decks', 'notes', 'select')
        and not has_column_privilege('testhand_backoffice', 'public.decks', 'params', 'select')
        and not has_column_privilege('testhand_backoffice', 'public.decks', 'summary', 'select')
        and not has_table_privilege('testhand_backoffice', 'public.decks', 'insert, update, delete');
      insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|rôle testhand_backoffice : decks.name / notes / params / summary ' || (case when ok then 'illisibles, aucune écriture' else 'LISIBLES OU MODIFIABLES' end));
    end if;
    if to_regclass('public.users') is not null then
      ok := not has_table_privilege('testhand_backoffice', 'public.users', 'insert, update, delete')
        and not exists (select 1 from information_schema.column_privileges where grantee = 'testhand_backoffice' and table_schema = 'public' and table_name = 'users' and privilege_type <> 'SELECT');
      insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|rôle testhand_backoffice : users en lecture seule' || (case when ok then '' else ' — ÉCRITURE POSSIBLE' end));
    end if;
    if to_regclass('public.sessions') is not null then
      ok := not has_column_privilege('testhand_backoffice', 'public.sessions', 'token_hash', 'select');
      insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|rôle testhand_backoffice : sessions.token_hash ' || (case when ok then 'illisible' else 'LISIBLE' end));
    end if;
    if to_regclass('public.backoffice_audit') is not null then
      ok := not has_table_privilege('testhand_backoffice', 'public.backoffice_audit', 'update, delete, truncate')
        and exists (select 1 from pg_trigger where tgname = 'backoffice_audit_append_only' and tgrelid = 'public.backoffice_audit'::regclass and not tgisinternal);
      insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|journal backoffice_audit en ajout seul (ni update / delete / truncate pour le rôle, déclencheur présent)' || (case when ok then '' else ' — GARANTIE ROMPUE' end));
      execute 'select count(*) from backoffice_audit' into n;
      insert into check_rows (line) values ('OK|lignes du journal du back-office : ' || n);
    end if;
    -- 006 : les deux seules lectures que le rôle gagne (écran de référence à venir). 005 révoque
    -- tout à chaque rejeu et 006 réaccorde ensuite : si ces lignes manquent, l'ordre de rejeu
    -- (005 puis 006) a été inversé.
    if to_regclass('public.card_references') is not null and to_regclass('public.card_reference_log') is not null then
      ok := has_table_privilege('testhand_backoffice', 'public.card_references', 'select')
        and has_table_privilege('testhand_backoffice', 'public.card_reference_log', 'select')
        and not has_table_privilege('testhand_backoffice', 'public.card_references', 'insert, update, delete, truncate')
        and not has_table_privilege('testhand_backoffice', 'public.card_reference_log', 'insert, update, delete, truncate');
      insert into check_rows (line) values ((case when ok then 'OK' else 'KO' end) || '|rôle testhand_backoffice : card_references et card_reference_log ' || (case when ok then 'en lecture seule' else 'MAL ACCORDÉES (006 rejouée avant 005 ?)' end));
    end if;
  end if;

  -- Un rejeu du schéma ne doit plus rien recréer : le bloc historique de schema.sql est
  -- conditionné à « 003 journalisée » ; la présence de la journalisation le garantit (contrôle
  -- ci-dessus), et 003 refuse à chaque rejeu tout objet réapparu.
  select array_agg(tablename order by tablename) into names from pg_tables where schemaname = 'public';
  insert into check_rows (line) values ('OK|tables du schéma public : ' || array_to_string(names, ', '));
end $$;
select line from check_rows order by n;
drop table check_rows;
