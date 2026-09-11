import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { query, tx } from '../db.js';
import { requireUser } from '../auth/session.js';
import { ConfigurationError, parseConfiguration, SIDE_PLAN_POSITIONS, uuidPattern, type Configuration } from '../domain/deckConfiguration.js';
import { parseArchive, remapCategoryReferences, type DeckArchive } from '../domain/deckArchive.js';
import { readConfiguration, writeConfiguration } from '../domain/deckRepository.js';
import { checkPlanSummaryMatches, checkSummaryMatches, parsePlanSummary, parseSummary, type DeckSummary } from '../domain/deckSummary.js';
import { invalidateOwnerSummaries } from './library.js';

function error(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
async function lockDeck(c: PoolClient, id: string, owner: string, shared = false) {
  if (!uuidPattern.test(id)) error(404, 'Deck introuvable.');
  const { rows } = await c.query(`select * from decks where id=$1 and owner_id=$2 for ${shared ? 'share' : 'update'}`, [id,owner]);
  if (!rows.length) error(404, 'Deck introuvable.');
  return rows[0];
}
async function validateReferences(c: PoolClient, uid: string, data: Configuration) {
  const cats = await c.query('select id from nonengine_categories where owner_id=$1', [uid]);
  remapCategoryReferences(data.params, new Map(cats.rows.map((r) => [r.id,r.id])));
}
const mainSizeOf = (data: Configuration): number => data.cards.filter((card) => card.zone === 'main').reduce((sum, card) => sum + card.copies, 0);
/** Aperçu (étape 9) : cache d'affichage écrit avec la configuration qu'il décrit, dans la même
 *  transaction ; `writeConfiguration` l'a mis à NULL juste avant. Absent = recalculé à l'accueil. */
async function writeSummary(c: PoolClient, id: string, summary: DeckSummary | null): Promise<void> {
  if (summary) await c.query('update decks set summary=$2::jsonb where id=$1', [id, JSON.stringify(summary)]);
}
function optionalSummary(value: unknown): DeckSummary | null {
  return value === undefined || value === null ? null : parseSummary(value);
}
async function insertDeck(c: PoolClient, owner: string, data: Configuration) {
  const { rows: [row] } = await c.query('insert into decks (owner_id,name) values ($1,$2) returning id', [owner,data.name]);
  await writeConfiguration(c,row.id,data);
  return row.id as string;
}

/** Fusion d'une archive avec la bibliothèque du compte : tout conflit explicite (HOPT
 *  contradictoire, profil ou plafond différent) fait échouer l'import entier. */
async function mergeLibrary(c: PoolClient, uid: string, archive: DeckArchive): Promise<void> {
  await c.query('select id from users where id=$1 for update', [uid]);
  const mapping = new Map<string,string>();
  for (const cat of archive.library.categories) {
    const { rows: [existing] } = await c.query('select id from nonengine_categories where owner_id=$1 and name=$2', [uid,cat.name]);
    if (existing) mapping.set(cat.id,existing.id);
    else {
      const { rows: [created] } = await c.query('insert into nonengine_categories (owner_id,name) values ($1,$2) returning id', [uid,cat.name]);
      mapping.set(cat.id,created.id);
    }
  }
  const groupMapping = new Map<string,string>();
  for (const group of archive.library.groups) {
    const { rows: [existing] } = await c.query('select id,cap_per_turn from nonengine_groups where owner_id=$1 and name=$2', [uid,group.name]);
    if (existing && existing.cap_per_turn !== group.cap_per_turn) error(409, `Plafond partagé « ${group.name} » : limite différente dans votre bibliothèque (${existing.cap_per_turn} contre ${group.cap_per_turn}). Aucun import effectué.`);
    if (existing) groupMapping.set(group.id,existing.id);
    else {
      const { rows: [created] } = await c.query('insert into nonengine_groups (owner_id,name,cap_per_turn) values ($1,$2,$3) returning id', [uid,group.name,group.cap_per_turn]);
      groupMapping.set(group.id,created.id);
    }
  }
  for (const id of archive.library.hoptCardIds) {
    const { rows: [existing] } = await c.query('select is_hopt from card_flags where owner_id=$1 and card_id=$2', [uid,id]);
    if (existing && !existing.is_hopt) error(409, `HOPT contradictoire pour la carte ${id}. Aucun import effectué.`);
    await c.query('insert into card_flags (owner_id,card_id,is_hopt) values ($1,$2,true) on conflict (owner_id,card_id) do nothing', [uid,id]);
  }
  for (const cc of archive.library.cardCategories) await c.query('insert into card_categories (card_id,category_id) values ($1,$2) on conflict do nothing', [cc.card_id,mapping.get(cc.category_id)]);
  for (const p of archive.library.profiles) {
    const groupId = p.group_id ? groupMapping.get(p.group_id)! : null;
    const { rows: [existing] } = await c.query('select availability,group_id from card_flags where owner_id=$1 and card_id=$2', [uid,p.card_id]);
    if (existing?.availability && existing.availability !== p.availability) error(409, `Profil contradictoire pour la carte ${p.card_id} (${existing.availability} contre ${p.availability}). Aucun import effectué.`);
    if (existing?.group_id && groupId && existing.group_id !== groupId) error(409, `Plafond partagé contradictoire pour la carte ${p.card_id}. Aucun import effectué.`);
    await c.query(
      `insert into card_flags (owner_id,card_id,availability,group_id) values ($1,$2,$3,$4)
       on conflict (owner_id,card_id) do update set availability=excluded.availability,group_id=coalesce(card_flags.group_id,excluded.group_id)`,
      [uid,p.card_id,p.availability,groupId]);
  }
  archive.configuration.params = remapCategoryReferences(archive.configuration.params,mapping);
  await invalidateOwnerSummaries(c,uid);
}

export async function decksRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { rows } = await query(
      `select d.id,d.name,d.created_at,d.updated_at,d.revision,d.summary,
       coalesce(sum(dc.copies) filter (where dc.zone='main'),0)::int as main_count,
       coalesce((select array_agg(card_id) from (select card_id from deck_cards where deck_id=d.id and zone='main' order by card_id limit 8) t),'{}') as sample_cards
       from decks d left join deck_cards dc on dc.deck_id=d.id where d.owner_id=$1 group by d.id order by d.updated_at desc`, [requireUser(req).id]);
    return rows;
  });
  app.get<{ Params: { id: string } }>('/:id', async (req) => tx(async (c) => {
    const deck = await lockDeck(c,req.params.id,requireUser(req).id,true);
    const data = await readConfiguration(c,deck.id);
    // Étape 10B : chiffres des plans de side, caches d'affichage hors configuration ; le client ne
    // les affiche que s'ils portent l'empreinte du deck sidé courant (usablePlanSummary).
    const planSummaries = await c.query('select matchup_id,position,summary from deck_side_plans where deck_id=$1 and summary is not null order by matchup_id,position', [deck.id]);
    return { ...deck, summary: null, plan_summaries: planSummaries.rows, configuration_version: 2, cards: data.cards, starters: data.starters,
      pairs: data.pairs, pair_exclusions: data.pairs.filter((p) => p.disabled).map((p) => p.id),
      conditions: data.conditions, deadFirst: data.deadFirst, deadSecond: data.deadSecond, matchups: data.matchups };
  }));
  app.post('/', async (req,reply) => {
    const data = parseConfiguration(req.body);
    const id = await tx(async (c) => {
      await validateReferences(c,requireUser(req).id,data);
      return insertDeck(c,requireUser(req).id,data);
    });
    return reply.code(201).send({ id, revision: 1 });
  });
  app.post('/import', async (req,reply) => {
    const archive = parseArchive(req.body);
    const id = await tx(async (c) => {
      await mergeLibrary(c,requireUser(req).id,archive);
      return insertDeck(c,requireUser(req).id,archive.configuration);
    });
    return reply.code(201).send({ id, revision: 1 });
  });
  app.put<{ Params: { id: string }; Body: { configuration: unknown; expectedRevision: number; summary?: unknown } }>('/:id', async (req) => {
    const data = parseConfiguration(req.body?.configuration);
    const revision = req.body?.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ConfigurationError('Révision requise. Rechargez ce deck.');
    const summary = optionalSummary(req.body?.summary);
    if (summary) checkSummaryMatches(summary, mainSizeOf(data));
    return tx(async (c) => {
      const deck = await lockDeck(c,req.params.id,requireUser(req).id);
      if (deck.revision !== revision) error(409,'Ce deck a été modifié ailleurs. Rechargez-le avant d’enregistrer ; votre brouillon est conservé.');
      await validateReferences(c,requireUser(req).id,data);
      const existing = await c.query('select id,card_a_id,card_b_id from deck_combo_pairs where deck_id=$1', [deck.id]);
      for (const pair of data.pairs) {
        const previous = existing.rows.find((p) => p.id === pair.id);
        if (previous && (previous.card_a_id !== pair.card_a_id || previous.card_b_id !== pair.card_b_id)) throw new ConfigurationError('Une identité de paire ne peut pas changer de cartes.');
      }
      await writeConfiguration(c,deck.id,data);
      await writeSummary(c,deck.id,summary);
      return { revision: revision+1 };
    });
  });
  // Aperçu recalculé à l'accueil (étape 9, Q7) : accepté seulement pour la révision courante
  // (409 sinon, ignoré par le client) et pour la composition enregistrée ; ne change ni la
  // révision ni `updated_at` (ce n'est pas une édition du deck).
  app.put<{ Params: { id: string }; Body: { summary: unknown; expectedRevision: number } }>('/:id/summary', async (req) => {
    const revision = req.body?.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ConfigurationError('Révision requise.');
    const summary = parseSummary(req.body?.summary);
    return tx(async (c) => {
      const deck = await lockDeck(c,req.params.id,requireUser(req).id);
      if (deck.revision !== revision) error(409,'Ce deck a été modifié depuis le calcul de son aperçu.');
      const { rows: [{ n }] } = await c.query<{ n: number }>("select coalesce(sum(copies),0)::int as n from deck_cards where deck_id=$1 and zone='main'", [deck.id]);
      checkSummaryMatches(summary,n);
      await writeSummary(c,deck.id,summary);
      return { ok: true, revision: deck.revision };
    });
  });
  // Chiffres d'un plan de side (étape 10B), calqué sur l'aperçu du deck : accepté seulement pour la
  // révision courante (409 sinon, ignoré par le client) et pour la taille du main APRÈS échange du
  // plan enregistré ; ne change ni la révision ni `updated_at`. Plan inconnu = 404, comme un deck.
  app.put<{ Params: { id: string; matchupId: string; position: string }; Body: { summary: unknown; expectedRevision: number } }>('/:id/matchups/:matchupId/plans/:position/summary', async (req) => {
    const { matchupId, position } = req.params;
    if (!uuidPattern.test(matchupId) || !(SIDE_PLAN_POSITIONS as readonly string[]).includes(position)) error(404, 'Plan de side introuvable.');
    const revision = req.body?.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ConfigurationError('Révision requise.');
    const summary = parsePlanSummary(req.body?.summary);
    return tx(async (c) => {
      const deck = await lockDeck(c,req.params.id,requireUser(req).id);
      if (deck.revision !== revision) error(409,'Ce deck a été modifié depuis le calcul de ce plan.');
      const plan = await c.query('select 1 from deck_side_plans where deck_id=$1 and matchup_id=$2 and position=$3 for update', [deck.id,matchupId,position]);
      if (!plan.rowCount) error(404,'Plan de side introuvable.');
      const { rows: [size] } = await c.query<{ main: number; outgoing: number; incoming: number }>(
        `select (select coalesce(sum(copies),0)::int from deck_cards where deck_id=$1 and zone='main') as main,
                coalesce(sum(copies) filter (where direction='out'),0)::int as outgoing,
                coalesce(sum(copies) filter (where direction='in'),0)::int as incoming
           from deck_side_plan_cards where deck_id=$1 and matchup_id=$2 and position=$3`, [deck.id,matchupId,position]);
      checkPlanSummaryMatches(summary,size.main - size.outgoing + size.incoming);
      await c.query('update deck_side_plans set summary=$4::jsonb where deck_id=$1 and matchup_id=$2 and position=$3', [deck.id,matchupId,position,JSON.stringify(summary)]);
      return { ok: true, revision: deck.revision };
    });
  });
  app.patch<{ Params: { id: string }; Body: { name: string } }>('/:id', async (req) => tx(async (c) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new ConfigurationError('Nom invalide.');
    await lockDeck(c,req.params.id,requireUser(req).id);
    await c.query('update decks set name=$2,revision=revision+1,updated_at=clock_timestamp() where id=$1', [req.params.id,name.trim()]);
    return { ok: true };
  }));
  app.post<{ Params: { id: string } }>('/:id/duplicate', async (req,reply) => {
    const id = await tx(async (c) => {
      await lockDeck(c,req.params.id,requireUser(req).id,true);
      const data = await readConfiguration(c,req.params.id);
      const mapping = new Map(data.pairs.map((p) => [p.id,randomUUID()]));
      data.name = `${data.name.slice(0,192)} (copie)`;
      data.pairs = data.pairs.map((p) => ({ ...p,id: mapping.get(p.id)! }));
      data.conditions = data.conditions.map((r) => ({ ...r,id: randomUUID(),source_pair_id: r.source_pair_id ? mapping.get(r.source_pair_id)! : null }));
      // Les adversaires de la copie sont des adversaires distincts : identités neuves, comme les
      // paires. Leurs plans suivent (clé naturelle adversaire + position) ; aucun cache d'aperçu
      // n'est copié, la copie recalcule ses chiffres.
      data.matchups = data.matchups.map((m) => ({ ...m,id: randomUUID() }));
      return insertDeck(c,requireUser(req).id,data);
    });
    return reply.code(201).send({ id, revision: 1 });
  });
  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    if (!uuidPattern.test(req.params.id)) error(404,'Deck introuvable.');
    await query('delete from decks where id=$1 and owner_id=$2', [req.params.id,requireUser(req).id]);
    return { ok: true };
  });
  for (const path of ['starters','pair-exclusions','start-requirements']) app.put(`/:id/${path}`, async () => error(410,'Rechargez l’application : enregistrement complet du deck requis.'));
}
