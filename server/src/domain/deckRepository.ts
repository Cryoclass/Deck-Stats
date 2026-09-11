import type { PoolClient } from 'pg';
import type { Configuration } from './deckConfiguration.js';

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
  for (const table of ['deck_cards', 'deck_starters', 'deck_conditions', 'deck_flags']) {
    await c.query(`delete from ${table} where deck_id=$1`, [id]);
  }
  // Keep pair rows/IDs stable for future references from combo lines.
  await c.query('delete from deck_combo_pairs where deck_id=$1 and not (id=any($2::uuid[]))', [id, data.pairs.map((p) => p.id)]);
  for (const p of data.pairs) await c.query(
    `insert into deck_combo_pairs (deck_id,id,card_a_id,card_b_id,note,disabled) values ($1,$2,$3,$4,$5,$6)
     on conflict (deck_id,id) do update set note=excluded.note,disabled=excluded.disabled`,
    [id,p.id,p.card_a_id,p.card_b_id,p.note ?? null,p.disabled]);
  for (const card of data.cards) await c.query('insert into deck_cards (deck_id,card_id,zone,copies) values ($1,$2,$3,$4)', [id,card.card_id,card.zone,card.copies]);
  for (const cardId of data.starters) await c.query('insert into deck_starters (deck_id,card_id) values ($1,$2)', [id,cardId]);
  for (const r of data.conditions) await c.query('insert into deck_conditions (deck_id,id,source_card_id,source_pair_id,condition) values ($1,$2,$3,$4,$5::jsonb)', [id,r.id,r.source_card_id,r.source_pair_id,JSON.stringify(r.condition)]);
  for (const cardId of new Set([...data.deadFirst,...data.deadSecond])) await c.query('insert into deck_flags (deck_id,card_id,dead_first,dead_second) values ($1,$2,$3,$4)', [id,cardId,data.deadFirst.includes(cardId),data.deadSecond.includes(cardId)]);
  // Étape 10 — adversaires et plans de side. Comme `deck_combo_pairs`, les lignes ne sont PAS
  // remplacées en bloc : un adversaire et un plan gardent leur ligne, donc le cache `summary`
  // d'un plan survit à un enregistrement qui ne le concerne pas. Un `summary` devenu faux n'est
  // pas un risque : le client ne l'affiche jamais s'il ne porte pas l'empreinte courante.
  await c.query('delete from deck_matchups where deck_id=$1 and not (id=any($2::uuid[]))', [id, data.matchups.map((m) => m.id)]);
  for (const m of data.matchups) {
    await c.query(
      `insert into deck_matchups (deck_id,id,name,sort_index) values ($1,$2,$3,$4)
       on conflict (deck_id,id) do update set name=excluded.name,sort_index=excluded.sort_index`,
      [id,m.id,m.name,m.sort_index]);
    await c.query('delete from deck_side_plans where deck_id=$1 and matchup_id=$2 and not (position=any($3::text[]))', [id,m.id,m.plans.map((p) => p.position)]);
    for (const p of m.plans) {
      await c.query(
        `insert into deck_side_plans (deck_id,matchup_id,position,note) values ($1,$2,$3,$4)
         on conflict (deck_id,matchup_id,position) do update set note=excluded.note`,
        [id,m.id,p.position,p.note]);
      await c.query('delete from deck_side_plan_cards where deck_id=$1 and matchup_id=$2 and position=$3', [id,m.id,p.position]);
      for (const [direction, list] of [['out',p.outgoing],['in',p.incoming]] as const) {
        for (const card of list) await c.query('insert into deck_side_plan_cards (deck_id,matchup_id,position,card_id,direction,copies) values ($1,$2,$3,$4,$5,$6)', [id,m.id,p.position,card.card_id,direction,card.copies]);
      }
    }
  }
}
