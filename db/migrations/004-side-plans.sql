-- Étape 10 — adversaires et plans de side, locaux au deck. Additive et transactionnelle :
-- aucune table existante modifiée, aucun objet supprimé, aucune donnée migrée. Indépendante
-- de 003 (elle ne touche à rien d'historique) : elle s'applique aussi bien avant qu'après la
-- purge, et se rejoue sans effet.
--
-- Le contrat de domaine (server/src/domain/deckConfiguration.ts) valide la STRUCTURE d'un plan.
-- Les cohérences avec les zones (une carte entrante vient du side, une sortante du main) et
-- l'équilibre des deux listes ne sont vérifiés NI ici NI dans le contrat : un plan devenu
-- incohérent parce qu'une carte a quitté sa zone doit rester ENREGISTRABLE et être signalé
-- « à revoir » par l'éditeur, jamais réparé en silence (règles R1, R4 et R5 de docs/etape-10.md).
begin;
select pg_advisory_xact_lock(742031);
create table if not exists app_migrations (id text primary key, applied_at timestamptz not null default now());

-- Un adversaire affronté par ce deck. Nom libre pour l'instant ; une référence à un archétype
-- connu (avec son icône) viendra plus tard, sans toucher à ce qui précède. Clé (deck_id, id)
-- comme `deck_combo_pairs` : l'identifiant vient du client, il n'est unique que DANS le deck.
create table if not exists deck_matchups (
  deck_id     uuid not null references decks on delete cascade,
  id          uuid not null,
  name        text not null check (length(name) between 1 and 200),
  sort_index  int  not null default 0 check (sort_index >= 0),
  primary key (deck_id, id)
);

-- Un plan = le volet « premier » ou « second » d'un adversaire. (adversaire, position) est sa
-- clé naturelle : aucun identifiant de substitution à faire circuler. `summary` est un cache
-- d'affichage des trois indicateurs (étape 10B), écrit par le client et jamais lu par le
-- serveur — même statut que `decks.summary` : jamais une vérité, jamais affiché s'il ne porte
-- pas l'empreinte courante.
create table if not exists deck_side_plans (
  deck_id     uuid not null,
  matchup_id  uuid not null,
  position    text not null check (position in ('first', 'second')),
  note        text,
  summary     jsonb,
  primary key (deck_id, matchup_id, position),
  foreign key (deck_id, matchup_id) references deck_matchups (deck_id, id) on delete cascade
);

-- Les deux listes agrégées d'un plan tiennent dans une seule table ; `direction` dit laquelle.
-- Convention 1 à 3 copies par carte et par liste, comme `deck_cards` ; pas de FK vers le
-- catalogue (note « divergence assumée » de db/schema.sql : `card_id` est un passcode).
create table if not exists deck_side_plan_cards (
  deck_id     uuid   not null,
  matchup_id  uuid   not null,
  position    text   not null,
  card_id     bigint not null check (card_id > 0),
  direction   text   not null check (direction in ('out', 'in')),
  copies      smallint not null check (copies between 1 and 3),
  primary key (deck_id, matchup_id, position, card_id, direction),
  foreign key (deck_id, matchup_id, position) references deck_side_plans (deck_id, matchup_id, position) on delete cascade
);

-- Aucune donnée à migrer : le journal suffit, et le rejeu est sans effet.
insert into app_migrations (id) values ('004-side-plans') on conflict (id) do nothing;
commit;
