-- Empreinte de données par table (étape 8B, D3). Pour chaque table du schéma public :
-- effectif et md5 des lignes triées (texte de la ligne composite) ; dernière ligne :
-- empreinte globale = md5 des lignes précédentes. Sortie attendue avec `psql -At` :
--   <table>|<effectif>|<md5>      (une ligne par table, ordre alphabétique)
--   empreinte|<md5 global>
-- Deux bases portant les mêmes données donnent le même fichier, quel que soit le
-- conteneur ; les réglages de session ci-dessous fixent la représentation textuelle
-- des dates, des flottants et des bytea. Aucune donnée n'est écrite ni affichée.
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set extra_float_digits = 1;
set bytea_output = 'hex';
create temporary table fingerprint_rows (t text primary key, n bigint not null, h text not null);
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format(
      'insert into fingerprint_rows select %L, count(*), md5(coalesce(string_agg(x::text, E''\n'' order by x::text), '''')) from %I x',
      r.tablename, r.tablename);
  end loop;
end $$;
select t || '|' || n || '|' || h from fingerprint_rows order by t;
select 'empreinte|' || md5(coalesce(string_agg(t || '|' || n || '|' || h, E'\n' order by t), '')) from fingerprint_rows;
drop table fingerprint_rows;
