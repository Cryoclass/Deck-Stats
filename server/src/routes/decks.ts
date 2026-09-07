import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { query, tx } from '../db.js';
import { requireUser } from '../auth/session.js';
import { ConfigurationError, parseConfiguration, uuidPattern, type Configuration } from '../domain/deckConfiguration.js';
import { parseArchive, remapCategoryReferences, type DeckArchive } from '../domain/deckArchive.js';
import { readConfiguration, writeConfiguration } from '../domain/deckRepository.js';

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
async function insertDeck(c: PoolClient, owner: string, data: Configuration) {
  const { rows: [row] } = await c.query('insert into decks (owner_id,name) values ($1,$2) returning id', [owner,data.name]);
  await writeConfiguration(c,row.id,data);
  return row.id as string;
}

async function mergeLibrary(c: PoolClient, uid: string, archive: DeckArchive): Promise<void> {
  await c.query('select id from users where id=$1 for update', [uid]);
  const mapping = new Map<string,string>();
  for (const cat of archive.library.categories) {
    const { rows: [existing] } = await c.query('select id,relevance from nonengine_categories where owner_id=$1 and name=$2', [uid,cat.name]);
    if (existing && existing.relevance !== cat.relevance) error(409, `Catégorie « ${cat.name} » : pertinence différente dans votre bibliothèque. Aucun import effectué.`);
    if (existing) mapping.set(cat.id,existing.id);
    else {
      const { rows: [created] } = await c.query('insert into nonengine_categories (owner_id,name,relevance) values ($1,$2,$3) returning id', [uid,cat.name,cat.relevance]);
      mapping.set(cat.id,created.id);
    }
  }
  for (const id of archive.library.hoptCardIds) {
    const { rows: [existing] } = await c.query('select is_hopt from card_flags where owner_id=$1 and card_id=$2', [uid,id]);
    if (existing && !existing.is_hopt) error(409, `HOPT contradictoire pour la carte ${id}. Aucun import effectué.`);
    await c.query('insert into card_flags (owner_id,card_id,is_hopt) values ($1,$2,true) on conflict (owner_id,card_id) do nothing', [uid,id]);
  }
  for (const cc of archive.library.cardCategories) await c.query('insert into card_categories (card_id,category_id) values ($1,$2) on conflict do nothing', [cc.card_id,mapping.get(cc.category_id)]);
  archive.configuration.params = remapCategoryReferences(archive.configuration.params,mapping);
}

export async function decksRoutes(app: FastifyInstance) {
  app.get('/', async (req) => {
    const { rows } = await query(
      `select d.id,d.name,d.created_at,d.updated_at,d.revision,null as summary,
       coalesce(sum(dc.copies) filter (where dc.zone='main'),0)::int as main_count,
       coalesce((select array_agg(card_id) from (select card_id from deck_cards where deck_id=d.id and zone='main' order by card_id limit 8) t),'{}') as sample_cards
       from decks d left join deck_cards dc on dc.deck_id=d.id where d.owner_id=$1 group by d.id order by d.updated_at desc`, [requireUser(req).id]);
    return rows;
  });
  app.get<{ Params: { id: string } }>('/:id', async (req) => tx(async (c) => {
    const deck = await lockDeck(c,req.params.id,requireUser(req).id,true);
    const data = await readConfiguration(c,deck.id);
    return { ...deck, summary: null, configuration_version: 2, cards: data.cards, starters: data.starters,
      pairs: data.pairs, pair_exclusions: data.pairs.filter((p) => p.disabled).map((p) => p.id),
      start_requirements: data.requirements, deadFirst: data.deadFirst, deadSecond: data.deadSecond };
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
  app.put<{ Params: { id: string }; Body: { configuration: unknown; expectedRevision: number } }>('/:id', async (req) => {
    const data = parseConfiguration(req.body?.configuration);
    const revision = req.body?.expectedRevision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ConfigurationError('Révision requise. Rechargez ce deck.');
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
      return { revision: revision+1 };
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
      data.requirements = data.requirements.map((r) => ({ ...r,id: randomUUID(),source_pair_id: r.source_pair_id ? mapping.get(r.source_pair_id)! : null }));
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
