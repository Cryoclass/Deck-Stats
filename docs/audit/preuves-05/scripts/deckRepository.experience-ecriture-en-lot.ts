import type { PoolClient } from 'pg';
import type { Configuration } from './deckConfiguration.js';

// EXPÉRIENCE D'AUDIT 05 (copie scratchpad, jamais le dépôt) : mêmes écritures que
// server/src/domain/deckRepository.ts, regroupées par table avec unnest(). readConfiguration inchangée.

/** Caller owns the transaction and locks the deck row before reading/writing. */
export async function readConfiguration(c: PoolClient, id: string): Promise<Configuration> {
  const { rows: [deck] } = await c.query('select name,params,notes from decks where id=$1', [id]);
  const cards = await c.query('select card_id,zone,copies from deck_cards where deck_id=$1 order by zone,card_id', [id]);
  const starters = await c.query('select card_id from deck_starters where deck_id=$1 order by card_id', [id]);
  const pairs = await c.query('select id,card_a_id,card_b_id,note,disabled from deck_combo_pairs where deck_id=$1 order by card_a_id,card_b_id', [id]);
  const conditions = await c.query('select id,source_card_id,source_pair_id,condition from deck_conditions where deck_id=$1 order by id', [id]);
  const flags = await c.query('select card_id,dead_first,dead_second from deck_flags where deck_id=$1', [id]);
  const matchups = await c.query('select id,name,sort_index from deck_matchups where deck_id=$1 order by sort_index,id', [id]);
  const plans = await c.query('select matchup_id,position,note from deck_side_plans where deck_id=$1 order by matchup_id,position', [id]);
  const planCards = await c.query('select matchup_id,position,card_id,direction,copies from deck_side_plan_cards where deck_id=$1 order by matchup_id,position,card_id', [id]);
  const listOf = (matchupId: string, position: string, direction: 'out' | 'in') => planCards.rows
    .filter((r) => r.matchup_id === matchupId && r.position === position && r.direction === direction)
    .map((r) => ({ card_id: r.card_id, copies: r.copies }));
  return { version: 2, name: deck.name, notes: deck.notes, params: deck.params,
    cards: cards.rows, starters: starters.rows.map((r) => r.card_id), pairs: pairs.rows,
    conditions: conditions.rows,
    deadFirst: flags.rows.filter((r) => r.dead_first).map((r) => r.card_id),
    deadSecond: flags.rows.filter((r) => r.dead_second).map((r) => r.card_id),
    matchups: matchups.rows.map((m) => ({ id: m.id, name: m.name, sort_index: m.sort_index,
      plans: plans.rows.filter((p) => p.matchup_id === m.id).map((p) => ({
        position: p.position, note: p.note,
        outgoing: listOf(m.id, p.position, 'out'), incoming: listOf(m.id, p.position, 'in') })) })) };
}

export async function writeConfiguration(c: PoolClient, id: string, data: Configuration): Promise<void> {
  await c.query('update decks set name=$2,params=$3::jsonb,notes=$4,summary=null,revision=revision+1,updated_at=clock_timestamp() where id=$1', [id, data.name, JSON.stringify(data.params), data.notes]);
  await c.query('delete from deck_cards where deck_id=$1', [id]);
  await c.query('delete from deck_starters where deck_id=$1', [id]);
  await c.query('delete from deck_conditions where deck_id=$1', [id]);
  await c.query('delete from deck_flags where deck_id=$1', [id]);
  await c.query('delete from deck_combo_pairs where deck_id=$1 and not (id=any($2::uuid[]))', [id, data.pairs.map((p) => p.id)]);
  if (data.pairs.length) await c.query(
    `insert into deck_combo_pairs (deck_id,id,card_a_id,card_b_id,note,disabled)
     select $1,u.id,u.a,u.b,u.note,u.disabled from unnest($2::uuid[],$3::bigint[],$4::bigint[],$5::text[],$6::boolean[]) as u(id,a,b,note,disabled)
     on conflict (deck_id,id) do update set note=excluded.note,disabled=excluded.disabled`,
    [id, data.pairs.map((p) => p.id), data.pairs.map((p) => p.card_a_id), data.pairs.map((p) => p.card_b_id), data.pairs.map((p) => p.note ?? null), data.pairs.map((p) => p.disabled)]);
  if (data.cards.length) await c.query(
    'insert into deck_cards (deck_id,card_id,zone,copies) select $1,u.card_id,u.zone,u.copies from unnest($2::bigint[],$3::text[],$4::smallint[]) as u(card_id,zone,copies)',
    [id, data.cards.map((x) => x.card_id), data.cards.map((x) => x.zone), data.cards.map((x) => x.copies)]);
  if (data.starters.length) await c.query('insert into deck_starters (deck_id,card_id) select $1,u from unnest($2::bigint[]) as u', [id, data.starters]);
  if (data.conditions.length) await c.query(
    'insert into deck_conditions (deck_id,id,source_card_id,source_pair_id,condition) select $1,u.id,u.src,u.pair,u.cond::jsonb from unnest($2::uuid[],$3::bigint[],$4::uuid[],$5::text[]) as u(id,src,pair,cond)',
    [id, data.conditions.map((r) => r.id), data.conditions.map((r) => r.source_card_id), data.conditions.map((r) => r.source_pair_id), data.conditions.map((r) => JSON.stringify(r.condition))]);
  const flagged = [...new Set([...data.deadFirst, ...data.deadSecond])];
  if (flagged.length) await c.query(
    'insert into deck_flags (deck_id,card_id,dead_first,dead_second) select $1,u.card_id,u.f,u.s from unnest($2::bigint[],$3::boolean[],$4::boolean[]) as u(card_id,f,s)',
    [id, flagged, flagged.map((x) => data.deadFirst.includes(x)), flagged.map((x) => data.deadSecond.includes(x))]);
  await c.query('delete from deck_matchups where deck_id=$1 and not (id=any($2::uuid[]))', [id, data.matchups.map((m) => m.id)]);
  if (!data.matchups.length) return;
  await c.query(
    `insert into deck_matchups (deck_id,id,name,sort_index) select $1,u.id,u.name,u.sort_index from unnest($2::uuid[],$3::text[],$4::int[]) as u(id,name,sort_index)
     on conflict (deck_id,id) do update set name=excluded.name,sort_index=excluded.sort_index`,
    [id, data.matchups.map((m) => m.id), data.matchups.map((m) => m.name), data.matchups.map((m) => m.sort_index)]);
  const plans = data.matchups.flatMap((m) => m.plans.map((p) => ({ m: m.id, ...p })));
  await c.query(
    `delete from deck_side_plans p where p.deck_id=$1 and not exists (select 1 from unnest($2::uuid[],$3::text[]) as u(m,pos) where u.m=p.matchup_id and u.pos=p.position)`,
    [id, plans.map((p) => p.m), plans.map((p) => p.position)]);
  if (plans.length) await c.query(
    `insert into deck_side_plans (deck_id,matchup_id,position,note) select $1,u.m,u.pos,u.note from unnest($2::uuid[],$3::text[],$4::text[]) as u(m,pos,note)
     on conflict (deck_id,matchup_id,position) do update set note=excluded.note`,
    [id, plans.map((p) => p.m), plans.map((p) => p.position), plans.map((p) => p.note)]);
  await c.query('delete from deck_side_plan_cards where deck_id=$1', [id]);
  const planCards = plans.flatMap((p) => [...p.outgoing.map((x) => ({ ...x, dir: 'out' })), ...p.incoming.map((x) => ({ ...x, dir: 'in' }))].map((x) => ({ m: p.m, pos: p.position, ...x })));
  if (planCards.length) await c.query(
    'insert into deck_side_plan_cards (deck_id,matchup_id,position,card_id,direction,copies) select $1,u.m,u.pos,u.card_id,u.dir,u.copies from unnest($2::uuid[],$3::text[],$4::bigint[],$5::text[],$6::smallint[]) as u(m,pos,card_id,dir,copies)',
    [id, planCards.map((x) => x.m), planCards.map((x) => x.pos), planCards.map((x) => x.card_id), planCards.map((x) => x.dir), planCards.map((x) => x.copies)]);
}
