import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db.js';
import { requireUser } from '../auth/session.js';
import { cardIdValid, ConfigurationError, uuidPattern } from '../domain/deckConfiguration.js';

async function libraryWrite(uid: string, sql: string, params: unknown[]) {
  return tx(async (c) => {
    // Imports and interactive writes serialize on the same account row.
    await c.query('select id from users where id=$1 for update', [uid]);
    return c.query(sql,params);
  });
}

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/', async (req) => tx(async (c) => {
    await c.query('set transaction isolation level repeatable read');
    const uid = requireUser(req).id;
    const flags = await c.query('select card_id from card_flags where owner_id=$1 and is_hopt', [uid]);
    const categories = await c.query('select id,name,relevance,is_builtin from nonengine_categories where owner_id=$1 order by is_builtin desc,name', [uid]);
    const memberships = await c.query('select cc.card_id,cc.category_id from card_categories cc join nonengine_categories c on c.id=cc.category_id where c.owner_id=$1', [uid]);
    return { hoptCardIds: flags.rows.map((r) => r.card_id), categories: categories.rows, cardCategories: memberships.rows };
  }));

  app.put<{ Params: { cardId: string }; Body: { is_hopt: boolean } }>('/flags/:cardId', async (req) => {
    const id = Number(req.params.cardId);
    if (!cardIdValid(id) || typeof req.body?.is_hopt !== 'boolean' || Object.keys(req.body).some((k) => k !== 'is_hopt')) throw new ConfigurationError('Annotation HOPT invalide.');
    await libraryWrite(requireUser(req).id,'insert into card_flags (owner_id,card_id,is_hopt) values ($1,$2,$3) on conflict (owner_id,card_id) do update set is_hopt=excluded.is_hopt', [requireUser(req).id,id,req.body.is_hopt]);
    return { ok: true };
  });

  // Stale clients cannot resurrect or purge legacy global combos.
  for (const method of ['POST','DELETE'] as const) app.route({ method, url: method === 'POST' ? '/pairs' : '/pairs/:id', handler: async (_req,reply) => reply.code(410).send({ error: 'Les paires sont enregistrées avec chaque deck. Rechargez cette application.' }) });

  app.post<{ Body: { id?: string; name: string; relevance: string } }>('/categories', async (req,reply) => {
    const { id, name, relevance } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || !['first','second','both'].includes(relevance) || (id !== undefined && !uuidPattern.test(id))) throw new ConfigurationError('Catégorie invalide.');
    const result = await tx(async (c) => {
      await c.query('select id from users where id=$1 for update', [requireUser(req).id]);
      const existing = await c.query('select id,name,relevance,is_builtin from nonengine_categories where owner_id=$1 and name=$2', [requireUser(req).id,name.trim()]);
      if (existing.rows[0]) {
        if (existing.rows[0].relevance !== relevance) throw new ConfigurationError('Une catégorie de même nom a une autre pertinence.');
        return existing.rows[0];
      }
      const { rows: [row] } = await c.query('insert into nonengine_categories (id,owner_id,name,relevance) values (coalesce($1::uuid,gen_random_uuid()),$2,$3,$4) returning id,name,relevance,is_builtin', [id ?? null,requireUser(req).id,name.trim(),relevance]);
      return row;
    });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { id: string } }>('/categories/:id', async (req,reply) => {
    if (!uuidPattern.test(req.params.id)) throw new ConfigurationError('Identifiant invalide.');
    const result = await libraryWrite(requireUser(req).id,'delete from nonengine_categories where id=$1 and owner_id=$2 and not is_builtin returning id', [req.params.id,requireUser(req).id]);
    if (!result.rowCount) return reply.code(400).send({ error: 'Catégorie absente ou fournie de base.' });
    return { ok: true };
  });

  app.post<{ Body: { card_id: number; category_id: string } }>('/card-categories', async (req,reply) => {
    const { card_id,category_id } = req.body ?? {};
    if (!cardIdValid(card_id) || !uuidPattern.test(category_id ?? '')) throw new ConfigurationError('Affectation invalide.');
    const result = await libraryWrite(requireUser(req).id,'insert into card_categories (card_id,category_id) select $1,id from nonengine_categories where id=$2 and owner_id=$3 on conflict do nothing returning card_id', [card_id,category_id,requireUser(req).id]);
    if (!result.rowCount) {
      const owned = await query('select id from nonengine_categories where id=$1 and owner_id=$2', [category_id,requireUser(req).id]);
      if (!owned.rowCount) return reply.code(404).send({ error: 'Catégorie introuvable.' });
    }
    return reply.code(201).send({ ok: true });
  });
  app.delete<{ Params: { cardId: string; categoryId: string } }>('/card-categories/:cardId/:categoryId', async (req) => {
    const cardId = Number(req.params.cardId);
    if (!cardIdValid(cardId) || !uuidPattern.test(req.params.categoryId)) throw new ConfigurationError('Affectation invalide.');
    await libraryWrite(requireUser(req).id,'delete from card_categories cc using nonengine_categories c where c.id=cc.category_id and c.owner_id=$3 and cc.card_id=$1 and cc.category_id=$2', [cardId,req.params.categoryId,requireUser(req).id]);
    return { ok: true };
  });
}
